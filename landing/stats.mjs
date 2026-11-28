// Звіт по аналітиці лендингу.
// Запуск: node landing/stats.mjs            — за весь час
//         node landing/stats.mjs 7          — за останні 7 днів
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG = join(dirname(fileURLToPath(import.meta.url)), 'data', 'events.jsonl');
const days = Number(process.argv[2] || 0);
const since = days ? Date.now() - days * 864e5 : 0;

if (!existsSync(LOG)) { console.log('Подій ще немає.'); process.exit(0); }
const rows = readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => Date.parse(r.ts) >= since);
if (!rows.length) { console.log('За цей період подій немає.'); process.exit(0); }

const LABEL = {
  cta_hero: 'Кнопка в листі (перший екран)', open_seal: 'Відкрили конверт печаткою', open_btn: 'Відкрили конверт кнопкою', cta_final: 'Кнопка у фіналі', nav_tariffs: '«Тарифи» у шапці', logo: 'Логотип', cta_telegram: 'Кнопка «Написати мені в Telegram»', contact_instagram: 'Instagram у футері', contact_telegram: 'Telegram у футері', contact_email: 'Пошта у футері',
  plan_annual: 'Тариф «Річний» 799', plan_monthly: 'Тариф «Помісячний» 399', plan_full: 'Тариф «Повний» 999', plan_vip: 'Тариф VIP 1799',
  hero: 'Перший екран', about: 'Що таке прогностика', months: 'Не всі місяці однакові', questions: 'Шість питань',
  statement: 'Щоб рік не став копією', tariffs: 'Тарифи', final: 'Фінал'
};
const L = k => LABEL[k] || k;
const firstView = new Map();
rows.filter(r => r.t === 'view').forEach(r => { if (!firstView.has(r.sid)) firstView.set(r.sid, r); });
const visits = [...firstView.values()];
const sessions = new Set(firstView.keys());
const S = sessions.size || 1;
const pct = n => `${Math.round((n / S) * 100)}%`;
const uniq = (t, n) => new Set(rows.filter(r => r.t === t && (n == null || r.n === n)).map(r => r.sid)).size;
const count = (arr) => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});

console.log(`\nПеріод: ${days ? `останні ${days} дн.` : 'весь час'}  (${rows[0].ts.slice(0, 10)} — ${rows.at(-1).ts.slice(0, 10)})`);
console.log(`Візитів: ${sessions.size}`);
const dev = count(visits.map(r => r.dev));
console.log(`Пристрої: телефон ${dev.mobile || 0}, комп'ютер ${dev.desktop || 0}`);

console.log('\nКліки (усього / унікальних візитів):');
const clicks = count(rows.filter(r => r.t === 'click').map(r => r.n));
Object.entries(clicks).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${L(k)}: ${v} / ${uniq('click', k)}`));
if (!Object.keys(clicks).length) console.log('  кліків ще немає');

const planSess = new Set(rows.filter(r => r.t === 'click' && r.n.startsWith('plan_')).map(r => r.sid)).size;
console.log(`\nНатиснули на будь-який тариф: ${planSess} з ${sessions.size} візитів (${pct(planSess)})`);

console.log('\nДо якого блоку дійшли:');
['hero', 'about', 'months', 'questions', 'statement', 'tariffs', 'final'].forEach(k => console.log(`  ${L(k)}: ${uniq('section', k)} (${pct(uniq('section', k))})`));

console.log('\nГлибина прокрутки:');
['25', '50', '75', '100'].forEach(k => console.log(`  ${k}%: ${uniq('scroll', k)} (${pct(uniq('scroll', k))})`));

const secs = rows.filter(r => r.t === 'leave').map(r => Number(r.n)).filter(n => n >= 0 && n < 7200).sort((a, b) => a - b);
if (secs.length) console.log(`\nЧас на сторінці: медіана ${secs[Math.floor(secs.length / 2)]} с`);

const src = count(visits.map(r => r.src || r.ref || 'прямий захід'));
console.log('\nДжерела:');
Object.entries(src).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

const byDay = count(visits.map(r => r.ts.slice(0, 10)));
console.log('\nВізити по днях:');
Object.entries(byDay).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));
console.log('');
