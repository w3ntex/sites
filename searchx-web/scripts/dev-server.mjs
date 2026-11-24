// Local preview: serves ./public and routes /api/* to the real Worker code.
//   npm run dev        → Worker talks to the real sites
//   npm run dev:mock   → fake upstream data + placeholder thumbnails (works offline)
// Optional: PORT=8787, FAIL=xhamster,rule34 (sources that should fail in mock mode)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import { mockFetch } from '../test/fixtures.mjs';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const MOCK = process.argv.includes('--mock');
const BASE = `http://localhost:${PORT}`;
if (MOCK) globalThis.fetch = mockFetch(BASE, { failSources: (process.env.FAIL || '').split(',').filter(Boolean) });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

function placeholder(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (a + 40 + (h % 80)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a},55%,32%)"/><stop offset="1" stop-color="hsl(${b},60%,14%)"/></linearGradient></defs>
<rect width="640" height="360" fill="url(#g)"/><circle cx="${120 + (h % 400)}" cy="${90 + (h % 180)}" r="${60 + (h % 70)}" fill="hsla(${b},70%,60%,.25)"/>
<circle cx="${480 - (h % 300)}" cy="${250 - (h % 120)}" r="${40 + (h % 50)}" fill="hsla(${a},80%,70%,.18)"/></svg>`;
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE);
    if (url.pathname.startsWith('/__mock/img/')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600' });
      return res.end(placeholder(url.pathname));
    }
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const out = await worker.fetch(new Request(url, { method: req.method, headers }), {}, { waitUntil() {} });
      res.writeHead(out.status, Object.fromEntries(out.headers));
      return res.end(Buffer.from(await out.arrayBuffer()));
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (e) {
    res.writeHead(e?.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(e?.code === 'ENOENT' ? 'Not found' : String(e?.stack || e));
  }
}).listen(PORT, () => console.log(`SearchX ${MOCK ? '(mock) ' : ''}→ ${BASE}`));
