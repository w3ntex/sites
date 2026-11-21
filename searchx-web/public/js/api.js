import { state } from './state.js';
import { redditUrls, parseRedditListing, mergeRedditResults } from './shared/reddit.js';
import { isItemAllowed } from './shared/safety.js';

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
    throw e;
  }
  return body;
}

/** Reddit straight from the phone (normal browser traffic), no server involved. */
async function redditDirect(params, signal) {
  const urls = redditUrls({ q: params.q, sort: params.sort, cursor: params.cursor, page: params.page });
  const one = async url => {
    if (!url) return { items: [], after: null };
    const res = await fetch(url, { signal: withTimeout(signal, 12000), credentials: 'omit', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Reddit ${res.status}`);
    return parseRedditListing(await res.json());
  };
  const [a, b] = await Promise.allSettled([one(urls.priority), one(urls.global)]);
  if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
  const merged = mergeRedditResults(a.status === 'fulfilled' ? a.value : null, b.status === 'fulfilled' ? b.value : null);
  return { ok: true, src: 'reddit', items: merged.items.filter(isItemAllowed), more: merged.more, cursor: merged.cursor };
}

export async function searchSource(src, params, signal) {
  if (src === 'reddit') {
    try {
      return await redditDirect(params, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      // fall back to the server
    }
  }
  const p = new URLSearchParams({
    src, q: params.q, page: String(params.page), sort: params.sort, media: params.media, dur: params.dur, hd: params.hd
  });
  if (params.cursor) p.set('cursor', params.cursor);
  if (params.fresh) p.set('fresh', '1');
  return getJSON(`api/search?${p}`, signal);
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
