import { upstream, unexpectedPage, decodeEntities, absUrl, clockToSec, compactNumber } from '../lib.js';

// rule34video.com — 3D and 2D animated hentai. Server-rendered search pages; videos play in the
// site's embeddable player, and each result has a short preview clip for the grid.
const BASE = 'https://rule34video.com';
const SORTS = { views: 'video_viewed', rating: 'rating', newest: 'post_date' };

export function r34videoUrl({ q, page = 1, sort = 'relevance' }) {
  const slug = encodeURIComponent(String(q || '').trim().toLowerCase().replace(/\s+/g, '-'));
  const path = `/search/${slug}/${page > 1 ? `${page}/` : ''}`;
  return `${BASE}${path}${SORTS[sort] ? `?sort_by=${SORTS[sort]}` : ''}`;
}

const attr = (tag, name) => (new RegExp(`\\b${name}="([^"]*)"`).exec(tag || '') || [])[1];

// Attributes are matched one by one: the site's spacing changes (two spaces before title= in 2026).
export function parseR34Video(html) {
  const items = [];
  const parts = String(html || '').split(/<div\s+class="item thumb video_\d+[^"]*"/).slice(1);
  for (const block of parts) {
    const id = (/data-video-card-id="(\d+)"/.exec(block) || [])[1];
    const link = (/<a\b[^>]*\bclass="th"[^>]*>/.exec(block) || [])[0];
    const href = attr(link, 'href');
    if (!id || !href) continue;
    // Lazy images keep a 1-pixel placeholder in src and the picture in data-rd-src.
    const img = (/<img\b[^>]*\bclass="thumb\b[^"]*"[^>]*>/.exec(block) || [])[0];
    const src = ['data-rd-src', 'data-src', 'data-rd-jpg', 'src'].map(n => attr(img, n)).find(u => u && !u.startsWith('data:'));
    const thumb = absUrl(src, BASE);
    if (!thumb) continue;
    const preview = absUrl((/data-preview="([^"]+)"/.exec(block) || [])[1], BASE);
    const time = (/<div\s+class="time">\s*([^<]+?)\s*<\/div>/.exec(block) || [])[1];
    const hd = /custom-hd|class="quality"/.test(block);
    const title = decodeEntities(attr(link, 'title') || attr(img, 'alt') || '').trim();
    const rating = Number((/(\d{1,3})%\s*\(\d+\)/.exec(block) || [])[1]);
    items.push({
      id: `r34video:${id}`,
      src: 'r34video',
      title: title || `Rule34Video #${id}`,
      dur: clockToSec(time),
      thumb,
      views: compactNumber((/title="Views:\s*([\d.,]+\s*[kKmM]?)"/.exec(block) || [])[1]),
      rating: Number.isFinite(rating) && rating > 0 ? rating : null,
      likes: null,
      url: absUrl(href, BASE),
      type: 'video',
      media: null,
      preview,
      embed: `${BASE}/embed/${id}`,
      h: hd ? 720 : null,
      date: null,
      tags: [],
      by: []
    });
  }
  return items;
}

export async function search({ q, page, sort }) {
  const res = await upstream(r34videoUrl({ q, page, sort }), { as: 'page', timeout: 15000 });
  const items = parseR34Video(res.text);
  if (!items.length && !/search|no videos|nothing found/i.test(res.text)) throw unexpectedPage(res);
  return { items, more: items.length >= 20 };
}
