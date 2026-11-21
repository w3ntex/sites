import { upstream, decodeEntities, stripTags, first, wordDurationToSec, compactNumber, resolutionFromLabel, absUrl } from '../lib.js';

const BASE = 'https://www.xvideos.com';

export async function search({ q, page, sort, dur, hd }) {
  const p = new URLSearchParams({ k: q });
  if (page > 1) p.set('p', String(page - 1));
  const s = { views: 'views', newest: 'uploaddate', rating: 'rating' }[sort];
  if (s) p.set('sort', s);
  // Server-side duration buckets are coarser than ours; the app refines locally.
  const d = { medium: '10min_more', long: '20min_more' }[dur];
  if (d) p.set('durf', d);
  const qa = { hd: 'hd', uhd: '1080P' }[hd];
  if (qa) p.set('quality', qa);

  const html = await upstream(`${BASE}/?${p}`);
  const items = parseXVideos(html);
  return { items, more: items.length >= 20 };
}

export function parseXVideos(html) {
  const items = [];
  const chunks = String(html).split('<div id="video_').slice(1);
  for (const raw of chunks) {
    const chunk = raw.slice(0, 7000);
    const id = first(/^([0-9a-z_]+)"/i, chunk);
    const href = first(/href="(\/video[^"]+)"/i, chunk);
    const thumb = absUrl(first(/data-src="([^"]+)"/i, chunk) || first(/<img[^>]+src="(https?:\/\/[^"]+\.jpg)"/i, chunk));
    if (!id || !href || !thumb) continue;

    const title = first(/<p class="title">\s*<a[^>]*title="([^"]+)"/i, chunk) ||
      stripTags(first(/<p class="title">\s*<a[^>]*>([\s\S]*?)<\/a>/i, chunk) || '') || 'Sans titre';
    const durText = first(/<span class="duration">([^<]+)<\/span>/i, chunk);
    const hdMark = first(/video-hd-mark">([^<]+)</i, chunk);
    const viewsText = first(/([\d.,]+\s*[kKmMbB]?)\s*<span class="sprfluous">\s*Views/i, chunk) ||
      first(/<span class="views?">\s*([\d.,]+\s*[kKmMbB]?)/i, chunk);
    const creator = first(/<span class="name">([^<]+)<\/span>/i, chunk);

    items.push({
      id: `xvideos:${id}`,
      src: 'xvideos',
      title: decodeEntities(title).trim(),
      dur: wordDurationToSec(durText),
      thumb,
      views: compactNumber(viewsText),
      rating: null,
      likes: null,
      url: BASE + href,
      type: 'video',
      media: null,
      embed: /^\d+$/.test(id) ? `${BASE}/embedframe/${id}` : null,
      h: resolutionFromLabel(hdMark),
      date: null,
      tags: [],
      by: creator ? [decodeEntities(creator).trim()] : []
    });
  }
  return items;
}
