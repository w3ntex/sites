import { upstream, unexpectedPage, decodeEntities, absUrl, clockToSec } from '../lib.js';

// rule34video.com — 3D and 2D animated hentai. Server-rendered search pages; videos play in the
// site's embeddable player, and each result has a short preview clip for the grid.
const BASE = 'https://rule34video.com';
const SORTS = { views: 'video_viewed', rating: 'rating', newest: 'post_date' };

export function r34videoUrl({ q, page = 1, sort = 'relevance' }) {
  const slug = encodeURIComponent(String(q || '').trim().toLowerCase().replace(/\s+/g, '-'));
  const path = `/search/${slug}/${page > 1 ? `${page}/` : ''}`;
  return `${BASE}${path}${SORTS[sort] ? `?sort_by=${SORTS[sort]}` : ''}`;
}

export function parseR34Video(html) {
  const items = [];
  const parts = String(html || '').split(/<div class="item thumb video_\d+[^"]*"/).slice(1);
  for (const block of parts) {
    const id = (/data-video-card-id="(\d+)"/.exec(block) || [])[1];
    const a = /<a class="th" href="([^"]+)" title="([^"]*)"/.exec(block);
    if (!id || !a) continue;
    const thumb = absUrl((/<img class="thumb"[^>]+src="([^"]+)"/.exec(block) || [])[1], BASE);
    if (!thumb) continue;
    const preview = absUrl((/data-preview="([^"]+)"/.exec(block) || [])[1], BASE);
    const time = (/<div class="time">([^<]+)<\/div>/.exec(block) || [])[1];
    const hd = /custom-hd|class="quality"/.test(block);
    items.push({
      id: `r34video:${id}`,
      src: 'r34video',
      title: decodeEntities(a[2]).trim() || `Rule34Video #${id}`,
      dur: clockToSec(time),
      thumb,
      views: null,
      rating: null,
      likes: null,
      url: absUrl(a[1], BASE),
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
