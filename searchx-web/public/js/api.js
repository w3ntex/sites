// Talks to the sources. Some APIs can be called straight from the phone (normal browsing traffic,
// no server IP to block); the app tries that first, remembers what works, and otherwise goes
// through the SearchX server (Cloudflare Worker).

import { state } from './state.js';
import { load, save } from './lib/storage.js';
import { redditUrls, parseRedditListing, mergeRedditResults } from './shared/reddit.js';
import {
  REDGIFS_TOKEN_URL, redgifsSearchUrl, parseRedGifs, redgifsMore,
  epornerSearchUrl, parseEporner, epornerMore, pullpushUrl, parsePullPush
} from './shared/apis.js';
import { isItemAllowed } from './shared/safety.js';

const DIRECT_RETRY_MS = 6 * 3600 * 1000;
const direct = load('direct', {}) || {};

function canDirect(key) {
  const d = direct[key];
  return !d || d.ok || Date.now() - d.at > DIRECT_RETRY_MS;
}

function markDirect(key, ok) {
  if (direct[key]?.ok === ok && ok) return;
  direct[key] = { ok, at: Date.now() };
  save('direct', direct);
}

/** Forget which sources refused direct calls (Réglages → test). */
export function resetDirect() {
  for (const k of Object.keys(direct)) delete direct[k];
  save('direct', direct);
}

function headers() {
  const s = state.settings;
  const h = { Accept: 'application/json' };
  if (s.r34key) h['x-r34-key'] = s.r34key;
  if (s.r34user) h['x-r34-user'] = s.r34user;
  if (s.accessKey) h['x-sx-key'] = s.accessKey;
  return h;
}

function withTimeout(signal, ms) {
  const t = AbortSignal.timeout ? AbortSignal.timeout(ms) : null;
  if (!t) return signal;
  if (!signal) return t;
  return AbortSignal.any ? AbortSignal.any([signal, t]) : signal;
}

async function getJSON(url, signal) {
  let res;
  try {
    res = await fetch(url, { headers: headers(), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(navigator.onLine === false ? 'Pas de connexion Internet.' : 'Serveur SearchX injoignable.');
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!body) throw new Error(`Serveur SearchX indisponible (${res.status}).`);
  if (!body.ok) {
    const e = new Error(body.error || `Erreur ${res.status}`);
    e.kind = body.kind;
    e.debug = body.debug || '';
    throw e;
  }
  return body;
}

async function directJSON(url, signal, extra = {}) {
  const res = await fetch(url, { signal: withTimeout(signal, 12000), credentials: 'omit', headers: { Accept: 'application/json', ...extra } });
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// ---- direct (phone) implementations ------------------------------------------------------------

async function redgifsToken(signal, force = false) {
  const t = load('rgToken', null);
  if (!force && t?.token && t.exp > Date.now()) return t.token;
  const j = await directJSON(REDGIFS_TOKEN_URL, signal);
  if (!j?.token) throw new Error('RedGIFs : pas de jeton');
  save('rgToken', { token: j.token, exp: Date.now() + 20 * 3600 * 1000 });
  return j.token;
}

async function redgifsDirect(p, signal) {
  const url = redgifsSearchUrl(p);
  let data;
  try {
    data = await directJSON(url, signal, { Authorization: `Bearer ${await redgifsToken(signal)}` });
  } catch (e) {
    if (e.status !== 401) throw e;
    data = await directJSON(url, signal, { Authorization: `Bearer ${await redgifsToken(signal, true)}` });
  }
  const items = parseRedGifs(data);
  return { items, more: redgifsMore(data, p.page, items) };
}

async function epornerDirect(p, signal) {
  const data = await directJSON(epornerSearchUrl(p), signal);
  const items = parseEporner(data);
  return { items, more: epornerMore(data, p.page, items) };
}

async function pullpushDirect(p, signal) {
  if (!canDirect('pullpush')) throw new Error('PullPush refuse le téléphone');
  try {
    const r = parsePullPush(await directJSON(pullpushUrl({ q: p.q, cursor: p.page > 1 ? p.cursor : '' }), signal));
    markDirect('pullpush', true);
    return r;
  } catch (e) {
    if (!signal?.aborted) markDirect('pullpush', false);
    throw e;
  }
}

async function redditDirect(p, signal) {
  if (String(p.cursor || '').startsWith('pp:')) return pullpushDirect(p, signal);
  if (canDirect('reddit')) {
    try {
      const urls = redditUrls({ q: p.q, sort: p.sort, cursor: p.cursor, page: p.page });
      const one = async url => (url ? parseRedditListing(await directJSON(url, signal)) : { items: [], after: null });
      const [a, b] = await Promise.allSettled([one(urls.priority), one(urls.global)]);
      if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
      const m = mergeRedditResults(a.status === 'fulfilled' ? a.value : null, b.status === 'fulfilled' ? b.value : null);
      markDirect('reddit', true);
      return m;
    } catch (e) {
      if (signal?.aborted) throw e;
      markDirect('reddit', false);
    }
  }
  return pullpushDirect(p, signal);
}

const DIRECT = { redgifs: redgifsDirect, eporner: epornerDirect, reddit: redditDirect };

function finish(src, r, via) {
  return { ok: true, src, items: (r.items || []).filter(isItemAllowed), more: Boolean(r.more), cursor: r.cursor || null, tags: r.tags || null, via };
}

async function workerSearch(src, params, signal) {
  const p = new URLSearchParams({
    src, q: params.q, page: String(params.page), sort: params.sort, media: params.media, dur: params.dur, hd: params.hd
  });
  if (params.cursor) p.set('cursor', params.cursor);
  if (params.fresh) p.set('fresh', '1');
  const body = await getJSON(`api/search?${p}`, signal);
  return { ...body, via: 'server' };
}

export async function searchSource(src, params, signal) {
  let directError = null;
  const fn = DIRECT[src];
  if (fn && (src === 'reddit' || canDirect(src))) {
    try {
      const r = await fn(params, signal);
      if (src !== 'reddit') markDirect(src, true);
      return finish(src, r, 'phone');
    } catch (e) {
      if (signal?.aborted) throw e;
      if (src !== 'reddit') markDirect(src, false);
      directError = e;
    }
  }
  try {
    return await workerSearch(src, params, signal);
  } catch (e) {
    if (directError && !signal?.aborted) e.phone = directError.message || String(directError);
    throw e;
  }
}

export async function suggestTags(q, signal) {
  try {
    const body = await getJSON(`api/suggest?q=${encodeURIComponent(q)}`, signal);
    return body.tags || [];
  } catch {
    return [];
  }
}

export async function health() {
  return getJSON('api/health', withTimeout(null, 8000));
}

/** Download URL for a direct media file (served as an attachment by the Worker). */
export function downloadUrl(item) {
  const media = item.full || item.media;
  if (!media || !/^https:\/\//.test(media)) return null;
  const name = (item.title || 'searchx').replace(/[^\w\- ]+/g, '').slice(0, 50).trim() || 'searchx';
  const p = new URLSearchParams({ url: media, name });
  if (state.settings.accessKey) p.set('k', state.settings.accessKey);
  return `api/dl?${p}`;
}
