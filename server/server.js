// HTTP-сервер прогностики: віддає інтерфейс і API розрахунку. Без зовнішніх залежностей.
//
//   node server.js            → http://localhost:8787
//
// Змінні середовища:
//   PORT            порт (за замовчуванням 8787)
//   CONTENT_PATH    шлях до content.json (за замовчуванням ../private/content.json)
//   DEV_PLAN_PARAM  "1" — дозволити тариф із параметра ?plan= (лише для демо!). У бойовому режимі
//                   тариф визначається на сервері за оплаченими замовленнями (див. getEntitlement).
//   PERIOD_MODE     birthday_after_15 (правило замовниці) або calendar (варіант із PDF №15)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForecast, PLANS, PRICES } from './forecast.js';
import { validateInput } from './engine.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8787);
const CONTENT_PATH = process.env.CONTENT_PATH || join(ROOT, 'private', 'content.json');
const DEV_PLAN_PARAM = (process.env.DEV_PLAN_PARAM ?? '1') === '1';
const PERIOD_MODE = process.env.PERIOD_MODE || 'birthday_after_15';

if (!existsSync(CONTENT_PATH)) {
  console.error(`Не знайдено базу контенту: ${CONTENT_PATH}`);
  process.exit(1);
}
const content = JSON.parse(readFileSync(CONTENT_PATH, 'utf8'));

// Публічно доступні лише ці файли. Папка private/ та сервер ніколи не віддаються.
const PUBLIC = [join(ROOT, 'index.html'), join(ROOT, 'anim') + sep];
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function isPublic(abs) {
  return abs === PUBLIC[0] || abs.startsWith(PUBLIC[1]);
}

/**
 * Доступ користувача. Зараз — демо-режим. Для запуску: шукати оплачені замовлення за
 * telegram_user_id (після перевірки initData) і повертати plan_id найвищого оплаченого тарифу.
 */
function getEntitlement(url) {
  if (DEV_PLAN_PARAM) {
    const plan = url.searchParams.get('plan');
    if (plan && PLANS[plan]) return plan;
  }
  return 'demo';
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function readBody(req, limit = 4096) {
  return new Promise((ok, fail) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { fail(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/forecast' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'Некоректний запит' }); }
      const birth = { d: Number(body?.birth?.d), m: Number(body?.birth?.m), y: Number(body?.birth?.y) };
      const year = Number(body?.year ?? 2027);
      const err = validateInput(birth, year);
      if (err) return sendJson(res, 422, { error: err });
      const status = ['single', 'couple', 'unknown'].includes(body.status) ? body.status : 'unknown';
      const hasChildren = body.children === true ? true : body.children === false ? false : null;
      const plan = getEntitlement(url);
      const out = buildForecast(content, { birth, year, plan, status, hasChildren, periodMode: PERIOD_MODE });
      if (out.errors.length) console.error('Помилки комплектності:', out.errors);
      return sendJson(res, 200, { ...out, prices: PRICES });
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Не знайдено' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const abs = normalize(join(ROOT, rel));
    if (!abs.startsWith(ROOT + sep) || !isPublic(abs) || !existsSync(abs) || !statSync(abs).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Не знайдено');
    }
    res.writeHead(200, { 'content-type': TYPES[extname(abs)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    createReadStream(abs).pipe(res);
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: 'Помилка сервера' });
  }
});

server.listen(PORT, () => {
  console.log(`Прогностика: http://localhost:${PORT}  (база ${content.version}, режим місяців: ${PERIOD_MODE}, plan з URL: ${DEV_PLAN_PARAM ? 'так (демо)' : 'ні'})`);
});
