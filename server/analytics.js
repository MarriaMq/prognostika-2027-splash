// Аналітика: каталог подій, перевірка Telegram initData, локальна база (SQLite),
// зведення «по людях» і «по оплатах» та рядки для Google Таблиці. Без зовнішніх залежностей.
//
// Хто є хто:
//   tg_id       — Telegram ID; у застосунку береться ЛИШЕ з перевіреного initData, у бота й оплат — із сервера.
//   visitor_id  — випадковий ідентифікатор браузера (лендинг або застосунок поза Telegram).
//   order_id    — номер замовлення платіжної системи.
// Звʼязок лендинг → бот: після оплати людина йде в t.me/<бот>?start=o_<order_id> (або v_<visitor_id> без оплати),
// бот надсилає подію bot_start зі start_param — і анонімний відвідувач зливається з Telegram-профілем.
import { DatabaseSync } from 'node:sqlite';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const PLAN_IDS = ['annual', 'monthly', 'full', 'vip'];
export const PLAN_NAMES = { annual: 'Річний', monthly: 'Місячний', full: 'Повний', vip: 'VIP', demo: 'Демо' };
const PLAN_RANK = { monthly: 1, annual: 2, full: 3, vip: 4 };
export const CARD_NAMES = {
  general: 'Що принесе 2027', archetype: 'Як діяти', finance: 'Гроші та робота',
  personal: 'Кохання та стосунки', health: 'Самопочуття', recommendations: 'Рекомендації',
};
export const MONTH_NAMES = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

const str = (max) => ({ t: 'str', max });
const int = (min, max) => ({ t: 'int', min, max });
const bool = { t: 'bool' };
const oneOf = (...v) => ({ t: 'enum', v });
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const UTM = {
  utm_source: str(64), utm_medium: str(64), utm_campaign: str(64), utm_content: str(64), utm_term: str(64),
  referrer: str(100), path: str(100),
};
const PAY = { plan: oneOf(...PLAN_IDS), amount: int(0, 1_000_000), currency: str(3), provider: str(20) };

/**
 * Каталог подій. src: landing — браузер лендингу (анонімно), app — міні-застосунок, server — бот і оплати (лише з ключем).
 * Усе, чого немає в каталозі, відкидається; зайві й криві поля теж.
 */
export const EVENTS = {
  // ── Лендинг ──
  landing_view: { src: 'landing', title: 'Відкрив лендинг', props: UTM },
  landing_click: { src: 'landing', title: 'Клік на лендингу', props: { target: str(40) } },
  tariff_click: { src: 'landing', title: 'Обрав тариф', props: { plan: oneOf(...PLAN_IDS) } },
  checkout_start: { src: 'landing', title: 'Натиснув «Оплатити»', props: { plan: oneOf(...PLAN_IDS) } },
  bot_link_click: { src: 'landing', title: 'Перейшов у бота з лендингу', props: { target: str(40) } },

  // ── Оплати (з вебхука платіжної системи на сервері сайту) ──
  payment_created: { src: 'server', title: 'Створено замовлення', props: PAY },
  payment_success: { src: 'server', title: 'Оплата успішна', props: PAY },
  payment_failed: { src: 'server', title: 'Оплата не вдалася', props: { ...PAY, reason: str(80) } },
  payment_refunded: { src: 'server', title: 'Повернення коштів', props: PAY },

  // ── Бот ──
  bot_start: { src: 'server', title: 'Запустив бота', props: { start_param: str(64) } },
  bot_message: { src: 'server', title: 'Написав боту', props: { kind: str(30) } },
  bot_button: { src: 'server', title: 'Натиснув кнопку в боті', props: { button: str(40) } },
  bot_sent: { src: 'server', title: 'Бот надіслав повідомлення', props: { kind: str(40) } },
  bot_blocked: { src: 'server', title: 'Заблокував бота', props: {} },
  bot_unblocked: { src: 'server', title: 'Розблокував бота', props: {} },
  access_granted: { src: 'server', title: 'Відкрито доступ', props: { plan: oneOf(...PLAN_IDS) } },

  // ── Міні-застосунок ──
  app_open: { src: 'app', title: 'Відкрив застосунок', props: { platform: str(20), tg_version: str(10), start_param: str(64), returning: bool } },
  splash_skip: { src: 'app', title: 'Пропустив заставку', props: {} },
  hello_continue: { src: 'app', title: 'Натиснув кнопку на привітанні', props: { has_birth: bool } },
  birth_open: { src: 'app', title: 'Відкрив введення дати', props: {} },
  birth_entered: { src: 'app', title: 'Ввів дату народження', props: { birth_year: int(1900, 2030) } },
  home_view: { src: 'app', title: 'Головний екран', props: {} },
  year_open: { src: 'app', title: 'Відкрив рік', props: { year: int(2020, 2100), locked: bool } },
  card_open: { src: 'app', title: 'Відкрив картку року', props: { card: oneOf(...Object.keys(CARD_NAMES)), year: int(2020, 2100), locked: bool } },
  months_open: { src: 'app', title: 'Відкрив місяці', props: { year: int(2020, 2100), locked: bool } },
  month_open: { src: 'app', title: 'Відкрив місяць', props: { month: int(1, 12), year: int(2020, 2100), locked: bool, via: oneOf('grid', 'next') } },
  prefs_set: { src: 'app', title: 'Вказав статус / дітей', props: { status: oneOf('single', 'couple', 'unknown'), children: oneOf('yes', 'no', 'unknown') } },
  disclaimer_open: { src: 'app', title: 'Відкрив пояснення (*)', props: {} },
  error_shown: { src: 'app', title: 'Побачив помилку', props: { kind: oneOf('network', 'input', 'other') } },
  retry_click: { src: 'app', title: 'Натиснув «Спробувати ще раз»', props: {} },
  session_end: { src: 'app', title: 'Згорнув / закрив застосунок', props: { duration_s: int(0, 86400), screens: int(0, 10000) } },
};

/** Лишає тільки дозволені поля потрібного типу. Рядки обрізає й чистить від керівних символів. */
export function cleanProps(spec, raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, rule] of Object.entries(spec)) {
    if (!Object.hasOwn(raw, k)) continue;
    const v = raw[k];
    if (rule.t === 'str' && typeof v === 'string') {
      const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, rule.max);
      if (s) out[k] = s;
    } else if (rule.t === 'int' && Number.isInteger(v) && v >= rule.min && v <= rule.max) out[k] = v;
    else if (rule.t === 'bool' && typeof v === 'boolean') out[k] = v;
    else if (rule.t === 'enum' && rule.v.includes(v)) out[k] = v;
  }
  return out;
}

/**
 * Перевірка Telegram WebApp initData (HMAC-SHA-256, ключ = HMAC("WebAppData", bot_token)).
 * Повертає { id, username, first_name, language_code, is_premium, start_param } або null.
 */
export function verifyInitData(initData, botToken, { maxAgeSec = 86400, now = Date.now() } = {}) {
  if (!botToken || typeof initData !== 'string' || !initData || initData.length > 4096) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch { return null; }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(calc, Buffer.from(hash, 'hex'))) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSec) return null;
  let user;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { return null; }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  const sp = params.get('start_param');
  return {
    id: user.id,
    username: typeof user.username === 'string' ? user.username.slice(0, 64) : '',
    first_name: typeof user.first_name === 'string' ? user.first_name.slice(0, 64) : '',
    language_code: typeof user.language_code === 'string' ? user.language_code.slice(0, 8) : '',
    is_premium: user.is_premium === true,
    start_param: sp && ID.test(sp) ? sp : '',
  };
}

/** start_param: o_<order_id> — прийшов після оплати; v_<visitor_id> — з лендингу без оплати; інше — мітка джерела. */
export function parseStartParam(sp) {
  if (typeof sp !== 'string' || !ID.test(sp)) return {};
  if (sp.startsWith('o_') && sp.length > 2) return { order_id: sp.slice(2) };
  if (sp.startsWith('v_') && sp.length > 2) return { visitor_id: sp.slice(2) };
  return { source: sp };
}

const okId = (v) => (typeof v === 'string' && ID.test(v) ? v : null);
const okTg = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, ts INTEGER NOT NULL, name TEXT NOT NULL, src TEXT NOT NULL,
      tg_id INTEGER, visitor_id TEXT, order_id TEXT, session_id TEXT, props TEXT NOT NULL DEFAULT '{}',
      synced INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS events_unsynced ON events(synced, ts);
    CREATE TABLE IF NOT EXISTS tg_users (
      tg_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT, language TEXT, is_premium INTEGER, updated INTEGER
    );
    CREATE TABLE IF NOT EXISTS links (visitor_id TEXT PRIMARY KEY, tg_id INTEGER NOT NULL, ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY, visitor_id TEXT, tg_id INTEGER, plan TEXT, amount INTEGER, currency TEXT, provider TEXT,
      status TEXT, created INTEGER, paid INTEGER, reason TEXT, updated INTEGER
    );
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  `);
  const q = {
    insEvent: db.prepare('INSERT OR IGNORE INTO events (id, ts, name, src, tg_id, visitor_id, order_id, session_id, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    upUser: db.prepare(`INSERT INTO tg_users (tg_id, username, first_name, language, is_premium, updated) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tg_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name,
      language = excluded.language, is_premium = excluded.is_premium, updated = excluded.updated`),
    link: db.prepare('INSERT INTO links (visitor_id, tg_id, ts) VALUES (?, ?, ?) ON CONFLICT(visitor_id) DO NOTHING'),
    getOrder: db.prepare('SELECT * FROM orders WHERE order_id = ?'),
    upOrder: db.prepare(`INSERT INTO orders (order_id, visitor_id, tg_id, plan, amount, currency, provider, status, created, paid, reason, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET visitor_id = COALESCE(excluded.visitor_id, visitor_id), tg_id = COALESCE(excluded.tg_id, tg_id),
      plan = COALESCE(excluded.plan, plan), amount = COALESCE(excluded.amount, amount), currency = COALESCE(excluded.currency, currency),
      provider = COALESCE(excluded.provider, provider), status = COALESCE(excluded.status, status), paid = COALESCE(excluded.paid, paid),
      reason = COALESCE(excluded.reason, reason), updated = excluded.updated`),
    unsynced: db.prepare('SELECT * FROM events WHERE synced = 0 ORDER BY ts, rowid LIMIT ?'),
    mark: db.prepare('UPDATE events SET synced = 1 WHERE id = ?'),
    pending: db.prepare('SELECT COUNT(*) AS n FROM events WHERE synced = 0'),
  };

  const STATUS = { payment_created: 'created', payment_success: 'paid', payment_failed: 'failed', payment_refunded: 'refunded' };

  /** Записує перевірені події. Кожна: { name, ts?, tg_id?, visitor_id?, order_id?, session_id?, props } */
  function add(list, { tgUser = null } = {}) {
    const now = Date.now();
    let n = 0;
    db.exec('BEGIN');
    try {
      if (tgUser) q.upUser.run(tgUser.id, tgUser.username || '', tgUser.first_name || '', tgUser.language_code || '', tgUser.is_premium ? 1 : 0, now);
      for (const e of list) {
        const ts = Number.isSafeInteger(e.ts) && e.ts <= now && e.ts > now - 7 * 864e5 ? e.ts : now;
        const tg = okTg(e.tg_id); let vid = okId(e.visitor_id); let oid = okId(e.order_id);
        const sp = parseStartParam(e.props?.start_param);
        oid = oid || sp.order_id || null;
        vid = vid || sp.visitor_id || null;
        const r = q.insEvent.run(e.id || randomUUID(), ts, e.name, EVENTS[e.name].src, tg, vid, oid, okId(e.session_id), JSON.stringify(e.props || {}));
        if (!r.changes) continue; // повтор того самого event id
        n++;
        if (STATUS[e.name] && oid) {
          const p = e.props || {};
          q.upOrder.run(oid, vid, tg, p.plan ?? null, p.amount ?? null, p.currency ?? null, p.provider ?? null,
            STATUS[e.name], ts, e.name === 'payment_success' ? ts : null, p.reason ?? null, ts);
        }
        // Злиття: відвідувач лендингу / замовлення → Telegram-профіль.
        if (tg) {
          if (vid) q.link.run(vid, tg, ts);
          if (oid) {
            const o = q.getOrder.get(oid);
            if (o) {
              q.upOrder.run(oid, null, tg, null, null, null, null, null, o.created, null, null, ts);
              if (o.visitor_id) q.link.run(o.visitor_id, tg, ts);
            } else {
              q.upOrder.run(oid, null, tg, null, null, null, null, null, ts, null, null, ts); // замовлення ще не прийшло з вебхука
            }
          }
        }
      }
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    return n;
  }

  function people(now = Date.now()) {
    const links = new Map(db.prepare('SELECT visitor_id, tg_id FROM links').all().map((r) => [r.visitor_id, r.tg_id]));
    const orderTg = new Map(db.prepare('SELECT order_id, tg_id, visitor_id FROM orders').all().map((r) => [r.order_id, r]));
    const users = new Map(db.prepare('SELECT * FROM tg_users').all().map((u) => [u.tg_id, u]));
    const P = new Map();
    const keyOf = (e) => {
      let tg = e.tg_id;
      if (!tg && e.visitor_id) tg = links.get(e.visitor_id);
      if (!tg && e.order_id) {
        const o = orderTg.get(e.order_id);
        tg = o?.tg_id || (o?.visitor_id && links.get(o.visitor_id)) || null;
        if (!tg && o?.visitor_id) return 'v:' + o.visitor_id;
      }
      if (tg) return 'tg:' + tg;
      if (e.visitor_id) return 'v:' + e.visitor_id;
      if (e.order_id) return 'o:' + e.order_id;
      return null;
    };
    for (const e of db.prepare('SELECT * FROM events ORDER BY ts, rowid').iterate()) {
      const key = keyOf(e);
      if (!key) continue;
      let p = P.get(key);
      if (!p) {
        p = { key, tg_id: key.startsWith('tg:') ? Number(key.slice(3)) : null, first: e.ts, last: e.ts, c: {}, cards: new Set(), months: {},
          paid: 0, plan: null, paidAt: null, botAt: null, appAt: null, birthAt: null, birthYear: null, secs: 0, locked: 0,
          source: '', campaign: '', tariff: '', blocked: false, failed: 0, attempts: 0, refunded: 0 };
        P.set(key, p);
      }
      const pr = JSON.parse(e.props);
      p.last = Math.max(p.last, e.ts);
      p.c[e.name] = (p.c[e.name] || 0) + 1;
      if (pr.locked === true) p.locked++;
      switch (e.name) {
        case 'landing_view':
          if (!p.source && pr.utm_source) { p.source = pr.utm_source; p.campaign = pr.utm_campaign || ''; }
          if (!p.source && pr.referrer) p.source = pr.referrer;
          break;
        case 'tariff_click': p.tariff = pr.plan; break;
        case 'checkout_start': p.attempts++; if (pr.plan) p.tariff = pr.plan; break;
        case 'payment_success':
          p.paid += pr.amount || 0; p.paidAt = p.paidAt || e.ts;
          if (pr.plan && (!p.plan || PLAN_RANK[pr.plan] > PLAN_RANK[p.plan])) p.plan = pr.plan;
          break;
        case 'payment_failed': p.failed++; break;
        case 'payment_refunded': p.refunded += pr.amount || 0; p.paid -= pr.amount || 0; break;
        case 'bot_start': {
          p.botAt = p.botAt || e.ts;
          const sp = parseStartParam(pr.start_param);
          if (!p.source && sp.source) p.source = sp.source;
          break;
        }
        case 'bot_blocked': p.blocked = true; break;
        case 'bot_unblocked': p.blocked = false; break;
        case 'app_open': p.appAt = p.appAt || e.ts; break;
        case 'birth_entered': p.birthAt = p.birthAt || e.ts; if (pr.birth_year) p.birthYear = pr.birth_year; break;
        case 'card_open': if (!pr.locked) p.cards.add(pr.card); break;
        case 'month_open': if (pr.month) p.months[pr.month] = (p.months[pr.month] || 0) + 1; break;
        case 'session_end': p.secs += pr.duration_s || 0; break;
        default:
      }
    }
    return [...P.values()].map((p) => {
      const u = p.tg_id ? users.get(p.tg_id) : null;
      const top = Object.entries(p.months).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      return {
        key: p.key, tg_id: p.tg_id, username: u?.username ? '@' + u.username : '', first_name: u?.first_name || '',
        segment: segment(p), source: p.source, campaign: p.campaign, first: p.first, last: p.last,
        landing_views: p.c.landing_view || 0, tariff: p.tariff, attempts: p.attempts || p.c.payment_created || 0, failed: p.failed,
        plan: p.plan, paid: p.paid, paidAt: p.paidAt, botAt: p.botAt, appAt: p.appAt, app_opens: p.c.app_open || 0,
        birthAt: p.birthAt, birthYear: p.birthYear, cards: p.cards.size, months: Object.keys(p.months).length,
        topMonth: top ? Number(top[0]) : null, locked: p.locked, minutes: Math.round(p.secs / 6) / 10,
        idleDays: Math.floor((now - p.last) / 864e5), blocked: p.blocked,
      };
    });
  }

  function orders() {
    const links = new Map(db.prepare('SELECT visitor_id, tg_id FROM links').all().map((r) => [r.visitor_id, r.tg_id]));
    const users = new Map(db.prepare('SELECT * FROM tg_users').all().map((u) => [u.tg_id, u]));
    const firstBy = (name) => new Map(db.prepare('SELECT tg_id, MIN(ts) AS ts FROM events WHERE name = ? AND tg_id IS NOT NULL GROUP BY tg_id').all(name).map((r) => [r.tg_id, r.ts]));
    const bot = firstBy('bot_start'); const app = firstBy('app_open');
    return db.prepare("SELECT * FROM orders WHERE status IS NOT NULL ORDER BY created").all().map((o) => {
      const tg = o.tg_id || (o.visitor_id && links.get(o.visitor_id)) || null;
      return { ...o, tg_id: tg, username: tg && users.get(tg)?.username ? '@' + users.get(tg).username : '', botAt: tg ? bot.get(tg) || null : null, appAt: tg ? app.get(tg) || null : null };
    });
  }

  return {
    db, add, people, orders,
    unsynced: (limit = 500) => q.unsynced.all(limit),
    markSynced(ids) { db.exec('BEGIN'); try { for (const id of ids) q.mark.run(id); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
    pending: () => q.pending.get().n,
    close: () => db.close(),
  };
}

/** Сегмент людини — головна колонка для роботи з базою. */
export function segment(p) {
  const paid = p.paid > 0;
  if (!paid && p.refunded > 0) return 'Повернув кошти';
  if (paid) {
    if (!p.botAt && !p.appAt) return 'Оплатив — не зайшов у бот';
    if (!p.appAt) return 'Оплатив — у боті, не відкрив застосунок';
    if (!p.birthAt) return 'Оплатив — відкрив, не ввів дату';
    if (!p.cards.size && !Object.keys(p.months).length) return 'Оплатив — ввів дату, не читав';
    return 'Оплатив — користується';
  }
  if (p.failed > 0) return 'Не вдалася оплата';
  if (p.attempts > 0 || p.c.payment_created) return 'Почав оплату — не завершив';
  if (p.appAt) return 'Відкрив застосунок — не купив';
  if (p.botAt) return 'У боті — не відкрив застосунок';
  if (p.tariff) return 'Обрав тариф — не оплатив';
  return 'Лише лендинг';
}

// ── Рядки для Google Таблиці ──
// Дати передаються як мілісекунди; Apps Script перетворює їх на дати в часовому поясі таблиці.
const plan = (id) => (id ? PLAN_NAMES[id] || id : '');
const who = (tg, vid) => (tg ? String(tg) : vid ? 'анонім' : '');

export const SHEET_EVENTS = {
  name: 'Події',
  header: ['ID події', 'Час', 'Подія', 'Код події', 'Звідки', 'Telegram ID', 'Відвідувач', 'Замовлення', 'Тариф', 'Рік', 'Місяць', 'Картка', 'Закрито', 'Деталі'],
  dateCols: [1],
};
export function eventRow(e) {
  const p = JSON.parse(e.props);
  const { plan: pl, year, month, card, locked, ...rest } = p;
  const SRC = { landing: 'Лендинг', app: 'Застосунок', server: e.name.startsWith('payment') ? 'Оплата' : 'Бот' };
  return [
    e.id, e.ts, EVENTS[e.name]?.title || e.name, e.name, SRC[e.src] || e.src, e.tg_id || '', e.visitor_id || '', e.order_id || '',
    plan(pl), year || '', month ? MONTH_NAMES[month - 1] : '', card ? CARD_NAMES[card] || card : '',
    locked === true ? 'так' : locked === false ? 'ні' : '', Object.keys(rest).length ? JSON.stringify(rest) : '',
  ];
}

export const SHEET_PEOPLE = {
  name: 'Люди',
  header: ['Telegram ID', 'Username', 'Імʼя', 'Сегмент', 'Джерело', 'Кампанія', 'Перший візит', 'Переглядів лендингу', 'Обраний тариф',
    'Спроб оплати', 'Невдалих оплат', 'Куплений тариф', 'Оплачено, грн', 'Дата оплати', 'Запустив бота', 'Відкрив застосунок',
    'Відкриттів застосунку', 'Ввів дату', 'Рік народження', 'Карток прочитано', 'Місяців відкрито', 'Найчастіший місяць',
    'Відкривав закрите', 'Хвилин у застосунку', 'Остання активність', 'Днів без активності', 'Заблокував бота', 'Ключ'],
  dateCols: [6, 13, 14, 15, 17, 24],
};
export const personRow = (p) => [
  p.tg_id || 'анонім', p.username, p.first_name, p.segment, p.source, p.campaign, p.first, p.landing_views, plan(p.tariff),
  p.attempts, p.failed, plan(p.plan), p.paid || 0, p.paidAt || '', p.botAt || '', p.appAt || '',
  p.app_opens, p.birthAt || '', p.birthYear || '', p.cards, p.months, p.topMonth ? MONTH_NAMES[p.topMonth - 1] : '',
  p.locked, p.minutes, p.last, p.idleDays, p.blocked ? 'так' : '', p.key,
];

export const SHEET_ORDERS = {
  name: 'Оплати',
  header: ['Замовлення', 'Створено', 'Статус', 'Тариф', 'Сума', 'Валюта', 'Платіжна система', 'Telegram ID', 'Username',
    'Відвідувач', 'Оплачено', 'Причина відмови', 'Запустив бота', 'Відкрив застосунок'],
  dateCols: [1, 10, 12, 13],
};
const STATUS_UA = { created: 'Створено', paid: 'Оплачено', failed: 'Не вдалося', refunded: 'Повернено' };
export const orderRow = (o) => [
  o.order_id, o.created || '', STATUS_UA[o.status] || o.status || '', plan(o.plan), o.amount ?? '', o.currency || '', o.provider || '',
  who(o.tg_id, null), o.username, o.visitor_id || '', o.paid || '', o.reason || '', o.botAt || '', o.appAt || '',
];

/**
 * Надсилає нові події й оновлені зведення у веб-застосунок Apps Script (google-sheets/Code.gs).
 * Події позначаються вивантаженими лише після підтвердження {ok:true}.
 */
export async function syncToSheets(store, { url, secret, batch = 500, timeoutMs = 25000, fetchImpl = fetch }) {
  const evs = store.unsynced(batch);
  if (!evs.length) return { sent: 0 };
  const body = {
    secret,
    events: { ...SHEET_EVENTS, rows: evs.map(eventRow) },
    replace: [
      { ...SHEET_PEOPLE, rows: store.people().sort((a, b) => b.last - a.last).map(personRow) },
      { ...SHEET_ORDERS, rows: store.orders().reverse().map(orderRow) },
    ],
  };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal, redirect: 'follow' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error('Таблиця відповіла помилкою: ' + (j?.error || r.status));
    store.markSynced(evs.map((e) => e.id));
    return { sent: evs.length, more: evs.length === batch };
  } finally { clearTimeout(t); }
}
