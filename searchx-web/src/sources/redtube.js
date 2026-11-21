import { upstream, decodeEntities, clockToSec, absUrl, num, toPercent, sqlDateToUnix, UpstreamError } from '../lib.js';

// RedTube webmaster API (Pornhub network format).
export async function search({ q, page, sort }) {
  const p = new URLSearchParams({
    data: 'redtube.Videos.searchVideos', output: 'json', search: q, page: String(page), thumbsize: 'big'
  });
  const ordering = { views: 'mostviewed', newest: 'newest', rating: 'rating' }[sort];
  if (ordering) p.set('ordering', ordering);

  const text = await upstream(`https://api.redtube.com/?${p}`, { headers: { Accept: 'application/json' } });
  let data;
  try { data = JSON.parse(text); } catch { throw new UpstreamError('parse'); }
  // "No videos found" comes back as {"code": ..., "message": ...}.
  if (!Array.isArray(data?.videos)) return { items: [], more: false };
  const items = parseRedTube(data);
  return { items, more: items.length >= 20 };
}

export function parseRedTube(data) {
  const out = [];
  for (const wrap of data?.videos || []) {
    const v = wrap?.video || wrap;
    if (!v) continue;
    const url = absUrl(v.url);
    const thumbs = Array.isArray(v.thumbs) ? v.thumbs.map(t => absUrl(t?.src)).filter(Boolean) : [];
    const thumb = absUrl(v.default_thumb) || absUrl(v.thumb) || thumbs[0];
    if (!url || !thumb) continue;
    const id = v.video_id != null ? String(v.video_id) : url.split('/').pop();
    const tags = (v.tags || []).map(t => (typeof t === 'string' ? t : t?.tag_name)).filter(Boolean);
    const stars = (v.pornstars || []).map(s => (typeof s === 'string' ? s : s?.pornstar_name)).filter(Boolean);
    out.push({
      id: `redtube:${id}`,
      src: 'redtube',
      title: decodeEntities(v.title || 'Sans titre'),
      dur: clockToSec(v.duration),
      thumb,
      thumb2: thumbs.find(t => t !== thumb) || absUrl(v.thumb) || null,
      views: num(v.views),
      rating: toPercent(v.rating),
      likes: null,
      url,
      type: 'video',
      media: null,
      embed: /^\d+$/.test(id) ? `https://embed.redtube.com/?id=${id}&bgcolor=000000` : null,
      h: null,
      date: sqlDateToUnix(v.publish_date),
      tags,
      by: stars.map(decodeEntities)
    });
  }
  return out;
}
