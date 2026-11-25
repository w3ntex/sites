// SearchX Worker: serves the web app (static assets) and a small JSON API that searches the
// adult sites server-side (browsers can't call them directly because of CORS).
//
//   GET /api/health
//   GET /api/search?src=<source>&q=<query>&page=1&sort=relevance&media=all&dur=any&hd=any[&cursor=][&scope=hentai]
//   GET /api/suggest?q=<text>            Rule34 tag autocomplete
//   GET /api/dl?url=<direct media>&name= download passthrough (whitelisted media hosts)
//   GET /api/xvideo?user=<name>&id=<post>  direct file of an X video (read from a Nitter mirror)

import { friendlyMessage, UpstreamError, MOBILE_UA } from './lib.js';
import { isQueryAllowed, isItemAllowed } from '../public/js/shared/safety.js';
import * as xvideos from './sources/xvideos.js';
import * as xhamster from './sources/xhamster.js';
import * as redtube from './sources/redtube.js';
import * as eporner from './sources/eporner.js';
import * as rule34 from './sources/rule34.js';
import * as redgifs from './sources/redgifs.js';
import * as reddit from './sources/reddit.js';
import * as x from './sources/x.js';
import * as hstream from './sources/hstream.js';
import * as r34video from './sources/r34video.js';
import * as danbooru from './sources/danbooru.js';
import * as yandere from './sources/yandere.js';

export const VERSION = '2.5.0';

const SOURCES = { xvideos, xhamster, redtube, eporner, rule34, redgifs, reddit, x, hstream, r34video, danbooru, yandere };
// Drawn content and unverified posts (X) get the strict minor-safety rules (see safety.js).
const STRICT = new Set(['rule34', 'x', 'hstream', 'r34video', 'danbooru', 'yandere']);
const SORTS = new Set(['relevance', 'views', 'newest', 'rating']);
const MEDIA = new Set(['all', 'video', 'gif', 'image']);
const DURS = new Set(['any', 'short', 'medium', 'long']);
const QUALITIES = new Set(['any', 'hd', 'uhd']);
const SEARCH_TIMEOUT_MS = 25000;
const CACHE_TTL = 300;
const DOWNLOAD_HOSTS = /(^|\.)(redgifs\.com|rule34\.xxx|redd\.it|redditmedia\.com|twimg\.com|donmai\.us|yande\.re)$/i;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra
    }
  });
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new UpstreamError('timeout')), ms); })
  ]).finally(() => clearTimeout(t));
}

function pick(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

async function cached(request, keyUrl, ctx, compute, { fresh = false } = {}) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(keyUrl, { method: 'GET' });
  if (cache && !fresh) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const res = await compute();
  if (res.headers.get('X-SX-Cacheable') !== '1') return res;
  const out = new Response(res.body, res);
  out.headers.delete('X-SX-Cacheable');
  if (cache) {
    const copy = out.clone();
    copy.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
    ctx?.waitUntil?.(cache.put(key, copy));
  }
  return out;
}

async function handleSearch(request, url, env, ctx) {
  const params = url.searchParams;
  const src = params.get('src') || '';
  const source = SOURCES[src];
  if (!source) return json({ ok: false, error: `Source inconnue : ${src}` }, 400);
  const q = (params.get('q') || '').trim().slice(0, 200);
  if (!q) return json({ ok: false, error: 'Recherche vide.' }, 400);
  // Hentai mode (sent by the app): RedGIFs keeps to its Hentai tag, Reddit to the hentai subreddits.
  const scope = params.get('scope') === 'hentai' ? 'hentai' : '';
  const drawn = STRICT.has(src) || scope === 'hentai';
  if (!isQueryAllowed(q, { drawn })) {
    return json({ ok: false, error: "Cette recherche n'est pas autorisée : SearchX ne cherche jamais de contenu impliquant des mineurs." }, 400);
  }
  const opts = {
    q,
    page: Math.max(1, Math.min(200, parseInt(params.get('page') || '1', 10) || 1)),
    sort: pick(params.get('sort'), SORTS, 'relevance'),
    media: pick(params.get('media'), MEDIA, 'all'),
    dur: pick(params.get('dur'), DURS, 'any'),
    hd: pick(params.get('hd'), QUALITIES, 'any'),
    cursor: (params.get('cursor') || '').slice(0, 300),
    scope,
    env,
    request
  };

  // Cache key: the normalized query (+ whether Rule34 credentials were sent).
  const keyUrl = new URL('https://cache.searchx/search');
  for (const k of ['q', 'page', 'sort', 'media', 'dur', 'hd', 'cursor', 'scope']) keyUrl.searchParams.set(k, String(opts[k]));
  keyUrl.searchParams.set('src', src);
  if (src === 'rule34') keyUrl.searchParams.set('cred', request.headers.get('x-r34-key') ? '1' : '0');

  return cached(request, keyUrl.toString(), ctx, async () => {
    try {
      const out = await withTimeout(source.search(opts), SEARCH_TIMEOUT_MS);
      const items = (out.items || []).filter(it => isItemAllowed(it, { drawn }));
      return json({ ok: true, src, items, more: Boolean(out.more), cursor: out.cursor || null, tags: out.tags || null, profile: out.profile || null },
        200, { 'X-SX-Cacheable': items.length ? '1' : '0' });
    } catch (e) {
      const status = e instanceof UpstreamError ? 502 : 500;
      return json({
        ok: false, src, error: friendlyMessage(e), kind: e?.kind || 'error', status: e?.status || 0,
        debug: String(e?.debug || e?.message || '').slice(0, 300)
      }, status);
    }
  }, { fresh: params.get('fresh') === '1' });
}

async function handleSuggest(url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  if (q.length < 2 || !isQueryAllowed(q)) return json({ ok: true, tags: [] });
  const tags = (await rule34.suggestTags(q)).slice(0, 10);
  return json({ ok: true, tags }, 200, { 'Cache-Control': 'private, max-age=600' });
}

async function handleDownload(url) {
  let target;
  try { target = new URL(url.searchParams.get('url') || ''); } catch { return json({ ok: false, error: 'Lien invalide.' }, 400); }
  if (target.protocol !== 'https:' || !DOWNLOAD_HOSTS.test(target.hostname)) {
    return json({ ok: false, error: 'Ce fichier ne peut pas être téléchargé.' }, 400);
  }
  const upstreamRes = await fetch(target.toString(), {
    headers: { 'User-Agent': MOBILE_UA, Referer: `https://${target.hostname}/` },
    redirect: 'follow'
  });
  if (!upstreamRes.ok || !upstreamRes.body) {
    return json({ ok: false, error: `Téléchargement impossible (${upstreamRes.status}).` }, 502);
  }
  const ext = (target.pathname.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';
  const base = (url.searchParams.get('name') || 'searchx').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'searchx';
  const headers = new Headers({
    'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${base}.${ext}"`,
    'Cache-Control': 'no-store'
  });
  const len = upstreamRes.headers.get('Content-Length');
  if (len) headers.set('Content-Length', len);
  return new Response(upstreamRes.body, { status: 200, headers });
}

async function handleXVideo(url, ctx) {
  const user = url.searchParams.get('user') || '';
  const id = url.searchParams.get('id') || '';
  return cached(null, `https://cache.searchx/xvideo/${encodeURIComponent(user)}/${encodeURIComponent(id)}`, ctx, async () => {
    try {
      const v = await x.videoUrl(user, id);
      return json({ ok: true, ...v }, 200, { 'X-SX-Cacheable': '1' });
    } catch (e) {
      return json({ ok: false, error: friendlyMessage(e), debug: String(e?.debug || '').slice(0, 300) }, 502);
    }
  });
}

async function handleApi(request, url, env, ctx) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Méthode non autorisée.' }, 405);
  const sentKey = request.headers.get('x-sx-key') || url.searchParams.get('k');
  if (env?.ACCESS_KEY && sentKey !== env.ACCESS_KEY && url.pathname !== '/api/health') {
    return json({ ok: false, error: "Clé d'accès requise (Réglages → Serveur).", kind: 'access' }, 401);
  }
  switch (url.pathname) {
    case '/api/health': return json({ ok: true, version: VERSION, sources: Object.keys(SOURCES), locked: Boolean(env?.ACCESS_KEY) });
    case '/api/search': return handleSearch(request, url, env, ctx);
    case '/api/suggest': return handleSuggest(url);
    case '/api/dl': return handleDownload(url);
    case '/api/xvideo': return handleXVideo(url, ctx);
    default: return json({ ok: false, error: 'Introuvable.' }, 404);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, url, env, ctx);
      } catch (e) {
        return json({ ok: false, error: friendlyMessage(e) }, 500);
      }
    }
    if (env?.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  }
};
