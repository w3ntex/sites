import { upstream, decodeEntities, absUrl, num, toPercent, sqlDateToUnix } from '../lib.js';

// Eporner public JSON API v2 (documented, stable, HD-only catalogue by default).
export async function search({ q, page, sort, hd }) {
  const order = { relevance: 'most-popular', views: 'most-popular', newest: 'latest', rating: 'top-rated' }[sort] || 'most-popular';
  const p = new URLSearchParams({
    query: q, per_page: '40', page: String(page), thumbsize: 'big', order, gay: '0',
    lq: hd === 'any' ? '1' : '0', format: 'json'
  });
  const data = await upstream(`https://www.eporner.com/api/v2/video/search/?${p}`, {
    as: 'json', headers: { Accept: 'application/json' }
  });
  const items = parseEporner(data);
  const totalPages = num(data?.total_pages);
  return { items, more: totalPages != null ? page < totalPages : items.length >= 40 };
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
