// JSON APIs that the phone may be able to call directly (no server in between), plus their parsers.
// The Worker uses the same code as a fallback.

import { decodeEntities, absUrl, num, toPercent, sqlDateToUnix } from './parse.js';
import { parseRedditListing } from './reddit.js';

// ---- RedGIFs ------------------------------------------------------------------------------------

export const REDGIFS_TOKEN_URL = 'https://api.redgifs.com/v2/auth/temporary';

// RedGIFs ignores the old `search_text` parameter (it answers with the trending feed whatever the
// words): the search is `query`. Orders accepted: top, top7, top28, latest, score, trending.
export const REDGIFS_ORDERS = { relevance: 'score', views: 'top', rating: 'top28', newest: 'latest' };

export function redgifsSearchUrl({ q, page = 1, sort = 'relevance', media = 'all', scope = '' }) {
  const p = new URLSearchParams({ query: q, order: REDGIFS_ORDERS[sort] || 'score', count: '80', page: String(page) });
  if (scope === 'hentai') p.set('tags', 'Hentai');
  if (media === 'image') p.set('type', 'i');
  else if (media === 'gif' || media === 'video') p.set('type', 'g');
  return `https://api.redgifs.com/v2/gifs/search?${p}`;
}

/** RedGIFs relay (api/redgifs.js on Vercel): same parameters, called straight from the phone. */
export function relayBase(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return '';
    return `${u.origin}`;
  } catch {
    return '';
  }
}

export function redgifsRelayUrl(base, p) {
  const b = relayBase(base);
  return b ? `${b}/api/redgifs?${new URL(redgifsSearchUrl(p)).searchParams}` : '';
}

export function parseRedGifs(data) {
  const out = [];
  for (const g of data?.gifs || []) {
    const urls = g?.urls || {};
    const thumb = absUrl(urls.poster) || absUrl(urls.thumbnail);
    if (!g?.id || !thumb) continue;
    const tags = Array.isArray(g.tags) ? g.tags.map(String) : [];
    const isImage = num(g.type) === 2;
    const title = (g.description && String(g.description).trim()) || tags.slice(0, 4).join(', ') || `@${g.userName || 'redgifs'}`;
    out.push({
      id: `redgifs:${g.id}`,
      src: 'redgifs',
      title,
      dur: null,
      thumb,
      views: num(g.views),
      rating: null,
      likes: num(g.likes),
      url: `https://www.redgifs.com/watch/${g.id}`,
      type: isImage ? 'image' : 'gif',
      media: absUrl(urls.hd) || absUrl(urls.sd),
      preview: isImage ? null : (absUrl(urls.sd) || absUrl(urls.hd)),
      embed: isImage ? null : `https://www.redgifs.com/ifr/${g.id}`,
      h: num(g.height),
      w: num(g.width),
      date: num(g.createDate),
      tags,
      by: g.userName ? [String(g.userName)] : []
    });
  }
  return out;
}

export function redgifsMore(data, page, items) {
  const pages = num(data?.pages);
  return pages != null ? page < pages : items.length >= 40;
}

/** Sites that add many precise results in porn mode (offered when results are few). */
export const MORE_RESULTS_SOURCES = ['eporner', 'redtube', 'xhamster'];

// ---- Eporner ------------------------------------------------------------------------------------

export function epornerSearchUrl({ q, page = 1, sort = 'relevance', hd = 'any' }) {
  const order = { relevance: 'most-popular', views: 'most-popular', newest: 'latest', rating: 'top-rated' }[sort] || 'most-popular';
  const p = new URLSearchParams({
    query: q, per_page: '40', page: String(page), thumbsize: 'big', order, gay: '0',
    lq: hd === 'any' ? '1' : '0', format: 'json'
  });
  return `https://www.eporner.com/api/v2/video/search/?${p}`;
}

export function parseEporner(data) {
  const out = [];
  for (const v of data?.videos || []) {
    const url = absUrl(v?.url);
    const thumb = absUrl(v?.default_thumb?.src) || absUrl(v?.thumbs?.[0]?.src);
    if (!v?.id || !url || !thumb) continue;
    const tags = String(v.keywords || '').split(',').map(t => t.trim()).filter(Boolean);
    out.push({
      id: `eporner:${v.id}`,
      src: 'eporner',
      title: decodeEntities(v.title || 'Sans titre'),
      dur: num(v.length_sec),
      thumb,
      views: num(v.views),
      rating: toPercent(v.rate),
      likes: null,
      url,
      type: 'video',
      media: null,
      embed: absUrl(v.embed) || `https://www.eporner.com/embed/${v.id}/`,
      h: null,
      date: sqlDateToUnix(v.added),
      tags,
      by: []
    });
  }
  return out;
}

export function epornerMore(data, page, items) {
  const totalPages = num(data?.total_pages);
  return totalPages != null ? page < totalPages : items.length >= 40;
}

// ---- PullPush (public Reddit archive, used when Reddit itself refuses) ----------------------------

export function pullpushUrl({ q, cursor = '', scope = '' }) {
  const p = new URLSearchParams({ q, over_18: 'true', size: '100', sort: 'desc', sort_type: 'created_utc' });
  if (scope === 'hentai') p.set('subreddit', 'hentai');
  const before = (/^pp:(\d+)$/.exec(cursor || '') || [])[1];
  if (before) p.set('before', before);
  return `https://api.pullpush.io/reddit/search/submission/?${p}`;
}

export function parsePullPush(json) {
  const posts = Array.isArray(json?.data) ? json.data : [];
  const { items } = parseRedditListing({ data: { children: posts.map(d => ({ data: d })) } });
  let last = null;
  for (let i = posts.length - 1; i >= 0 && last == null; i--) last = num(posts[i]?.created_utc);
  return { items, cursor: last ? `pp:${Math.floor(last)}` : '', more: posts.length >= 100 };
}

// ---- Danbooru (anime art; the API allows calls from any web page) ------------------------------
// Anonymous searches are limited to 2 tags, metatags included: one tag + rating:e, or two tags and
// the rating is checked afterwards.

export const DANBOORU = 'https://danbooru.donmai.us';

export function danbooruAutocompleteUrl(term) {
  const p = new URLSearchParams({ 'search[query]': term, 'search[type]': 'tag_query', limit: '8' });
  return `${DANBOORU}/autocomplete.json?${p}`;
}

/** Autocomplete answer → [{ tag, count }] (most used first). */
export function parseDanbooruAutocomplete(list) {
  return (Array.isArray(list) ? list : [])
    .map(x => ({ tag: String(x?.value || x?.name || '').toLowerCase(), count: num(x?.post_count) || 0 }))
    .filter(x => x.tag && !x.tag.includes(':'))
    .sort((a, b) => b.count - a.count);
}

export function danbooruPostsUrl({ tags, page = 1 }) {
  const t = tags.slice(0, 2);
  if (t.length < 2) t.push('rating:e');
  const p = new URLSearchParams({ tags: t.join(' '), limit: '100', page: String(page) });
  return `${DANBOORU}/posts.json?${p}`;
}

function variant(p, type) {
  return absUrl((p?.media_asset?.variants || []).find(v => v.type === type)?.url);
}

export function parseDanbooru(posts) {
  const out = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    if (!p?.id || p.rating !== 'e' || p.is_deleted || p.is_banned) continue;
    const ext = String(p.file_ext || '').toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm'].includes(ext)) continue; // ugoira zip, swf
    const file = absUrl(p.file_url);
    const thumb = variant(p, '720x720') || variant(p, '360x360') || absUrl(p.preview_file_url);
    if (!file || !thumb) continue;
    const type = ext === 'mp4' || ext === 'webm' ? 'video' : ext === 'gif' ? 'gif' : 'image';
    const tags = String(p.tag_string || '').split(/\s+/).filter(Boolean);
    const chars = String(p.tag_string_character || '').split(/\s+/).filter(Boolean).map(t => t.replace(/_/g, ' '));
    const artists = String(p.tag_string_artist || '').split(/\s+/).filter(Boolean).map(t => t.replace(/_/g, ' '));
    out.push({
      id: `danbooru:${p.id}`,
      src: 'danbooru',
      title: (chars.length ? chars.slice(0, 3).join(', ') : String(p.tag_string_general || '').split(/\s+/).slice(0, 6).join(', ').replace(/_/g, ' ')) || `Danbooru #${p.id}`,
      dur: null,
      thumb,
      thumb2: absUrl(p.preview_file_url),
      views: null,
      rating: null,
      likes: num(p.score),
      url: `${DANBOORU}/posts/${p.id}`,
      type,
      media: type === 'image' ? (absUrl(p.large_file_url) || file) : file,
      full: file,
      embed: null,
      h: num(p.image_height),
      w: num(p.image_width),
      date: Number.isFinite(Date.parse(p.created_at)) ? Math.round(Date.parse(p.created_at) / 1000) : null,
      tags,
      by: artists
    });
  }
  return out;
}

// ---- Yande.re (high-resolution scans; Moebooru API) ---------------------------------------------

export function yandereUrl({ tags, page = 1, sort = 'relevance', negative = [] }) {
  const t = [...tags, 'rating:e', ...negative.map(n => `-${n}`)];
  if (sort === 'views' || sort === 'rating') t.push('order:score');
  const p = new URLSearchParams({ tags: t.join(' '), limit: '40', page: String(page) });
  return `https://yande.re/post.json?${p}`;
}

export function parseYandere(posts) {
  const out = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    if (!p?.id || String(p.rating || '') !== 'e') continue;
    const file = absUrl(p.file_url);
    const sample = absUrl(p.sample_url) || absUrl(p.jpeg_url);
    const thumb = absUrl(p.preview_url) || sample;
    if (!file || !thumb) continue;
    const tags = String(p.tags || '').split(/\s+/).filter(Boolean);
    out.push({
      id: `yandere:${p.id}`,
      src: 'yandere',
      title: tags.slice(0, 8).map(t => t.replace(/_/g, ' ')).join(', ') || `yande.re #${p.id}`,
      dur: null,
      thumb: sample && (num(p.sample_width) || 0) <= 1600 ? sample : thumb,
      thumb2: thumb,
      views: null,
      rating: null,
      likes: num(p.score),
      url: `https://yande.re/post/show/${p.id}`,
      type: String(p.file_ext || '').toLowerCase() === 'gif' ? 'gif' : 'image',
      media: sample || file,
      full: file,
      embed: null,
      h: num(p.height),
      w: num(p.width),
      date: num(p.created_at),
      tags,
      by: p.author ? [String(p.author)] : []
    });
  }
  return out;
}
