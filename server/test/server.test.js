// Тести безпеки HTTP-сервера: запускають справжній server.js на локальному порту (127.0.0.1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server.js', import.meta.url));
const HAS_CONTENT = existsSync(fileURLToPath(new URL('../../private/content.json', import.meta.url)));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const B = `http://127.0.0.1:${PORT}`;
let proc;

function start(env, port = PORT) {
  const p = spawn(process.execPath, [SERVER], { env: { PATH: process.env.PATH, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((ok) => {
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('Прогностика:')) ok({ p, ready: true }); });
    p.on('exit', (code) => ok({ p, ready: false, code }));
  });
}
const post = (body, q = '') => fetch(`${B}/api/forecast${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const BIRTH = { birth: { d: 29, m: 7, y: 1989 }, year: 2027 };

function raw(line) {
  return new Promise((ok) => {
    const s = connect(PORT, '127.0.0.1', () => s.write(`${line}\r\nHost: x\r\n\r\n`));
    let data = '';
    s.on('data', (d) => { data += d; });
    s.on('close', () => ok(data));
    s.on('error', () => ok(data));
    setTimeout(() => s.destroy(), 1500);
  });
}

before(async () => { if (HAS_CONTENT) ({ p: proc } = await start({})); });
after(() => proc?.kill());

const opt = { skip: !HAS_CONTENT };

test('За замовчуванням ?plan=full НЕ відкриває платні тексти', opt, async () => {
  const j = await (await post(BIRTH, '?plan=full')).json();
  assert.equal(j.plan, 'demo');
  assert.ok(j.annual.cards.slice(1).every((c) => c.locked && !c.items));
  assert.ok(j.monthly.months.slice(1).every((m) => m.locked && !m.items));
});

test('Тариф не можна підробити через тіло запиту чи __proto__', opt, async () => {
  const j = await (await post('{"birth":{"d":29,"m":7,"y":1989},"year":2027,"plan":"full","__proto__":{"plan":"full"}}')).json();
  assert.equal(j.plan, 'demo');
});

test('Кривий адрес не зупиняє сервер', opt, async () => {
  await raw('GET http://[::1 HTTP/1.1');
  await raw('GET /%E0%A4%A HTTP/1.1');
  assert.equal((await fetch(`${B}/`)).status, 200);
  assert.equal((await fetch(`${B}/%E0%A4%A`)).status, 400);
});

test('Приватні файли та код сервера недоступні', opt, async () => {
  for (const p of ['/private/content.json', '/private/pages-password.txt', '/server/server.js', '/.git/config',
    '/..%2fprivate%2fcontent.json', '/anim/..%2f..%2fprivate%2fcontent.json', '/docs/content.enc.json', '/index.html%00.png']) {
    const r = await fetch(B + p);
    assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`);
  }
  const r = await raw('GET /anim/../private/content.json HTTP/1.1');
  assert.ok(!r.includes('"records"'), 'шлях із ../ не віддає базу');
});

test('Завеликий запит → 413, сервер працює далі', opt, async () => {
  const r = await post('{"x":"' + 'a'.repeat(10000) + '"}');
  assert.equal(r.status, 413);
  assert.equal((await post(BIRTH)).status, 200);
});

test('Некоректні дані → 4xx без падіння', opt, async () => {
  for (const b of ['null', '[]', '"x"', '{', '{"birth":{"d":"29","m":7,"y":1989},"year":2027}', '{"birth":{"d":29,"m":[7],"y":1989}}',
    '{"birth":{"d":29,"m":7,"y":1989},"year":2026}', '{"birth":{"d":29,"m":7,"y":1989},"year":99999999999}', '{"birth":{"d":31,"m":4,"y":1990}}']) {
    const r = await post(b);
    assert.ok(r.status >= 400 && r.status < 500, `${b} → ${r.status}`);
  }
  assert.equal((await fetch(`${B}/api/forecast`)).status, 405);
});

test('Заголовки безпеки на сторінці та API', opt, async () => {
  for (const r of [await fetch(`${B}/`), await post(BIRTH)]) {
    assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  }
  assert.equal((await post(BIRTH)).headers.get('cache-control'), 'no-store');
});

test('Демо-режим тарифів не запускається на відкритому інтерфейсі', opt, async () => {
  const { ready, code } = await start({ DEV_PLAN_PARAM: '1', HOST: '0.0.0.0' }, PORT + 1);
  assert.equal(ready, false);
  assert.equal(code, 1);
});
