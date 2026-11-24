// JSON APIs that the phone may be able to call directly (no server in between), plus their parsers.
// The Worker uses the same code as a fallback.

import { decodeEntities, absUrl, num, toPercent, sqlDateToUnix } from './parse.js';
import { parseRedditListing } from './reddit.js';

// ---- RedGIFs ------------------------------------------------------------------------------------

export const REDGIFS_TOKEN_URL = 'https://api.redgifs.com/v2/auth/temporary';

export function redgifsSearchUrl({ q, page = 1, sort = 'relevance', media = 'all' }) {
  const order = { relevance: 'trending', views: 'top', newest: 'latest', rating: 'best' }[sort] || 'trending';
  const p = new URLSearchParams({ search_text: q, order, count: '40', page: String(page) });
  if (media === 'image') p.set('type', 'i');
  else if (media === 'gif' || media === 'video') p.set('type', 'g');
  return `https://api.redgifs.com/v2/gifs/search?${p}`;
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
