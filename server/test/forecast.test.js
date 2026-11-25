import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAnnual, buildMonthly, buildForecast } from '../forecast.js';
import { validateInput } from '../engine.js';

const CONTENT_PATH = fileURLToPath(new URL('../../private/content.json', import.meta.url));
const has = existsSync(CONTENT_PATH);
const content = has ? JSON.parse(readFileSync(CONTENT_PATH, 'utf8')) : null;
const B = { d: 29, m: 7, y: 1989 };
const keys = (card) => card.items.map((i) => i.key);

test('База контенту: 1 188 записів (1 166 за ТЗ + 22 короткі підказки)', { skip: !has }, () => {
  const all = Object.values(content.records);
  assert.equal(all.length, 1188);
  assert.equal(all.filter((r) => r.key.startsWith('B15.EXTRA.')).length, 22);
});

test('Річний 2027, у парі, з дітьми — ключі як у ТЗ', { skip: !has }, () => {
  const a = buildAnnual(content, B, 2027, { status: 'couple', hasChildren: true });
  assert.deepEqual(a.errors, []);
  const [general, archetype, finance, personal, health, rec] = a.cards;
  // 29.07.1989 у 2027 році (від дня народження) — 38 років: вікова «38–39» = 7, протилежна «78–79» = 8
  const b01 = (f) => [11, 7, 8].map((n) => `B01.${f}.${String(n).padStart(2, '0')}.default`);
  assert.deepEqual(keys(general), [11, 7, 8].flatMap((n) => ['theme', 'task', 'positive', 'negative']
    .map((f) => `B01.${f}.${String(n).padStart(2, '0')}.default`)).concat(['B04.karma.06.default']));
  assert.deepEqual(general.items.map((i) => i.group).filter((g, i, a) => a.indexOf(g) === i),
    ['Енергія року', 'Вікова енергія (38–39 років)', 'Протилежна вікова енергія (78–79 років)', 'Карма року']);
  assert.deepEqual(keys(archetype), ['B02.role.22.default', 'B02.action.18.default', 'B02.support.12.default', 'B08.B.18.default', 'B08.B2.21.default', 'B08.B1.03.default']);
  assert.deepEqual(keys(finance), ['B05.beliefs.20.default', 'B05.mechanism.07.default', 'B05.correction.05.default',
    'B06.K.05.default', 'B06.O.10.default', 'B06.L.05.default', 'B14.goal.06.default', 'B14.risks.06.default', 'B14.practice.06.default']);
  assert.deepEqual(keys(personal), ['B07.M.18.couple', 'B07.N.05.couple', 'B07.K.05.couple',
    'B09.A.22.default', 'B09.DBS2.07.default', 'B09.DBS3.11.default', 'B09.DBS3.11.has_children_addon', 'B11.FEMALE.21.default']);
  assert.deepEqual(keys(health), [...b01('wellbeing'), 'B03.comfort.12.default']);
  assert.deepEqual(keys(rec), [...b01('attention'), 'B10.MALE.12.default', 'B13.awareness.06.default', 'B13.beliefs.06.default',
    'B13.practice.06.default', 'B12.goal.09.default', 'B12.obstacles.09.default', 'B12.action.09.default']);
});

test('Збіг енергій об\'єднується без повтору: 25.08.2000 / 2027', { skip: !has }, () => {
  const a = buildAnnual(content, { d: 25, m: 8, y: 2000 }, 2027, {});
  assert.deepEqual(a.errors, []);
  const general = a.cards[0];
  assert.deepEqual(keys(general).filter((x) => x.startsWith('B01.theme')), ['B01.theme.10.default', 'B01.theme.11.default']);
  assert.equal(general.items[0].group, 'Енергія року та вікова енергія (27–28 років)');
  assert.equal(general.items[4].group, 'Протилежна вікова енергія (67–68 років)');
});

test('Статус не вказано → обидві версії; дітей немає → без додатку', { skip: !has }, () => {
  const a = buildAnnual(content, B, 2027, { status: 'unknown', hasChildren: null });
  const personal = a.cards.find((c) => c.id === 'personal');
  assert.deepEqual(keys(personal).slice(0, 6), ['B07.M.18.single', 'B07.M.18.couple', 'B07.N.05.single', 'B07.N.05.couple', 'B07.K.05.single', 'B07.K.05.couple']);
  assert.ok(personal.items.slice(0, 6).every((i) => i.label));
  assert.ok(!keys(personal).some((k) => k.includes('has_children_addon')));
});

test('Помісячний 2027: головна + протилежна + короткі підказки', { skip: !has }, () => {
  const m = buildMonthly(content, B, 2027, { periodMode: 'calendar' });
  assert.deepEqual(m.errors, []);
  const jan = m.months[0];
  assert.equal(jan.items.length, 11);
  assert.ok(jan.items.every((i) => i.key.startsWith('B15.MAIN.11.')));
  assert.equal(jan.oppositeItem.key, 'B15.OPPOSITE.13.opposite');
  // Січень 7–3–11–8–20: головна 11, протилежна 13 → підказки 7, 3, 8, 20
  assert.deepEqual(jan.extraItems.map((i) => i.key), ['B15.EXTRA.07.extra', 'B15.EXTRA.03.extra', 'B15.EXTRA.08.extra', 'B15.EXTRA.20.extra']);
  // Лютий 12–16–4–12–8: головна 4, протилежна 8 → 12 (один раз), 16; 8 не показується
  assert.deepEqual(m.months[1].extraItems.map((i) => i.key), ['B15.EXTRA.12.extra', 'B15.EXTRA.16.extra']);
  // Квітень 11–11–22–11–6: головна 22, протилежна 11 → лише 6
  assert.deepEqual(m.months[3].extraItems.map((i) => i.key), ['B15.EXTRA.06.extra']);
  // Збіг головної та протилежної → лише 11 полів
  const fake = buildMonthly(content, { d: 1, m: 1, y: 2000 }, 2027);
  for (const mo of fake.months) if (mo.sameEnergy) assert.equal(mo.oppositeItem, null);
});

test('Для будь-якої дати всі ключі існують (перебір)', { skip: !has }, () => {
  const today = new Date(2026, 10, 25);
  let checked = 0;
  for (let y = 1940; y <= 2026; y += 3) {
    for (let mo = 1; mo <= 12; mo++) {
      for (const d of [1, 7, 15, 16, 22, 23, 29, 31]) {
        if (validateInput({ d, m: mo, y }, 2027, today)) continue;
        for (const status of ['single', 'couple', 'unknown']) {
          const a = buildAnnual(content, { d, m: mo, y }, 2027, { status, hasChildren: true });
          assert.deepEqual(a.errors, [], `${d}.${mo}.${y}`);
        }
        assert.deepEqual(buildMonthly(content, { d, m: mo, y }, 2027).errors, []);
        checked++;
      }
    }
  }
  assert.ok(checked > 2000);
});

test('Відповідь містить період року та правило місяців', { skip: !has }, () => {
  const o = buildForecast(content, { birth: { d: 25, m: 10, y: 1990 }, year: 2027, plan: 'full' });
  assert.equal(o.yearPeriod.text, 'з 25 жовтня 2027 по 25 жовтня 2028');
  assert.equal(o.monthRule.shifted, true);
  assert.equal(o.monthRule.example, 'з 25 січня по 25 лютого');
  const early = buildForecast(content, { birth: { d: 10, m: 3, y: 1990 }, year: 2027, plan: 'full' });
  assert.equal(early.yearPeriod.text, 'з 10 березня 2027 по 10 березня 2028');
  assert.equal(early.monthRule.shifted, false);
  assert.equal(early.monthRule.example, 'з 1 січня по 31 січня');
});

test('Доступ: без оплати платні тексти не передаються', { skip: !has }, () => {
  const monthlyOnly = buildForecast(content, { birth: B, year: 2027, plan: 'monthly' });
  assert.ok(monthlyOnly.annual.cards.every((c) => c.locked && !c.items));
  assert.equal(monthlyOnly.monthly.months[5].items.length, 11);

  const annualOnly = buildForecast(content, { birth: B, year: 2027, plan: 'annual' });
  assert.ok(annualOnly.monthly.months.every((m) => m.locked && !m.items));

  const demo = buildForecast(content, { birth: B, year: 2027, plan: 'demo' });
  const s = JSON.stringify(demo);
  assert.ok(!s.includes('B02.role'), 'архетип закритий');
  assert.equal(demo.annual.cards[0].items.length, 1);
  assert.equal(demo.monthly.months[0].items.length, 1);
  assert.ok(demo.monthly.months.slice(1).every((m) => m.locked && !m.items));

  const unknownPlan = buildForecast(content, { birth: B, year: 2027, plan: 'hacker' });
  assert.equal(unknownPlan.annual.cards[1].locked, true);
});
