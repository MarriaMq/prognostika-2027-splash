/**
 * Прогностика 2027 — приймач аналітики для Google Таблиці.
 *
 * Сервер мініапки (server/analytics.js → syncToSheets) кожні 30 с надсилає сюди POST:
 *   { secret, events: {name, header, dateCols, rows}, replace: [{name, header, dateCols, rows}, ...] }
 * «Події» дописуються (без дублів за ID), «Люди» й «Оплати» перезаписуються цілком.
 *
 * Встановлення (один раз):
 *  1. Таблиця → Розширення → Apps Script → вставити цей файл замість Code.gs.
 *  2. Налаштування проєкту (шестерня) → Властивості скрипту → додати SECRET = довгий випадковий рядок
 *     (той самий рядок — у змінну SHEETS_SECRET на сервері).
 *  3. Розгорнути → Нове розгортання → тип «Вебзастосунок»: Виконувати від імені «Я», доступ «Усі».
 *     Отриману адресу …/exec — у змінну SHEETS_WEBHOOK_URL на сервері.
 *  4. Перевірка: виконати функцію selfTest у редакторі — у «Події» з'явиться тестовий рядок (потім його можна видалити).
 */

var TZ = 'Europe/Kyiv';
var DATE_FMT = 'dd.MM.yyyy HH:mm';

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!secretOk_(body.secret)) return json_({ ok: false, error: 'forbidden' });
    lock.waitLock(25000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSpreadsheetTimeZone() !== TZ) ss.setSpreadsheetTimeZone(TZ);
    var added = 0;
    if (body.events && body.events.rows && body.events.rows.length) added = appendEvents_(ss, body.events);
    (body.replace || []).forEach(function (t) { replaceTable_(ss, t); });
    ss.getRange('Дашборд!B2').setValue(new Date()); // «Оновлено»
    return json_({ ok: true, added: added });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet() { return json_({ ok: true, service: 'prognostika-analytics' }); }

// ── події: дописуємо, пропускаючи ID, які вже є (повтор після обриву зв'язку) ──
function appendEvents_(ss, t) {
  var sh = sheet_(ss, t);
  var last = sh.getLastRow();
  var seen = {};
  if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { seen[r[0]] = 1; });
  var rows = t.rows.filter(function (r) { if (seen[r[0]]) return false; seen[r[0]] = 1; return true; })
    .map(function (r) { return clean_(r, t.dateCols); });
  if (!rows.length) return 0;
  room_(sh, last + rows.length);
  sh.getRange(last + 1, 1, rows.length, t.header.length).setValues(rows);
  formatDates_(sh, t.dateCols, last + 1, rows.length);
  return rows.length;
}

// ── зведення: перезаписуємо цілком, шапку й формат лишаємо ──
function replaceTable_(ss, t) {
  var sh = sheet_(ss, t);
  var old = sh.getLastRow();
  var rows = t.rows.map(function (r) { return clean_(r, t.dateCols); });
  room_(sh, rows.length + 1);
  if (rows.length) sh.getRange(2, 1, rows.length, t.header.length).setValues(rows);
  if (old > rows.length + 1) sh.getRange(rows.length + 2, 1, old - rows.length - 1, sh.getMaxColumns()).clearContent();
  if (rows.length) formatDates_(sh, t.dateCols, 2, rows.length);
}

// Додає рядки, якщо даних більше, ніж місця на вкладці.
function room_(sh, lastRow) {
  var max = sh.getMaxRows();
  if (lastRow > max) sh.insertRowsAfter(max, lastRow - max + 500);
}

function sheet_(ss, t) {
  var sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
  var head = sh.getRange(1, 1, 1, t.header.length);
  var cur = head.getValues()[0];
  if (cur.join('\u0001') !== t.header.join('\u0001')) {
    head.setValues([t.header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Мілісекунди → дата; рядки, що починаються з = + - @, — як текст (захист від формул в іменах).
function clean_(row, dateCols) {
  return row.map(function (v, i) {
    if (dateCols.indexOf(i) >= 0 && typeof v === 'number' && v > 0) return new Date(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
    if (v === null || v === undefined) return '';
    return v;
  });
}

function formatDates_(sh, dateCols, fromRow, n) {
  dateCols.forEach(function (c) { sh.getRange(fromRow, c + 1, n, 1).setNumberFormat(DATE_FMT); });
}

function secretOk_(s) {
  var want = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!want || typeof s !== 'string' || s.length !== want.length) return false;
  var d = 0;
  for (var i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ s.charCodeAt(i);
  return d === 0;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Ручна перевірка з редактора: імітує один запит сервера. */
function selfTest() {
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret) throw new Error('Спершу додайте SECRET у Властивості скрипту');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var head = ss.getSheetByName('Події').getRange(1, 1, 1, 14).getValues()[0];
  var res = doPost({ postData: { contents: JSON.stringify({
    secret: secret,
    events: { name: 'Події', header: head, dateCols: [1],
      rows: [['selftest-' + Date.now(), Date.now(), 'Тест підключення', 'selftest', 'Сервер', '', '', '', '', '', '', '', '', '']] },
    replace: [],
  }) } });
  Logger.log(res.getContent());
}
