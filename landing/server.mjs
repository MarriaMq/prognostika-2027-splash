// Сервер лендингу: віддає статичні файли і приймає події аналітики.
// Запуск: node landing/server.mjs   (HOST і PORT можна задати змінними середовища)
// Події пишуться в landing/data/events.jsonl — по одному JSON на рядок.
import http from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, 'data');
const LOG = join(DATA, 'events.jsonl');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8791);

const TYPES = new Set(['view', 'click', 'section', 'scroll', 'leave']);
const NAME = /^[a-z0-9_]{0,32}$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PUBLIC = new Set(['.html', '.js', '.css', '.png', '.jpg', '.webp', '.svg', '.ico']);

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

async function track(req, res) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 2048) { res.writeHead(413).end(); return; } }
  let e;
  try { e = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
  if (!TYPES.has(e.t) || !NAME.test(e.n || '')) { res.writeHead(400).end(); return; }
  const row = {
    ts: new Date().toISOString(), t: e.t, n: e.n || '',
    sid: clip(e.sid, 16), dev: e.dev === 'mobile' ? 'mobile' : 'desktop',
    src: clip(e.src, 40), cmp: clip(e.cmp, 40), ref: clip(e.ref, 80)
  };
  await mkdir(DATA, { recursive: true });
  await appendFile(LOG, JSON.stringify(row) + '\n');
  res.writeHead(204).end();
}

async function serve(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  const ext = extname(file);
  if (!file.startsWith(ROOT + '/') || file.startsWith(DATA) || !PUBLIC.has(ext) || file.endsWith('.mjs')) { res.writeHead(404).end(); return; }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[ext], 'X-Content-Type-Options': 'nosniff' }).end(buf);
  } catch { res.writeHead(404).end(); }
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/track') return track(req, res).catch(() => res.writeHead(500).end());
  if (req.method === 'GET' || req.method === 'HEAD') return serve(req, res);
  res.writeHead(405).end();
}).listen(PORT, HOST, () => console.log(`landing on http://${HOST}:${PORT}`));
