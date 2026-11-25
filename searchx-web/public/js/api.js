// Talks to the sources. Some APIs can be called straight from the phone (normal browsing traffic,
// no server IP to block); the app tries that first, remembers what works, and otherwise goes
// through the SearchX server (Cloudflare Worker).

import { state } from './state.js';
import { load, save } from './lib/storage.js';
import { redditUrls, parseRedditListing, mergeRedditResults } from './shared/reddit.js';
import {
  epornerSearchUrl, parseEporner, epornerMore, pullpushUrl, parsePullPush,
  danbooruTags, danbooruPostsUrl, parseDanbooru, danbooruMore,
  redgifsRelayUrl, parseRedGifs, redgifsMore
} from './shared/apis.js';
import { isItemAllowed, isQueryAllowed } from './shared/safety.js';
import { isStrictSource } from './config.js';

const DIRECT_RETRY_MS = 3600 * 1000;
const direct = load('direct', {}) || {};

function canDirect(key) {
  const d = direct[key];
  return !d || d.ok || Date.now() - d.at > DIRECT_RETRY_MS;
}

/** Readable reason for a failed call made from the phone. */
export function phoneReason(e) {
  if (!e) return '';
  if (e.status) return `HTTP ${e.status}${e.status === 429 ? ' (trop de requêtes)' : e.status === 403 ? ' (refusé)' : ''}`;
  if (e.name === 'TypeError') return "le site n'autorise pas les appels depuis une app web";
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'pas de réponse à temps';
  if (e.name === 'JsonpError') return `${e.message} (le site refuse aussi la méthode alternative)`;
  return e.message || String(e);
}

function markDirect(key, ok, err = null) {
  if (direct[key]?.ok === ok && ok) return;
  direct[key] = { ok, at: Date.now(), err: ok ? '' : phoneReason(err) };
  save('direct', direct);
}

function skippedError(key) {
  const e = new Error(`${direct[key]?.err || 'échec récent'} (essai précédent)`);
  e.skipped = true;
  return e;
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

/**
 * JSONP (not subject to CORS), run inside a sandboxed iframe with an opaque origin: the remote
 * script can only hand back its data through postMessage, never touch the app or its storage.
 */
function jsonpSandboxed(url, signal, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const id = `sx${Math.random().toString(36).slice(2)}`;
    const src = `${url}${url.includes('?') ? '&' : '?'}jsonp=sxcb`;
    const attr = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none';
    iframe.srcdoc = `<!doctype html><script>var done=false;function sxcb(d){done=true;parent.postMessage({id:"${id}",data:d},"*")}<\/script>` +
      `<script src="${attr}" onload="if(!done)parent.postMessage({id:'${id}',error:'nocb'},'*')" onerror="parent.postMessage({id:'${id}',error:'load'},'*')"><\/script>`;
    let timer = null;
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      signal?.removeEventListener?.('abort', onAbort);
      iframe.remove();
    };
    const onMsg = e => {
      if (e.source !== iframe.contentWindow || e.data?.id !== id) return;
      cleanup();
      if (e.data.error) {
        const err = new Error(e.data.error === 'nocb' ? 'JSONP non pris en charge' : 'JSONP refusé');
        err.name = 'JsonpError';
        reject(err);
      } else resolve(e.data.data);
    };
    const onAbort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    timer = setTimeout(() => { cleanup(); const err = new Error('pas de réponse à temps'); err.name = 'TimeoutError'; reject(err); }, timeout);
    window.addEventListener('message', onMsg);
    signal?.addEventListener?.('abort', onAbort);
    document.body.appendChild(iframe);
  });
}

// ---- direct (phone) implementations ------------------------------------------------------------

// RedGIFs only accepts its own website from a browser (CORS) and limits Cloudflare's servers.
// With the relay set up (api/redgifs.js on Vercel), the phone asks the relay directly.
async function redgifsRelay(p, signal) {
  const url = redgifsRelayUrl(state.settings.rgRelay, p);
  const res = await fetch(url, { signal: withTimeout(signal, 15000), credentials: 'omit', headers: { Accept: 'application/json' } });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !body) {
    const e = new Error(body?.error ? `Relais RedGIFs : ${body.error}` : `Relais RedGIFs injoignable (${res.status}).`);
    e.status = res.status;
    throw e;
  }
  const items = parseRedGifs(body);
  return { items, more: redgifsMore(body, p.page, items) };
}

/** Checks a relay address (Réglages → Relais RedGIFs). */
export async function testRelay(base) {
  const url = redgifsRelayUrl(base, { q: 'blonde', page: 1, sort: 'relevance' });
  if (!url) throw new Error("Adresse invalide (exemple : sites-xxxx.vercel.app).");
  const res = await fetch(url, { signal: withTimeout(null, 15000), credentials: 'omit' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.gifs) throw new Error(body?.error || `Le relais a répondu ${res.status}.`);
  return body.gifs.length;
}

/** Danbooru allows calls from any page: words → tags with its autocomplete, then the posts. */
async function danbooruDirect(p, signal) {
  const tags = await danbooruTags(p.q, async url => {
    try {
      return await directJSON(url, signal);
    } catch (e) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw e;
    }
  });
  const posts = await directJSON(danbooruPostsUrl({ tags, page: p.page }), signal);
  return { items: parseDanbooru(posts), more: danbooruMore(posts), tags };
}

async function epornerDirect(p, signal) {
  const data = await directJSON(epornerSearchUrl(p), signal);
  const items = parseEporner(data);
  return { items, more: epornerMore(data, p.page, items) };
}

async function pullpushDirect(p, signal, redditError = null) {
  if (!canDirect('pullpush')) {
    const e = skippedError('pullpush');
    e.message = `Reddit : ${redditError ? phoneReason(redditError) : direct.reddit?.err || '?'} · PullPush : ${e.message}`;
    throw e;
  }
  try {
    const r = parsePullPush(await directJSON(pullpushUrl({ q: p.q, cursor: p.page > 1 ? p.cursor : '', scope: p.scope }), signal));
    markDirect('pullpush', true);
    return r;
  } catch (e) {
    if (!signal?.aborted) markDirect('pullpush', false, e);
    const out = new Error(`Reddit : ${redditError ? phoneReason(redditError) : direct.reddit?.err || 'ignoré'} · PullPush : ${phoneReason(e)}`);
    out.name = e.name;
    throw out;
  }
}

async function redditDirect(p, signal) {
  if (String(p.cursor || '').startsWith('pp:')) return pullpushDirect(p, signal);
  let redditError = null;
  if (canDirect('reddit')) {
    try {
      const urls = redditUrls({ q: p.q, sort: p.sort, cursor: p.cursor, page: p.page, scope: p.scope });
      const one = async url => {
        if (!url) return { items: [], after: null };
        try {
          return parseRedditListing(await directJSON(url, signal));
        } catch (e) {
          if (e.name !== 'TypeError' || signal?.aborted) throw e;
          // CORS refused: try JSONP, which browsers don't restrict.
          return parseRedditListing(await jsonpSandboxed(url, signal));
        }
      };
      const [a, b] = await Promise.allSettled([one(urls.priority), one(urls.global)]);
      if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
      const m = mergeRedditResults(a.status === 'fulfilled' ? a.value : null, b.status === 'fulfilled' ? b.value : null);
      markDirect('reddit', true);
      return m;
    } catch (e) {
      if (signal?.aborted) throw e;
      markDirect('reddit', false, e);
      redditError = e;
    }
  }
  return pullpushDirect(p, signal, redditError);
}

const DIRECT = { eporner: epornerDirect, reddit: redditDirect, danbooru: danbooruDirect };

function finish(src, r, via, drawn) {
  const items = (r.items || []).filter(it => isItemAllowed(it, { drawn }));
  return { ok: true, src, items, more: Boolean(r.more), cursor: r.cursor || null, tags: r.tags || null, profile: r.profile || null, via };
}

async function workerSearch(src, params, signal) {
  const p = new URLSearchParams({
    src, q: params.q, page: String(params.page), sort: params.sort, media: params.media, dur: params.dur, hd: params.hd
  });
  if (params.cursor) p.set('cursor', params.cursor);
  if (params.scope) p.set('scope', params.scope);
  if (params.fresh) p.set('fresh', '1');
  const body = await getJSON(`api/search?${p}`, signal);
  return { ...body, via: 'server' };
}

export const REFUSED_MESSAGE = "Cette recherche n'est pas autorisée : SearchX ne cherche jamais de contenu impliquant des mineurs.";

export async function searchSource(src, input, signal) {
  // Drawn content (hentai mode, hentai sites) and X get the strict minor-safety rules.
  const hentai = state.settings.mode === 'hentai';
  const drawn = hentai || isStrictSource(src);
  if (!isQueryAllowed(input.q, { drawn })) throw new Error(REFUSED_MESSAGE);
  // In hentai mode RedGIFs keeps to its Hentai tag (and Reddit to the hentai subreddits).
  const params = { ...input, q: String(input.q || '').trim(), scope: hentai && (src === 'redgifs' || src === 'reddit') ? 'hentai' : '' };

  let directError = null;
  if (src === 'redgifs') {
    // RedGIFs limits Cloudflare's servers (429) and only lets its own site call its API from a
    // browser. With the relay: results in the grid. Without it (or if it fails): RedGIFs' own
    // search page, shown inside the app and loaded by the phone itself.
    if (!state.settings.rgRelay) return { ok: true, src, items: [], more: false, embed: true, via: 'embed' };
    try {
      return finish(src, await redgifsRelay(params, signal), 'relay', drawn);
    } catch (e) {
      if (signal?.aborted) throw e;
      return { ok: true, src, items: [], more: false, embed: true, via: 'embed', relayError: e.message };
    }
  }
  const fn = DIRECT[src];
  if (fn) {
    if (src === 'reddit' || canDirect(src)) {
      try {
        const r = await fn(params, signal);
        if (src !== 'reddit') markDirect(src, true);
        return finish(src, r, 'phone', drawn);
      } catch (e) {
        if (signal?.aborted) throw e;
        if (src !== 'reddit') markDirect(src, false, e);
        directError = e;
      }
    } else {
      directError = skippedError(src);
    }
  }
  try {
    return finish(src, await workerSearch(src, params, signal), 'server', drawn);
  } catch (e) {
    if (directError && !signal?.aborted) e.phone = src === 'reddit' || src === 'redgifs' ? directError.message : (directError.skipped ? directError.message : phoneReason(directError));
    if (src === 'redgifs') e.relayHint = !state.settings.rgRelay;
    throw e;
  }
}

const xVideos = new Map();

/** Direct file of an X video (read from the post page by the server, then cached). */
export async function xVideoUrl(item, signal) {
  if (xVideos.has(item.id)) return xVideos.get(item.id);
  const p = new URLSearchParams({ user: item.user || String(item.by?.[0] || '').replace(/^@/, ''), id: item.tweet || '' });
  const body = await getJSON(`api/xvideo?${p}`, signal);
  const v = { url: body.url, hls: Boolean(body.hls) };
  xVideos.set(item.id, v);
  return v;
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
