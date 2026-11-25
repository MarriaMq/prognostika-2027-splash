// Збирає статичну версію для GitHub Pages у папку docs/.
// Тексти шифруються паролем; у публічний репозиторій потрапляє лише шифротекст.
//
//   PROG_PASS=... node server/build-static.mjs      (без PROG_PASS — генерується новий пароль)
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'docs');
const PASS_FILE = join(ROOT, 'private', 'pages-password.txt');

let pass = process.env.PROG_PASS || (existsSync(PASS_FILE) ? readFileSync(PASS_FILE, 'utf8').trim() : '');
if (!pass) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  pass = Array.from(randomBytes(10), (b) => abc[b % abc.length]).join('');
  writeFileSync(PASS_FILE, pass + '\n');
}

// Лише поля, потрібні для показу (без службових метаданих).
const full = JSON.parse(readFileSync(join(ROOT, 'private', 'content.json'), 'utf8'));
const slim = { version: full.version, records: {} };
for (const [k, r] of Object.entries(full.records)) {
  slim.records[k] = { arcana: r.arcana, title: r.title, status: r.status, ...(r.sections ? { sections: r.sections } : { paras: r.paras }) };
}

const salt = randomBytes(16), iv = randomBytes(12), iter = 250000;
const key = pbkdf2Sync(pass, salt, iter, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const data = Buffer.concat([cipher.update(JSON.stringify(slim), 'utf8'), cipher.final(), cipher.getAuthTag()]);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'js'), { recursive: true });
writeFileSync(join(OUT, 'content.enc.json'), JSON.stringify({ v: 1, iter, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') }));
cpSync(join(ROOT, 'anim'), join(OUT, 'anim'), { recursive: true });
for (const f of ['engine.js', 'forecast.js', 'static-client.js']) cpSync(join(ROOT, 'server', f), join(OUT, 'js', f));
const html = readFileSync(join(ROOT, 'index.html'), 'utf8').replace(
  '<script>\n(function(){',
  '<script>window.PROG_STATIC=true</script>\n<script type="module" src="js/static-client.js"></script>\n<script>\n(function(){',
);
if (!html.includes('PROG_STATIC=true')) throw new Error('не знайдено місце для статичного режиму в index.html');
writeFileSync(join(OUT, 'index.html'), html);
writeFileSync(join(OUT, '.nojekyll'), '');

// Перевірка: у публічних файлах не має бути відкритого тексту трактувань.
const sample = Object.values(full.records)[0].paras[0].slice(0, 40);
for (const f of ['index.html', 'content.enc.json', 'js/forecast.js', 'js/engine.js', 'js/static-client.js']) {
  if (readFileSync(join(OUT, f), 'utf8').includes(sample)) throw new Error(`відкритий текст у ${f}`);
}
console.log(`docs/ зібрано: ${Object.keys(slim.records).length} записів зашифровано; пароль у private/pages-password.txt`);
