// Збірка прогнозу з готових авторських текстів за точними ключами (ТЗ №16 v1.1, розділи 06, 08, 10).
// Жодної генерації: якщо ключа немає — помилка в журналі, розділ не підміняється іншим арканом.
import {
  yearMatrix, monthlyEnergies, monthPeriod, yearPeriod, forecastAgePair, MONTHS_UA,
} from './engine.js';

const nn = (n) => String(n).padStart(2, '0');

export const PLANS = {
  demo: { annual: 'demo', monthly: 'demo', call: false },
  annual: { annual: true, monthly: false, call: false },
  monthly: { annual: false, monthly: true, call: false },
  full: { annual: true, monthly: true, call: false },
  vip: { annual: true, monthly: true, call: true },
};

export const PRICES = { annual: 799, monthly: 399, full: 999, vip: 1799 };

export const DISCLAIMER = 'Прогностика є символічним нумерологічним матеріалом для самодослідження та планування. '
  + 'Вона не гарантує подій і не замінює медичну, фінансову чи юридичну консультацію.';

class Picker {
  constructor(content) {
    this.records = content.records;
    this.errors = [];
  }

  /** Запис за точним ключем або null + помилка. Виключені записи (EXTRA) не видаються. */
  get(key) {
    const r = this.records[key];
    if (!r) { this.errors.push(`немає ключа ${key}`); return null; }
    return r;
  }

  item(key, extra = {}) {
    const r = this.get(key);
    if (!r) return null;
    const it = { key, title: r.title, number: r.arcana, ...extra };
    if (r.sections) it.sections = r.sections; else it.paras = r.paras;
    return it;
  }
}

const compact = (arr) => arr.filter(Boolean);

/** Річний прогноз: 6 карток (ТЗ розділ 06). */
export function buildAnnual(content, birth, year, { status = 'unknown', hasChildren = null } = {}) {
  const mx = yearMatrix(birth, year);
  const p = new Picker(content);
  const k = (base, field, num, variant = 'default') => `${base}.${field}.${nn(num)}.${variant}`;

  // База №1: три енергії (ТЗ, розділ 06 і технічна сторінка бази №1) — персональна енергія року,
  // перша вікова та протилежна вікова. Однакові числа об'єднуються, текст не повторюється.
  const pair = forecastAgePair(birth, year);
  const energies = [];
  for (const e of [
    { role: 'Енергія року', n: mx.CODE },
    { role: `Вікова енергія (${pair.first.label} років)`, n: pair.first.value, provisional: pair.first.provisional },
    { role: `Протилежна вікова енергія (${pair.opposite.label} років)`, n: pair.opposite.value, provisional: pair.opposite.provisional },
  ]) {
    const same = energies.find((x) => x.n === e.n);
    if (same) { same.label += ' та ' + e.role[0].toLowerCase() + e.role.slice(1); same.provisional ||= e.provisional; }
    else energies.push({ n: e.n, label: e.role, provisional: !!e.provisional });
  }
  // Тексти бази №1 ідуть підряд під одним заголовком; підпис ролей і віків не показуємо (рішення авторки),
  // лише одна фраза «Головні енергії року» над першим текстом розділу.
  const MAIN_ENERGIES = 'Головні енергії року';
  const b01 = (field, first = true) => energies.map((e, i) => p.item(k('B01', field, e.n),
    { nodes: ['CODE'], ...(first && i === 0 ? { label: MAIN_ENERGIES } : {}) }));

  // B07: статус стосунків. unknown → обидві підписані версії під кожним заголовком.
  const relVariants = status === 'single' ? ['single'] : status === 'couple' ? ['couple'] : ['single', 'couple'];
  const relLabel = { single: 'Якщо Ви зараз без пари', couple: 'Якщо Ви у парі' };
  const rel = [];
  for (const pt of ['M', 'N', 'K']) {
    const group = relVariants.map((v) => {
      const it = p.item(k('B07', pt, mx[pt], v), { nodes: [pt] });
      if (it && relVariants.length > 1) it.label = relLabel[v];
      return it;
    });
    rel.push(...compact(group));
  }

  const cards = [
    {
      id: 'general', title: 'Що принесе Вам 2027 рік',
      desc: 'Головна тема року, можливі події, позитивні та складні сценарії',
      items: compact([
        ...['theme', 'task', 'positive', 'negative'].flatMap((f) => b01(f, f === 'theme')),
        p.item(k('B04', 'karma', mx.G), { nodes: ['G'] }),
      ]),
    },
    {
      id: 'archetype', title: 'Як Вам варто діяти цього року',
      desc: 'Ваші сильні сторони, таланти та як використати свої можливості',
      items: compact([
        p.item(k('B02', 'role', mx.A), { nodes: ['A'] }),
        p.item(k('B02', 'action', mx.B), { nodes: ['B'] }),
        p.item(k('B02', 'support', mx.C), { nodes: ['C'] }),
        p.item(k('B08', 'B', mx.B), { nodes: ['B'] }),
        p.item(k('B08', 'B2', mx.B2), { nodes: ['B2'] }),
        p.item(k('B08', 'B1', mx.B1), { nodes: ['B1'] }),
      ]),
    },
    {
      id: 'finance', title: 'Гроші, робота та реалізація',
      desc: 'Можливості для заробітку, професійного розвитку та фінансові помилки',
      items: compact([
        p.item(k('B05', 'beliefs', mx.V), { nodes: ['V'] }),
        p.item(k('B05', 'mechanism', mx.V2), { nodes: ['V2'] }),
        p.item(k('B05', 'correction', mx.L), { nodes: ['L'] }),
        p.item(k('B06', 'K', mx.K), { nodes: ['K'] }),
        p.item(k('B06', 'O', mx.O), { nodes: ['O'] }),
        p.item(k('B06', 'L', mx.L), { nodes: ['L'] }),
        p.item(k('B14', 'goal', mx.EARTH), { nodes: ['A', 'V'] }),
        p.item(k('B14', 'risks', mx.EARTH), { nodes: ['A', 'V'] }),
        p.item(k('B14', 'practice', mx.EARTH), { nodes: ['A', 'V'] }),
      ]),
    },
    {
      id: 'personal', title: 'Кохання та стосунки',
      desc: 'Можливі зміни в особистому житті, знайомства та розвиток стосунків',
      ask: ['status', 'children'],
      items: compact([
        ...rel,
        p.item(k('B09', 'A', mx.A), { nodes: ['A'] }),
        p.item(k('B09', 'DBS2', mx.DBS2), { nodes: ['DBS2'] }),
        p.item(k('B09', 'DBS3', mx.DBS3), { nodes: ['DBS3'] }),
        hasChildren === true ? p.item(k('B09', 'DBS3', mx.DBS3, 'has_children_addon'), { nodes: ['DBS3'] }) : null,
        p.item(k('B11', 'FEMALE', mx.FEMALE), { nodes: ['E', 'Z'], title: 'Як цінувати себе та приймати підтримку' }),
      ]),
    },
    {
      id: 'health', title: 'Самопочуття та відновлення',
      desc: 'Як краще розподіляти сили, уникати перевантаження та відновлюватися',
      items: compact([
        ...b01('wellbeing'),
        p.item(k('B03', 'comfort', mx.C), { nodes: ['C'] }),
      ]),
    },
    {
      id: 'recommendations', title: 'Головні рекомендації на рік',
      desc: 'Головні рекомендації, завдання та пріоритети року',
      items: compact([
        ...b01('attention'),
        p.item(k('B10', 'MALE', mx.MALE), { nodes: ['D', 'Zh'], title: 'Що допоможе Вам діяти впевненіше та досягати бажаного' }),
        p.item(k('B13', 'awareness', mx.SKY), { nodes: ['B', 'G'] }),
        p.item(k('B13', 'beliefs', mx.SKY), { nodes: ['B', 'G'] }),
        p.item(k('B13', 'practice', mx.SKY), { nodes: ['B', 'G'] }),
        p.item(k('B12', 'goal', mx.PURPOSE), { nodes: ['PURPOSE'] }),
        p.item(k('B12', 'obstacles', mx.PURPOSE), { nodes: ['PURPOSE'] }),
        p.item(k('B12', 'action', mx.PURPOSE), { nodes: ['PURPOSE'] }),
      ]),
    },
  ];

  return {
    year, matrix: mx, cards,
    // Вік у році прогнозу та вікова пара. provisional — межу заповнено тимчасово, до підтвердження авторкою.
    agePair: pair,
    errors: p.errors,
  };
}

const fmtDate = (x) => `${x.d} ${['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'][x.m - 1]}`;

/** Помісячний прогноз: 12 місяців, головна + протилежна (ТЗ розділ 10). */
export function buildMonthly(content, birth, year, { periodMode = 'birthday_after_15' } = {}) {
  const mx = yearMatrix(birth, year);
  const p = new Picker(content);
  const FIELDS = ['theme', 'events', 'finance', 'work', 'relations', 'emotion', 'wellbeing', 'positive', 'negative', 'rhythm', 'recommendation'];
  const months = monthlyEnergies(mx).map((mo) => {
    const per = monthPeriod(birth, year, mo.month, periodMode);
    const items = compact(FIELDS.map((f) => p.item(`B15.MAIN.${nn(mo.main)}.${f}`)));
    const opposite = mo.opposite === mo.main ? null : p.item(`B15.OPPOSITE.${nn(mo.opposite)}.opposite`);
    // Коротка підказка (база №15, с. 45): позиції 1, 2, 4, 5 групи; повтори — один раз;
    // число, що вже є головним або протилежним, не показується.
    const extraNums = [];
    for (const n of [mo.group[0], mo.group[1], mo.group[3], mo.group[4]]) {
      if (n !== mo.main && n !== mo.opposite && !extraNums.includes(n)) extraNums.push(n);
    }
    const extraItems = compact(extraNums.map((n) => p.item(`B15.EXTRA.${nn(n)}.extra`)));
    return {
      month: mo.month, name: mo.name, group: mo.group, main: mo.main, opposite: mo.opposite,
      sameEnergy: mo.opposite === mo.main,
      period: { ...per, text: `з ${fmtDate(per.from)} по ${fmtDate(per.to)}${per.to.y !== year ? ` ${per.to.y}` : ''}` },
      items, oppositeItem: opposite, extraItems,
    };
  });
  return { year, months, errors: p.errors };
}

/** Відповідь клієнту з урахуванням доступу. Платні тексти без доступу не передаються. */
export function buildForecast(content, { birth, year, plan = 'demo', status, hasChildren, periodMode }) {
  const access = PLANS[plan] ?? PLANS.demo;
  const annual = buildAnnual(content, birth, year, { status, hasChildren });
  const monthly = buildMonthly(content, birth, year, { periodMode });
  const yp = yearPeriod(birth, year);
  const shifted = periodMode !== 'calendar' && birth.d > 15;
  const out = {
    plan, access, year, contentVersion: content.version, disclaimer: DISCLAIMER,
    matrix: annual.matrix,
    // Правила дії — показувати людині завжди (головна, рік, місяць, підказка).
    yearPeriod: { ...yp, text: `з ${fmtDate(yp.from)} ${yp.from.y} по ${fmtDate(yp.to)} ${yp.to.y}` },
    monthRule: {
      shifted, day: shifted ? birth.d : 1,
      text: shifted
        ? `Кожен місяць діє з ${birth.d}-го числа по ${birth.d}-те число наступного місяця`
        : 'Кожен місяць діє з 1-го до останнього числа',
      example: monthly.months[0].period.text,
    },
    errors: [...annual.errors, ...monthly.errors],
  };

  if (access.annual === true) {
    out.annual = { cards: annual.cards, agePair: annual.agePair };
  } else if (access.annual === 'demo') {
    // Демо: лише головна тема за персональним кодом року; решта — замок.
    out.annual = {
      cards: annual.cards.map((c) => (c.id === 'general'
        ? { ...c, items: c.items.slice(0, 1), lockedRest: true }
        : { id: c.id, title: c.title, desc: c.desc, locked: true })),
    };
  } else {
    out.annual = { cards: annual.cards.map((c) => ({ id: c.id, title: c.title, desc: c.desc, locked: true })) };
  }

  const strip = (m) => ({ month: m.month, name: m.name, period: m.period, locked: true });
  if (access.monthly === true) {
    out.monthly = { months: monthly.months };
  } else if (access.monthly === 'demo') {
    // Демо: січень — лише фрагмент «Робота» (готовий повний фрагмент з бази №15).
    out.monthly = {
      months: monthly.months.map((m, i) => (i === 0
        ? { ...m, items: m.items.filter((it) => it.key.endsWith('.work')), oppositeItem: null, extraItems: [], lockedRest: true }
        : strip(m))),
    };
  } else {
    out.monthly = { months: monthly.months.map(strip) };
  }
  out.call = access.call;
  return out;
}

export { MONTHS_UA };
