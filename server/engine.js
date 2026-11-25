// Розрахунок річної та помісячної прогностики за ТЗ №16 v1.1 (методологія Аліни Грицаєнко).
// Лише арифметика: жодного ШІ, жодної випадковості. Однакові вхідні дані → однаковий результат.

/** Сума цифр числа. */
export function digitSum(n) {
  return String(n).split('').reduce((s, c) => s + Number(c), 0);
}

/** R(n): 1–22 залишаємо; якщо більше 22 — додаємо цифри, поки не стане 1–22. 22 не змінюємо. */
export function R(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`R(): очікується ціле додатне число, отримано ${n}`);
  while (n > 22) n = digitSum(n);
  return n;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Перевірка дати народження і року прогнозу. Повертає null або текст помилки. */
export function validateInput({ d, m, y }, year, today = new Date()) {
  if (![d, m, y, year].every(Number.isInteger)) return 'Дата має складатися з цілих чисел';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return 'Такої дати не існує';
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (dt.getTime() > t) return 'Дата народження не може бути в майбутньому';
  if (year < y) return 'Рік прогнозу не може бути раніше за рік народження';
  return null;
}

/** Вихідні числа: d, m, y — зведені день, місяць, сума цифр року; t — зведена сума цифр року прогнозу. */
export function baseNumbers({ d, m, y }, year) {
  return { d: R(d), m: R(m), y: R(digitSum(y)), t: R(digitSum(year)) };
}

/** Персональний код року = R(d + m + y + t). */
export function personalYearCode(birth, year) {
  const b = baseNumbers(birth, year);
  return R(b.d + b.m + b.y + b.t);
}

/** Річна матриця обраного року (розділи 03–04 ТЗ). Ключі — технічні ID із ТЗ. */
export function yearMatrix(birth, year) {
  const { d, m, y, t } = baseNumbers(birth, year);
  const A = R(d + t), B = R(m + t), V = R(y + t);
  const G = R(A + B + V);
  const C = R(A + B + V + G); // ЗК — центр
  const D = R(A + B), E = R(B + V), Zh = R(V + G), Z = R(A + G);
  const M = R(C + G), L = R(C + V);
  const K = R(M + L), N = R(M + K), O = R(K + L);
  const MG = R(M + G), V2 = R(V + L);
  const B1 = R(B + C), B2 = R(B + B1);
  const DBS2 = R(A + C), DBS3 = R(A + DBS2);
  const SKY = R(B + G), EARTH = R(A + V), MALE = R(D + Zh), FEMALE = R(E + Z);
  const PURPOSE = R(SKY + EARTH + MALE + FEMALE); // зводимо лише кінцеву суму
  const CODE = R(d + m + y + t);
  return { year, t, CODE, A, B, V, G, C, D, E, Zh, Z, M, L, K, N, O, MG, V2, B1, B2, DBS2, DBS3, SKY, EARTH, MALE, FEMALE, PURPOSE };
}

/** Сім чисел між сусідніми точками X → Y (спільний алгоритм для місяців і вікового кола). */
export function segment(X, Y) {
  const p4 = R(X + Y);
  const p2 = R(X + p4), p6 = R(p4 + Y);
  const p1 = R(X + p2), p3 = R(p2 + p4), p5 = R(p4 + p6), p7 = R(p6 + Y);
  return [p1, p2, p3, p4, p5, p6, p7];
}

export const MONTHS_UA = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

/** 12 місяців: група з 5 чисел, головна (3-тє число) і протилежна (головна через 6 місяців). */
export function monthlyEnergies(mx) {
  const quarters = [[mx.A, mx.D, mx.B], [mx.B, mx.E, mx.V], [mx.V, mx.Zh, mx.G], [mx.G, mx.Z, mx.A]];
  const groups = [];
  for (const [p0, corner, p1] of quarters) {
    const nums = [...segment(p0, corner), corner, ...segment(corner, p1)]; // 15 чисел
    for (let i = 0; i < 3; i++) groups.push(nums.slice(i * 5, i * 5 + 5));
  }
  return groups.map((group, i) => ({
    month: i + 1,
    name: MONTHS_UA[i],
    group,
    main: group[2],
    opposite: groups[(i + 6) % 12][2],
  }));
}

/** Особиста матриця народження (без числа року) — для вікових енергій. */
export function personalMatrix(birth) {
  const d = R(birth.d), m = R(birth.m), y = R(digitSum(birth.y));
  const A = d, B = m, V = y, G = R(A + B + V);
  return { A, B, V, G, D: R(A + B), E: R(B + V), Zh: R(V + G), Z: R(A + G) };
}

// Вікове коло: точки кожні 10 років. Підписи між ними — за ТЗ (с. 6).
const DECADE_POINTS = ['A', 'D', 'B', 'E', 'V', 'Zh', 'G', 'Z', 'A']; // 0,10,…,80
// Затверджені підписи всередині десятиліття: зсув віку → позиція p1…p7.
// Зсуви 0, 4, 5, 9 (наприклад 30–31, 34–35, 35–36, 39–40) у ТЗ не визначені — не вигадуємо.
const OFFSET_TO_POS = { 1: 0, 2: 1, 3: 2, 6: 4, 7: 5, 8: 6 };
const POS_LABEL = ['1–2', '2–3', '3–4', '5', '6–7', '7–8', '8–9'];

// ТИМЧАСОВЕ заповнення незатверджених проміжків (до підтвердження авторкою; змінюється тут):
//   зсув 0 (30–31)  → сама десятирічна точка (30);
//   зсуви 4, 5 (34–35, 35–36) → середина «35» (p4);
//   зсув 9 (39–40)  → останнє проміжне число «38–39» (p7);
//   вік 80+ → коло починається знову (вік − 80).
const PROVISIONAL_OFFSET = { 0: 'point', 4: 3, 5: 3, 9: 6 };

/**
 * Енергія вікового кола для повних років age.
 * strict=true — лише затверджені підписи ТЗ, інакше {pending}. За замовчуванням — з тимчасовим заповненням (provisional: true).
 */
export function ageEnergy(pm, age, { strict = false } = {}) {
  if (!Number.isInteger(age) || age < 0) throw new Error('age');
  const lbl = (a) => `${a}–${a + 1}`;
  if (age >= 80) {
    if (strict) return { pending: true, reason: 'вік від 80 років не затверджено' };
    return { ...ageEnergy(pm, age % 80), label: lbl(age), provisional: true };
  }
  const dec = Math.floor(age / 10), off = age % 10;
  const seg = segment(pm[DECADE_POINTS[dec]], pm[DECADE_POINTS[dec + 1]]);
  const pos = OFFSET_TO_POS[off];
  if (pos !== undefined) {
    return { value: seg[pos], label: POS_LABEL[pos].split('–').map((x) => String(dec * 10 + Number(x))).join('–') };
  }
  if (strict) return { pending: true, reason: `межу ${lbl(age)} не затверджено` };
  const fill = PROVISIONAL_OFFSET[off];
  const value = fill === 'point' ? pm[DECADE_POINTS[dec]] : seg[fill];
  return { value, label: lbl(age), provisional: true };
}

/** Пара вікових енергій: перша + протилежна (вік ±40 на колі 0–80). */
export function agePair(pm, age, opts = {}) {
  const first = ageEnergy(pm, age, opts);
  if (age >= 80 && opts.strict) return { age, first, opposite: { pending: true, reason: 'вік від 80 років не затверджено' } };
  const a = age % 80;
  const oppAge = a < 40 ? a + 40 : a - 40;
  return { age, first, opposite: { ...ageEnergy(pm, oppAge, opts), age: oppAge } };
}

/**
 * Вікова пара для річного прогнозу за правилом «рік діє від дня народження»:
 * у межах такого року вік не змінюється — вік, якого людина досягає в день народження року прогнозу.
 */
export function forecastAgePair(birth, year) {
  const pm = personalMatrix(birth);
  return agePair(pm, year - birth.y);
}

/** Відрізки року з різним віком (день народження ділить рік на дві частини). */
export function agePeriods(birth, year) {
  const pm = personalMatrix(birth);
  const leap = (yy) => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
  let bd = { m: birth.m, d: birth.d }, note = null;
  if (birth.m === 2 && birth.d === 29 && !leap(year)) {
    bd = { m: 3, d: 1 };
    note = 'день народження 29.02 у невисокосному році: межу не затверджено (тимчасово 01.03)';
  }
  const fmt = (m, d) => `${pad2(d)}.${pad2(m)}.${year}`;
  const periods = [];
  const before = year - birth.y - 1, after = year - birth.y;
  const startsJan1 = bd.m === 1 && bd.d === 1;
  if (!startsJan1 && before >= 0) {
    const end = new Date(Date.UTC(year, bd.m - 1, bd.d - 1));
    periods.push({ from: fmt(1, 1), to: fmt(end.getUTCMonth() + 1, end.getUTCDate()), ...agePair(pm, before) });
  }
  periods.push({ from: startsJan1 ? fmt(1, 1) : fmt(bd.m, bd.d), to: fmt(12, 31), ...agePair(pm, after) });
  return { periods, note };
}

/**
 * Період дії річного прогнозу — правило замовниці (у PDF не описане):
 * рік діє з дня народження в році прогнозу до того ж дня наступного року.
 * 29.02 у невисокосному році → 28.02 (так само, як для місяців).
 */
export function yearPeriod(birth, year) {
  const days = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return {
    from: { y: year, m: birth.m, d: Math.min(birth.d, days(year, birth.m)) },
    to: { y: year + 1, m: birth.m, d: Math.min(birth.d, days(year + 1, birth.m)) },
  };
}

/**
 * Період дії помісячного прогнозу.
 * mode 'birthday_after_15' — правило замовниці: народжені після 15-го → з дня народження до того ж дня наступного місяця.
 * mode 'calendar' — робочий варіант із PDF №15 / ТЗ: від 1-го до останнього числа.
 */
export function monthPeriod(birth, year, month, mode = 'birthday_after_15') {
  const days = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (mode === 'calendar' || birth.d <= 15) {
    return { from: { y: year, m: month, d: 1 }, to: { y: year, m: month, d: days(year, month) }, shifted: false };
  }
  const ny = month === 12 ? year + 1 : year, nm = month === 12 ? 1 : month + 1;
  return {
    from: { y: year, m: month, d: Math.min(birth.d, days(year, month)) },
    to: { y: ny, m: nm, d: Math.min(birth.d, days(ny, nm)) },
    shifted: true,
  };
}
