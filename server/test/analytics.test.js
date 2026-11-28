// Аналітика: перевірка initData, чистка подій, злиття лендинг → бот → застосунок, сегменти, вивантаження.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyInitData, cleanProps, EVENTS, openStore, syncToSheets, SHEET_PEOPLE, SHEET_EVENTS, eventRow } from '../analytics.js';

const TOKEN = '123456:TEST-token';
export function signInitData(fields, token = TOKEN) {
  const p = new URLSearchParams(fields);
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}
const now = Math.floor(Date.now() / 1000);
const user = JSON.stringify({ id: 777, first_name: 'Тест', username: 'tester', language_code: 'uk' });

test('initData: правильний підпис приймається, підробка — ні', () => {
  const good = signInitData({ user, auth_date: String(now), start_param: 'o_ORD1' });
  const u = verifyInitData(good, TOKEN);
  assert.equal(u.id, 777);
  assert.equal(u.username, 'tester');
  assert.equal(u.start_param, 'o_ORD1');
  assert.equal(verifyInitData(good, 'інший:токен'), null);
  assert.equal(verifyInitData(good.replace('777', '778'), TOKEN), null, 'підмінений ID');
  assert.equal(verifyInitData(signInitData({ user, auth_date: String(now - 3 * 86400) }), TOKEN), null, 'прострочено');
  assert.equal(verifyInitData('hash=zz', TOKEN), null);
  assert.equal(verifyInitData(good, ''), null, 'без токена бота — не довіряємо');
});

test('Події: лише дозволені поля й типи', () => {
  assert.deepEqual(cleanProps(EVENTS.month_open.props, { month: 13, year: 2027, locked: 'так', via: 'grid', evil: '=HYPERLINK()' }), { year: 2027, via: 'grid' });
  assert.deepEqual(cleanProps(EVENTS.landing_view.props, { utm_source: ' inst\u0000a ', __proto__: { x: 1 } }), { utm_source: 'inst a' });
  assert.deepEqual(cleanProps(EVENTS.tariff_click.props, { plan: 'free' }), {});
});

function journey() {
  const s = openStore(':memory:');
  const T = Date.now() - 3600e3; let t = T;
  const at = () => (t += 1000);
  // 1) Купила на лендингу, зайшла в бот, відкрила, читала
  s.add([{ name: 'landing_view', ts: at(), visitor_id: 'vA', props: { utm_source: 'instagram', utm_campaign: 'reels' } }]);
  s.add([{ name: 'tariff_click', ts: at(), visitor_id: 'vA', props: { plan: 'full' } }]);
  s.add([{ name: 'checkout_start', ts: at(), visitor_id: 'vA', props: { plan: 'full' } }]);
  s.add([{ id: 'payment_success:A1', name: 'payment_success', ts: at(), visitor_id: 'vA', order_id: 'A1', props: { plan: 'full', amount: 999, currency: 'UAH' } }]);
  s.add([{ id: 'payment_success:A1', name: 'payment_success', ts: at(), visitor_id: 'vA', order_id: 'A1', props: { plan: 'full', amount: 999 } }]); // повтор вебхука
  s.add([{ name: 'bot_start', ts: at(), tg_id: 101, props: { start_param: 'o_A1' } }], { tgUser: { id: 101, username: 'anna', first_name: 'Анна' } });
  s.add([{ name: 'app_open', ts: at(), tg_id: 101, props: {} }, { name: 'birth_entered', ts: at(), tg_id: 101, props: { birth_year: 1990 } },
    { name: 'card_open', ts: at(), tg_id: 101, props: { card: 'finance', locked: false } },
    { name: 'month_open', ts: at(), tg_id: 101, props: { month: 3, year: 2027, locked: false } },
    { name: 'month_open', ts: at(), tg_id: 101, props: { month: 3, year: 2027, locked: false } },
    { name: 'session_end', ts: at(), tg_id: 101, props: { duration_s: 300 } }]);
  // 2) Купила, але так і не зайшла в бот
  s.add([{ name: 'landing_view', ts: at(), visitor_id: 'vB', props: {} },
    { name: 'payment_success', id: 'payment_success:B1', ts: at(), visitor_id: 'vB', order_id: 'B1', props: { plan: 'vip', amount: 1799 } }]);
  // 3) Купила, зайшла в бот, але не відкрила застосунок
  s.add([{ name: 'payment_success', id: 'payment_success:C1', ts: at(), visitor_id: 'vC', order_id: 'C1', props: { plan: 'annual', amount: 799 } },
    { name: 'bot_start', ts: at(), tg_id: 103, props: { start_param: 'o_C1' } }]);
  // 4) Зайшла в бот і нічого
  s.add([{ name: 'bot_start', ts: at(), tg_id: 104, props: { start_param: 'insta' } }]);
  // 5) Відкрила демо, не купила
  s.add([{ name: 'bot_start', ts: at(), tg_id: 105, props: {} }, { name: 'app_open', ts: at(), tg_id: 105, props: {} },
    { name: 'card_open', ts: at(), tg_id: 105, props: { card: 'health', locked: true } }]);
  // 6) Невдала оплата
  s.add([{ name: 'checkout_start', ts: at(), visitor_id: 'vF', props: { plan: 'monthly' } },
    { name: 'payment_failed', id: 'payment_failed:F1', ts: at(), visitor_id: 'vF', order_id: 'F1', props: { plan: 'monthly', amount: 399, reason: 'insufficient_funds' } }]);
  // 7) Лише подивилась лендинг
  s.add([{ name: 'landing_view', ts: at(), visitor_id: 'vG', props: {} }]);
  return s;
}

test('Злиття й сегменти: хто купив і не відкрив, хто в боті без застосунку', () => {
  const s = journey();
  const P = Object.fromEntries(s.people().map((p) => [p.key, p]));
  assert.equal(P['v:vA'], undefined, 'відвідувач лендингу злився з Telegram-профілем');
  const a = P['tg:101'];
  assert.equal(a.segment, 'Оплатив — користується');
  assert.equal(a.source, 'instagram');
  assert.equal(a.paid, 999, 'повторний вебхук не задвоїв суму');
  assert.equal(a.plan, 'full');
  assert.equal(a.username, '@anna');
  assert.equal(a.topMonth, 3);
  assert.equal(a.minutes, 5);
  assert.equal(P['v:vB'].segment, 'Оплатив — не зайшов у бот');
  assert.equal(P['tg:103'].segment, 'Оплатив — у боті, не відкрив застосунок');
  assert.equal(P['tg:104'].segment, 'У боті — не відкрив застосунок');
  assert.equal(P['tg:104'].source, 'insta');
  assert.equal(P['tg:105'].segment, 'Відкрив застосунок — не купив');
  assert.equal(P['tg:105'].locked, 1);
  assert.equal(P['v:vF'].segment, 'Не вдалася оплата');
  assert.equal(P['v:vG'].segment, 'Лише лендинг');
  const O = Object.fromEntries(s.orders().map((o) => [o.order_id, o]));
  assert.equal(O.A1.tg_id, 101);
  assert.ok(O.A1.appAt);
  assert.equal(O.B1.tg_id, null);
  assert.equal(O.F1.status, 'failed');
});

test('Вивантаження: події позначаються лише після {ok:true}', async () => {
  const s = journey();
  const total = s.pending();
  let got;
  const fail = async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) });
  await assert.rejects(syncToSheets(s, { url: 'x', secret: 'k', fetchImpl: fail }));
  assert.equal(s.pending(), total);
  const ok = async (u, o) => { got = JSON.parse(o.body); return { ok: true, json: async () => ({ ok: true }) }; };
  const r = await syncToSheets(s, { url: 'x', secret: 'k', fetchImpl: ok });
  assert.equal(r.sent, total);
  assert.equal(s.pending(), 0);
  assert.equal(got.secret, 'k');
  assert.equal(got.events.rows.length, total);
  assert.equal(got.events.header.length, SHEET_EVENTS.header.length);
  const people = got.replace.find((x) => x.name === 'Люди');
  assert.ok(people.rows.every((r) => r.length === SHEET_PEOPLE.header.length));
  assert.equal((await syncToSheets(s, { url: 'x', secret: 'k', fetchImpl: ok })).sent, 0);
});

test('Рядок події: місяць і картка людською мовою', () => {
  const r = eventRow({ id: '1', ts: 1, name: 'month_open', src: 'app', tg_id: 5, visitor_id: null, order_id: null, props: JSON.stringify({ month: 8, year: 2027, locked: true, via: 'next' }) });
  assert.deepEqual(r.slice(2, 14), ['Відкрив місяць', 'month_open', 'Застосунок', 5, '', '', '', 2027, 'Серпень', '', 'так', '{"via":"next"}']);
});
