// HTTP-сервер прогностики: віддає інтерфейс і API розрахунку. Без зовнішніх залежностей.
//
//   node server.js            → http://127.0.0.1:8787
//
// Змінні середовища:
//   PORT            порт (за замовчуванням 8787)
//   HOST            адреса прослуховування (за замовчуванням 127.0.0.1 — лише цей компʼютер;
//                   на сервері за проксі залишайте 127.0.0.1, без проксі — 0.0.0.0)
//   CONTENT_PATH    шлях до content.json (за замовчуванням ../private/content.json)
//   DEV_PLAN_PARAM  "1" — дозволити тариф із параметра ?plan= (ЛИШЕ для локального демо, вимкнено за замовчуванням).
//                   У бойовому режимі тариф визначається на сервері за оплаченими замовленнями (getEntitlement).
//   ALLOWED_YEARS   роки прогнозу через кому (за замовчуванням 2027)
//   PERIOD_MODE     birthday_after_15 (правило замовниці) або calendar (варіант із PDF №15)
//
// Аналітика (див. ANALYTICS.md):
//   ANALYTICS_DB          файл бази подій (за замовчуванням ../data/analytics.sqlite; ніколи не в git)
//   BOT_TOKEN             токен бота — для перевірки Telegram initData (без нього Telegram ID із застосунку не приймається)
//   ANALYTICS_SERVER_KEY  ключ для подій бота й оплат: заголовок Authorization: Bearer <ключ>
//   SHEETS_WEBHOOK_URL    адреса веб-застосунку Apps Script, SHEETS_SECRET — його секрет
//   LANDING_ORIGINS       сайти лендингу через кому (https://site.com), яким дозволено надсилати події
//   TRUST_PROXY           "1" — брати IP з X-Forwarded-For (лише за власним проксі)
//   ANALYTICS             "off" — вимкнути аналітику повністю
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, statSync, createReadStream, realpathSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForecast, PLANS, PRICES } from './forecast.js';
import { validateInput } from './engine.js';
import { EVENTS, cleanProps, verifyInitData, openStore, syncToSheets } from './analytics.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const CONTENT_PATH = process.env.CONTENT_PATH || join(ROOT, 'private', 'content.json');
const DEV_PLAN_PARAM = process.env.DEV_PLAN_PARAM === '1';
const PERIOD_MODE = process.env.PERIOD_MODE === 'calendar' ? 'calendar' : 'birthday_after_15';
const ALLOWED_YEARS = (process.env.ALLOWED_YEARS || '2027').split(',').map(Number).filter(Number.isInteger);
const BODY_LIMIT = 4096;
const EVENT_BODY_LIMIT = 16384;
const ANALYTICS_ON = process.env.ANALYTICS !== 'off';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const SERVER_KEY = process.env.ANALYTICS_SERVER_KEY || '';
const SHEETS_URL = process.env.SHEETS_WEBHOOK_URL || '';
const SHEETS_SECRET = process.env.SHEETS_SECRET || '';
const LANDING_ORIGINS = (process.env.LANDING_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const store = ANALYTICS_ON ? openStore(process.env.ANALYTICS_DB || join(ROOT, 'data', 'analytics.sqlite')) : null;

if (!existsSync(CONTENT_PATH)) {
  console.error('Не знайдено базу контенту (CONTENT_PATH).');
  process.exit(1);
}
const content = JSON.parse(readFileSync(CONTENT_PATH, 'utf8'));

if (DEV_PLAN_PARAM && !['127.0.0.1', '::1', 'localhost'].includes(HOST)) {
  console.error('Відмова: DEV_PLAN_PARAM=1 відкриває всі платні тексти через ?plan=, тому дозволений лише з HOST=127.0.0.1.');
  process.exit(1);
}

// Публічно доступні лише ці файли. Папка private/, сервер і git ніколи не віддаються.
const PUBLIC_FILE = join(ROOT, 'index.html');
const PUBLIC_DIR = join(ROOT, 'anim') + sep;
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };

// Заголовки безпеки для всіх відповідей. frame-ancestors дозволяє відкривати застосунок у Telegram Web.
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://telegram.org",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  ].join('; '),
};

/**
 * Доступ користувача. Без DEV_PLAN_PARAM — завжди демо, доки не підключено оплату.
 * Для запуску: перевірити Telegram initData (HMAC) на сервері, знайти оплачені замовлення
 * за telegram_user_id і повернути plan_id найвищого оплаченого тарифу.
 */
function getEntitlement(url) {
  if (DEV_PLAN_PARAM) {
    const plan = url.searchParams.get('plan');
    if (plan && Object.hasOwn(PLANS, plan)) return plan;
  }
  return 'demo';
}

function send(res, code, body, type) {
  if (res.headersSent) return res.destroy();
  res.writeHead(code, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');
const sendText = (res, code, text) => send(res, code, text, 'text/plain; charset=utf-8');

class HttpError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function readBody(req, limit = BODY_LIMIT) {
  const BODY_LIMIT = limit;
  const declared = Number(req.headers['content-length']);
  if (declared > BODY_LIMIT) return Promise.reject(new HttpError(413, 'Запит завеликий'));
  return new Promise((ok, fail) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) { req.removeAllListeners('data'); req.resume(); fail(new HttpError(413, 'Запит завеликий')); } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

async function handleForecast(req, res, url) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.code, { error: e.message });
    return sendJson(res, 400, { error: 'Некоректний запит' });
  }
  if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'Некоректний запит' });
  const num = (v) => (typeof v === 'number' ? v : NaN); // лише справжні числа, без "1e1", [1] тощо
  const birth = { d: num(body.birth?.d), m: num(body.birth?.m), y: num(body.birth?.y) };
  const year = body.year === undefined ? ALLOWED_YEARS[0] : num(body.year);
  if (!ALLOWED_YEARS.includes(year)) return sendJson(res, 422, { error: 'Цей рік прогнозу недоступний' });
  const err = validateInput(birth, year);
  if (err) return sendJson(res, 422, { error: err });
  const status = ['single', 'couple', 'unknown'].includes(body.status) ? body.status : 'unknown';
  const hasChildren = body.children === true ? true : body.children === false ? false : null;
  const out = buildForecast(content, { birth, year, plan: getEntitlement(url), status, hasChildren, periodMode: PERIOD_MODE });
  if (out.errors.length) console.error('Помилки комплектності:', out.errors.length); // без персональних даних у журналі
  return sendJson(res, 200, { ...out, prices: PRICES });
}

// ── Аналітика ──
// Простий ліміт частоти: не більше 240 подій за хвилину з одного джерела.
const hits = new Map();
function allow(key, n) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + 60000 }; hits.set(key, h); }
  h.n += n;
  if (hits.size > 50000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  return h.n <= 240;
}
const clientIp = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const okId = (v) => (typeof v === 'string' && ID.test(v) ? v : null);

function cors(req, res) {
  const o = req.headers.origin;
  if (o && LANDING_ORIGINS.includes(o)) {
    res.setHeader('access-control-allow-origin', o);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'POST');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-max-age', '86400');
  }
}

async function readJson(req) {
  try { return JSON.parse(await readBody(req, EVENT_BODY_LIMIT)); } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Некоректний запит');
  }
}

/** Події з браузера: міні-застосунок і лендинг. Telegram ID — лише з перевіреного initData. */
async function handleClientEvents(req, res) {
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || !Array.isArray(body.events) || body.events.length > 25) throw new HttpError(400, 'Некоректний запит');
  if (!allow('ip:' + clientIp(req), body.events.length)) return sendJson(res, 429, { error: 'Забагато запитів' });
  const tgUser = body.initData ? verifyInitData(body.initData, BOT_TOKEN) : null;
  const visitor = okId(body.vid);
  const list = [];
  for (const e of body.events) {
    const spec = e && typeof e.n === 'string' && Object.hasOwn(EVENTS, e.n) ? EVENTS[e.n] : null;
    if (!spec || spec.src === 'server') continue; // події бота й оплат із браузера не приймаються
    const props = cleanProps(spec.props, e.p);
    if (e.n === 'app_open' && tgUser?.start_param) props.start_param = tgUser.start_param;
    list.push({ name: e.n, ts: e.t, tg_id: spec.src === 'app' ? tgUser?.id : null, visitor_id: visitor, session_id: okId(body.sid), props });
  }
  store.add(list, { tgUser });
  return sendJson(res, 200, { ok: true, accepted: list.length });
}

function keyOk(req) {
  const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
  if (!SERVER_KEY || !m) return false;
  const a = createHash('sha256').update(m[1]).digest();
  const b = createHash('sha256').update(SERVER_KEY).digest();
  return timingSafeEqual(a, b);
}

/** Події бота й оплат (із сервера бота / вебхука оплати), лише з ключем ANALYTICS_SERVER_KEY. */
async function handleServerEvents(req, res) {
  if (!keyOk(req)) return sendJson(res, 401, { error: 'Потрібен ключ' });
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || !Array.isArray(body.events) || body.events.length > 100) throw new HttpError(400, 'Некоректний запит');
  const out = []; const bad = [];
  for (const [i, e] of body.events.entries()) {
    const spec = e && typeof e.name === 'string' && Object.hasOwn(EVENTS, e.name) ? EVENTS[e.name] : null;
    if (!spec) { bad.push(i); continue; }
    const tg = e.tg && typeof e.tg === 'object' ? e.tg : null;
    const tgId = Number.isSafeInteger(e.tg_id) ? e.tg_id : Number.isSafeInteger(tg?.id) ? tg.id : null;
    const orderId = okId(e.order_id);
    if (e.name.startsWith('payment_') && !orderId) { bad.push(i); continue; }
    // Повторний вебхук оплати не задвоює суму: id за замовчуванням — «подія:замовлення».
    const id = okId(e.id) || (e.name.startsWith('payment_') ? `${e.name}:${orderId}` : undefined);
    const user = tg && tgId ? { id: tgId, username: String(tg.username || '').slice(0, 64), first_name: String(tg.first_name || '').slice(0, 64), language_code: String(tg.language_code || '').slice(0, 8), is_premium: tg.is_premium === true } : null;
    out.push({ ev: { id, name: e.name, ts: e.ts, tg_id: tgId, visitor_id: okId(e.visitor_id), order_id: orderId, props: cleanProps(spec.props, e.props) }, user });
  }
  for (const { ev, user } of out) store.add([ev], { tgUser: user });
  return sendJson(res, bad.length && !out.length ? 400 : 200, { ok: !bad.length, accepted: out.length, rejected: bad });
}

function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Метод не підтримується');
  let rel;
  try { rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch {
    return sendText(res, 400, 'Некоректна адреса');
  }
  if (rel.includes('\0')) return sendText(res, 400, 'Некоректна адреса');
  const abs = normalize(join(ROOT, rel));
  if (!(abs === PUBLIC_FILE || abs.startsWith(PUBLIC_DIR)) || !existsSync(abs)) return sendText(res, 404, 'Не знайдено');
  // Захист від символьних посилань, що ведуть за межі дозволених файлів.
  const real = realpathSync(abs);
  if (!(real === realpathSync(PUBLIC_FILE) || real.startsWith(realpathSync(PUBLIC_DIR.slice(0, -1)) + sep)) || !statSync(real).isFile()) {
    return sendText(res, 404, 'Не знайдено');
  }
  const type = TYPES[extname(real)];
  if (!type) return sendText(res, 404, 'Не знайдено');
  res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=86400' });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(real);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return sendText(res, 400, 'Некоректна адреса'); } // кривий адрес не зупиняє сервер
  try {
    if (url.pathname === '/api/forecast') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Метод не підтримується' });
      return await handleForecast(req, res, url);
    }
    if (url.pathname === '/api/event' || url.pathname === '/api/event/server') {
      if (!store) return sendJson(res, 404, { error: 'Не знайдено' });
      if (url.pathname === '/api/event') cors(req, res);
      if (req.method === 'OPTIONS' && url.pathname === '/api/event') { res.writeHead(204, SECURITY_HEADERS); return res.end(); }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Метод не підтримується' });
      try {
        return await (url.pathname === '/api/event' ? handleClientEvents(req, res) : handleServerEvents(req, res));
      } catch (e) {
        if (e instanceof HttpError) return sendJson(res, e.code, { error: e.message });
        throw e;
      }
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Не знайдено' });
    return handleStatic(req, res, url);
  } catch (e) {
    console.error('Помилка запиту:', e?.code || e?.name || 'unknown');
    return sendJson(res, 500, { error: 'Помилка сервера' });
  }
});

// Обмеження часу, щоб повільні клієнти не тримали зʼєднання.
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;

// Остання лінія захисту: помилка в одному запиті не зупиняє сервіс.
process.on('unhandledRejection', (e) => console.error('Необроблена помилка:', e?.name || 'unknown'));

// Вивантаження в Google Таблицю: кожні 30 с, поки є нові події. Помилка мережі — повтор у наступному циклі.
if (store && SHEETS_URL && SHEETS_SECRET) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      let r;
      do { r = await syncToSheets(store, { url: SHEETS_URL, secret: SHEETS_SECRET }); } while (r.more);
    } catch (e) { console.error('Таблиця:', e?.message || 'помилка'); } finally { running = false; }
  };
  setInterval(tick, Number(process.env.SHEETS_INTERVAL_MS || 30000)).unref();
  setTimeout(tick, 3000).unref();
}
if (store && !BOT_TOKEN) console.warn('Аналітика: BOT_TOKEN не задано — події застосунку записуються без Telegram ID.');

server.listen(PORT, HOST, () => {
  console.log(`Прогностика: http://${HOST}:${PORT}  (база ${content.version}, роки: ${ALLOWED_YEARS.join(', ')}, місяці: ${PERIOD_MODE}, plan з URL: ${DEV_PLAN_PARAM ? 'так (лише локальне демо)' : 'ні'})`);
});
