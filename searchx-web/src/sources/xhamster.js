import { upstream, decodeEntities, clockToSec, compactNumber, absUrl, num, UpstreamError } from '../lib.js';

// Tries xHamster's front-end JSON API, then the JSON embedded in the search page (window.initials).
export async function search({ q, page, sort }) {
  let apiError = null;
  try {
    const p = new URLSearchParams({ search: q, page: String(page) });
    const data = await upstream(`https://xhamster.com/api/front/search?${p}`, {
      as: 'json', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    });
    const items = extractXHamster(data);
    if (items.length) return { items, more: items.length >= 20 };
  } catch (e) {
    apiError = e;
  }

  const p = new URLSearchParams();
  if (page > 1) p.set('page', String(page));
  const s = { views: 'views', newest: 'newest', rating: 'rating' }[sort];
  if (s) p.set('sort', s);
  const qs = p.toString();
  const html = await upstream(`https://xhamster.com/search/${encodeURIComponent(q)}${qs ? `?${qs}` : ''}`);
  const json = initialsJSON(html);
  if (!json) {
    if (/thumb-list|video-thumb/.test(html)) return { items: [], more: false };
    throw apiError || new UpstreamError('parse');
  }
  let data;
  try { data = JSON.parse(json); } catch { throw new UpstreamError('parse'); }
  const items = extractXHamster(data);
  return { items, more: items.length >= 20 };
}

export function initialsJSON(html) {
  const m = /window\.initials\s*=\s*/.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = html.indexOf('</script>', start);
  if (end < 0) return null;
  let s = html.slice(start, end).trim();
  if (s.endsWith(';')) s = s.slice(0, -1);
  return s;
}

/** Walks arbitrary JSON looking for video thumb objects (have pageURL + thumbURL/imageURL). */
export function extractXHamster(root) {
  const seen = new Set();
  const out = [];
  const visit = (node, depth) => {
    if (!node || depth > 14) return;
    if (Array.isArray(node)) { for (const v of node) visit(v, depth + 1); return; }
    if (typeof node !== 'object') return;

    const page = typeof node.pageURL === 'string' && node.pageURL.includes('/videos/') ? absUrl(node.pageURL) : null;
    const thumb = absUrl(node.thumbURL || node.imageURL);
    if (page && thumb) {
      if (seen.has(page)) return;
      seen.add(page);
      const id = node.id != null ? String(node.id) : page.split('/').pop();
      let creator = null;
      for (const key of ['landing', 'uploader', 'author', 'user', 'channel']) {
        const n = node[key]?.name;
        if (typeof n === 'string' && n.trim()) { creator = n.trim(); break; }
      }
      creator = creator || node.uploaderName || node.channelName || null;
      const ratingRaw = node.rating && typeof node.rating === 'object' ? num(node.rating.value) : null;
      out.push({
        id: `xhamster:${id}`,
        src: 'xhamster',
        title: decodeEntities(node.title || 'Sans titre'),
        dur: typeof node.duration === 'number' ? node.duration : clockToSec(node.duration),
        thumb,
        views: typeof node.views === 'number' ? node.views : compactNumber(node.views),
        rating: ratingRaw == null ? null : Math.round(ratingRaw <= 1 ? ratingRaw * 100 : ratingRaw),
        likes: null,
        url: page,
        type: 'video',
        media: null,
        embed: /^\d+$/.test(id) ? `https://xhamster.com/xembed.php?video=${id}` : null,
        h: node.isUHD ? 2160 : (node.isHD ? 720 : null),
        date: typeof node.created === 'number' ? node.created : null,
        tags: [],
        by: creator ? [decodeEntities(creator)] : []
      });
      return;
    }
    for (const v of Object.values(node)) visit(v, depth + 1);
  };
  visit(root, 0);
  return out;
}
