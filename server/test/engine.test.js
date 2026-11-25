// Контрольні приклади з документів замовниці (ТЗ №16 v1.1, схеми 2027, технічні сторінки баз 02–15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  R, validateInput, yearMatrix, segment, monthlyEnergies, personalMatrix, ageEnergy, agePair, agePeriods, monthPeriod, personalYearCode, yearPeriod, forecastAgePair,
} from '../engine.js';

const B = { d: 29, m: 7, y: 1989 };

test('R(): правило зведення', () => {
  assert.equal(R(22), 22);
  assert.equal(R(38), 11);
  assert.equal(R(29), 11);
  assert.equal(R(28), 10);
  assert.equal(R(26), 8);
  assert.equal(R(1), 1);
  assert.equal(R(99), 18);
  assert.throws(() => R(0));
});

test('Річна матриця 2027 — усі точки (ТЗ с. 3–5)', () => {
  const m = yearMatrix(B, 2027);
  assert.deepEqual(
    { t: m.t, CODE: m.CODE, A: m.A, B: m.B, V: m.V, G: m.G, C: m.C, D: m.D, E: m.E, Zh: m.Zh, Z: m.Z },
    { t: 11, CODE: 11, A: 22, B: 18, V: 20, G: 6, C: 12, D: 4, E: 11, Zh: 8, Z: 10 });
  assert.deepEqual(
    { M: m.M, L: m.L, K: m.K, N: m.N, O: m.O, MG: m.MG, V2: m.V2, B1: m.B1, B2: m.B2, DBS2: m.DBS2, DBS3: m.DBS3 },
    { M: 18, L: 5, K: 5, N: 5, O: 10, MG: 6, V2: 7, B1: 3, B2: 21, DBS2: 7, DBS3: 11 });
  assert.deepEqual(
    { SKY: m.SKY, EARTH: m.EARTH, MALE: m.MALE, FEMALE: m.FEMALE, PURPOSE: m.PURPOSE },
    { SKY: 6, EARTH: 6, MALE: 12, FEMALE: 21, PURPOSE: 9 });
});

test('Річна матриця 2026 — контроль (ТЗ, колонка 2026)', () => {
  const m = yearMatrix(B, 2026);
  assert.deepEqual(
    { t: m.t, CODE: m.CODE, A: m.A, B: m.B, V: m.V, G: m.G, C: m.C, D: m.D, E: m.E, Zh: m.Zh, Z: m.Z },
    { t: 10, CODE: 10, A: 21, B: 17, V: 19, G: 12, C: 15, D: 11, E: 9, Zh: 4, Z: 6 });
  assert.deepEqual(
    { M: m.M, L: m.L, K: m.K, N: m.N, O: m.O, MG: m.MG, V2: m.V2, B1: m.B1, B2: m.B2, DBS2: m.DBS2, DBS3: m.DBS3 },
    { M: 9, L: 7, K: 16, N: 7, O: 5, MG: 21, V2: 8, B1: 5, B2: 22, DBS2: 9, DBS3: 3 });
  assert.deepEqual(
    { SKY: m.SKY, EARTH: m.EARTH, MALE: m.MALE, FEMALE: m.FEMALE, PURPOSE: m.PURPOSE },
    { SKY: 11, EARTH: 4, MALE: 15, FEMALE: 15, PURPOSE: 9 });
});

test('Персональний код року', () => {
  assert.equal(personalYearCode(B, 2027), 11);
  assert.equal(personalYearCode(B, 2026), 10);
});

test('Відрізки зовнішнього кола 2027 (ТЗ с. 11)', () => {
  const m = yearMatrix(B, 2027);
  assert.deepEqual(segment(m.A, m.D), [7, 3, 11, 8, 20, 12, 16]);
  assert.deepEqual(segment(m.D, m.B), [12, 8, 3, 22, 8, 4, 22]);
  assert.deepEqual(segment(m.B, m.E), [11, 11, 22, 11, 6, 22, 6]);
  assert.deepEqual(segment(m.E, m.V), [8, 15, 19, 4, 10, 6, 8]);
  assert.deepEqual(segment(m.V, m.Zh), [5, 3, 13, 10, 10, 18, 8]);
  assert.deepEqual(segment(m.Zh, m.G), [3, 22, 9, 14, 7, 20, 8]);
  assert.deepEqual(segment(m.G, m.Z), [10, 22, 11, 16, 6, 8, 18]);
  assert.deepEqual(segment(m.Z, m.A), [7, 15, 20, 5, 14, 9, 4]);
});

// База №15, с. 46: групи та протилежні для обох років.
const GROUPS = {
  2026: [
    [[11, 8, 13, 5, 21], 11], [[16, 9, 11, 5, 21], 4], [[4, 10, 19, 9, 8], 8], [[6, 7, 15, 8, 7], 21],
    [[17, 8, 9, 10, 19], 6], [[11, 10, 21, 11, 3], 12], [[7, 6, 11, 5, 14], 13], [[9, 13, 4, 6, 20], 11],
    [[9, 16, 8, 10, 22], 19], [[15, 3, 21, 18, 6], 15], [[6, 12, 6, 21, 15], 9], [[6, 9, 12, 3, 6], 21],
  ],
  2027: [
    [[7, 3, 11, 8, 20], 13], [[12, 16, 4, 12, 8], 8], [[3, 22, 8, 4, 22], 7], [[11, 11, 22, 11, 6], 11],
    [[22, 6, 11, 8, 15], 10], [[19, 4, 10, 6, 8], 14], [[5, 3, 13, 10, 10], 11], [[18, 8, 8, 3, 22], 4],
    [[9, 14, 7, 20, 8], 8], [[10, 22, 11, 16, 6], 22], [[8, 18, 10, 7, 15], 11], [[20, 5, 14, 9, 4], 10],
  ],
};
// ТЗ с. 13: головна / протилежна.
const MAIN_OPP = {
  2026: [[13, 11], [11, 4], [19, 8], [15, 21], [9, 6], [21, 12], [11, 13], [4, 11], [8, 19], [21, 15], [6, 9], [12, 21]],
  2027: [[11, 13], [4, 8], [8, 7], [22, 11], [11, 10], [10, 14], [13, 11], [8, 4], [7, 8], [11, 22], [10, 11], [14, 10]],
};

for (const year of [2026, 2027]) {
  test(`Помісячна: 12 груп і протилежні ${year} (база №15, с. 46; ТЗ с. 13)`, () => {
    const months = monthlyEnergies(yearMatrix(B, year));
    assert.equal(months.length, 12);
    months.forEach((mo, i) => {
      assert.deepEqual(mo.group, GROUPS[year][i][0], `${mo.name}: група`);
      assert.equal(mo.opposite, GROUPS[year][i][1], `${mo.name}: протилежна`);
      assert.deepEqual([mo.main, mo.opposite], MAIN_OPP[year][i], `${mo.name}: головна/протилежна`);
    });
  });
}

test('Особиста матриця та вікові енергії (ТЗ с. 5–6)', () => {
  const pm = personalMatrix(B);
  assert.deepEqual(pm, { A: 11, B: 7, V: 9, G: 9, D: 18, E: 16, Zh: 18, Z: 20 });
  // 30–40: 16 → 9
  assert.deepEqual(segment(pm.E, pm.V), [21, 5, 12, 7, 5, 16, 7]);
  assert.deepEqual(ageEnergy(pm, 31), { value: 21, label: '31–32' });
  assert.deepEqual(ageEnergy(pm, 32), { value: 5, label: '32–33' });
  assert.deepEqual(ageEnergy(pm, 33), { value: 12, label: '33–34' });
  assert.deepEqual(ageEnergy(pm, 36), { value: 5, label: '36–37' });
  assert.deepEqual(ageEnergy(pm, 37), { value: 16, label: '37–38' });
  assert.deepEqual(ageEnergy(pm, 38), { value: 7, label: '38–39' });
  // Контрольна пара 37–38 ↔ 77–78: 16 і 15
  const p = agePair(pm, 37);
  assert.equal(p.first.value, 16);
  assert.equal(p.opposite.value, 15);
  assert.equal(p.opposite.label, '77–78');
  // Строгий режим: незатверджені межі ТЗ не вигадуються
  for (const a of [30, 34, 35, 39, 0, 80]) assert.equal(ageEnergy(pm, a, { strict: true }).pending, true, `вік ${a}`);
  // Тимчасове заповнення (позначене provisional)
  assert.deepEqual(ageEnergy(pm, 30), { value: 16, label: '30–31', provisional: true }); // точка Е
  assert.deepEqual(ageEnergy(pm, 34), { value: 7, label: '34–35', provisional: true }); // «35»
  assert.deepEqual(ageEnergy(pm, 35), { value: 7, label: '35–36', provisional: true }); // «35»
  assert.deepEqual(ageEnergy(pm, 39), { value: 7, label: '39–40', provisional: true }); // «38–39»
  assert.equal(ageEnergy(pm, 80).value, pm.A);
  assert.equal(ageEnergy(pm, 37).provisional, undefined, 'затверджені межі без позначки');
});

test('Вікова пара за правилом «рік від дня народження»: 25.08.2000 / 2027', () => {
  const p = forecastAgePair({ d: 25, m: 8, y: 2000 }, 2027);
  assert.equal(p.age, 27);
  assert.deepEqual(p.first, { value: 10, label: '27–28' });     // 20–30: Б 8 → Е 10, позиція «27–28»
  assert.equal(p.opposite.age, 67);
  assert.equal(p.opposite.value, 11);                            // 60–70: Г 17 → З 6, позиція «67–68»
  assert.equal(p.opposite.label, '67–68');
  const q = forecastAgePair(B, 2027);                             // 29.07.1989 → 38 років
  assert.deepEqual([q.first.value, q.opposite.value], [7, 8]);
});

test('Вікові відрізки 2027 для 29.07.1989', () => {
  const { periods } = agePeriods(B, 2027);
  assert.equal(periods.length, 2);
  assert.equal(periods[0].from, '01.01.2027');
  assert.equal(periods[0].to, '28.07.2027');
  assert.equal(periods[0].age, 37);
  assert.equal(periods[1].from, '29.07.2027');
  assert.equal(periods[1].age, 38);
});

test('Перевірка дати (ТЗ, розділ 12)', () => {
  const today = new Date(2026, 10, 25);
  assert.equal(validateInput(B, 2027, today), null);
  assert.match(validateInput({ d: 29, m: 2, y: 1990 }, 2027, today), /не існує/);
  assert.equal(validateInput({ d: 29, m: 2, y: 1988 }, 2027, today), null);
  assert.match(validateInput({ d: 31, m: 4, y: 1990 }, 2027, today), /не існує/);
  assert.match(validateInput({ d: 1, m: 1, y: 2030 }, 2031, today), /майбутньому/);
  assert.match(validateInput({ d: 1, m: 1, y: 2000 }, 1999, today), /раніше/);
});

test('Контрольні приклади баз 02–14', () => {
  for (const [year, exp] of [
    [2026, { A: 21, B: 17, C: 15, G: 12, V: 19, V2: 8, L: 7, K: 16, O: 5, M: 9, N: 7, B2: 22, B1: 5, DBS2: 9, DBS3: 3, MALE: 15, FEMALE: 15, SKY: 11, EARTH: 4, PURPOSE: 9 }],
    [2027, { A: 22, B: 18, C: 12, G: 6, V: 20, V2: 7, L: 5, K: 5, O: 10, M: 18, N: 5, B2: 21, B1: 3, DBS2: 7, DBS3: 11, MALE: 12, FEMALE: 21, SKY: 6, EARTH: 6, PURPOSE: 9 }],
  ]) {
    const m = yearMatrix(B, year);
    for (const [k, v] of Object.entries(exp)) assert.equal(m[k], v, `${year} ${k}`);
  }
});

test('Період місяця: правило «після 15-го» та календарний варіант', () => {
  const p = monthPeriod({ d: 25, m: 8, y: 1995 }, 2027, 8);
  assert.deepEqual([p.from, p.to, p.shifted], [{ y: 2027, m: 8, d: 25 }, { y: 2027, m: 9, d: 25 }, true]);
  const dec = monthPeriod({ d: 25, m: 8, y: 1995 }, 2027, 12);
  assert.deepEqual(dec.to, { y: 2028, m: 1, d: 25 });
  const jan31 = monthPeriod({ d: 31, m: 1, y: 1995 }, 2027, 1);
  assert.deepEqual([jan31.from.d, jan31.to], [31, { y: 2027, m: 2, d: 28 }]);
  const d15 = monthPeriod({ d: 15, m: 3, y: 1995 }, 2027, 4);
  assert.deepEqual([d15.from.d, d15.to.d, d15.shifted], [1, 30, false]);
  const cal = monthPeriod({ d: 25, m: 8, y: 1995 }, 2027, 8, 'calendar');
  assert.deepEqual([cal.from.d, cal.to.d], [1, 31]);
});

test('Період року: з дня народження до того ж дня наступного року', () => {
  assert.deepEqual(yearPeriod({ d: 25, m: 10, y: 1990 }, 2027), { from: { y: 2027, m: 10, d: 25 }, to: { y: 2028, m: 10, d: 25 } });
  assert.deepEqual(yearPeriod({ d: 1, m: 1, y: 1990 }, 2027), { from: { y: 2027, m: 1, d: 1 }, to: { y: 2028, m: 1, d: 1 } });
  assert.deepEqual(yearPeriod({ d: 29, m: 2, y: 1988 }, 2027), { from: { y: 2027, m: 2, d: 28 }, to: { y: 2028, m: 2, d: 29 } });
});

test('Детермінованість: однакові дані — однаковий результат', () => {
  assert.deepEqual(yearMatrix(B, 2027), yearMatrix(B, 2027));
  assert.deepEqual(monthlyEnergies(yearMatrix(B, 2027)), monthlyEnergies(yearMatrix(B, 2027)));
});

test('Усі значення завжди в межах 1–22 (перебір дат 1940–2026)', () => {
  for (let y = 1940; y <= 2026; y += 1) {
    for (let mo = 1; mo <= 12; mo++) {
      for (const d of [1, 9, 15, 22, 23, 28, 29, 31]) {
        if (validateInput({ d, m: mo, y }, 2027, new Date(2026, 10, 25))) continue;
        const mx = yearMatrix({ d, m: mo, y }, 2027);
        for (const [k, v] of Object.entries(mx)) if (k !== 'year') assert.ok(v >= 1 && v <= 22, `${d}.${mo}.${y} ${k}=${v}`);
        for (const mm of monthlyEnergies(mx)) for (const v of [...mm.group, mm.opposite]) assert.ok(v >= 1 && v <= 22);
      }
    }
  }
});
