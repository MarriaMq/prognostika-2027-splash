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
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream, realpathSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForecast, PLANS, PRICES } from './forecast.js';
import { validateInput } from './engine.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const CONTENT_PATH = process.env.CONTENT_PATH || join(ROOT, 'private', 'content.json');
const DEV_PLAN_PARAM = process.env.DEV_PLAN_PARAM === '1';
const PERIOD_MODE = process.env.PERIOD_MODE === 'calendar' ? 'calendar' : 'birthday_after_15';
const ALLOWED_YEARS = (process.env.ALLOWED_YEARS || '2027').split(',').map(Number).filter(Number.isInteger);
const BODY_LIMIT = 4096;

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

function readBody(req) {
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

server.listen(PORT, HOST, () => {
  console.log(`Прогностика: http://${HOST}:${PORT}  (база ${content.version}, роки: ${ALLOWED_YEARS.join(', ')}, місяці: ${PERIOD_MODE}, plan з URL: ${DEV_PLAN_PARAM ? 'так (лише локальне демо)' : 'ні'})`);
});
