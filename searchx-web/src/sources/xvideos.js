import { upstream, unexpectedPage, decodeEntities, stripTags, first, wordDurationToSec, compactNumber, resolutionFromLabel, absUrl, DESKTOP_UA, MOBILE_UA } from '../lib.js';

const BASE = 'https://www.xvideos.com';
const NO_RESULTS = /no video match|aucune vid[ée]o ne correspond|no results? found|0 results/i;

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
  const url = `${BASE}/?${p}`;

  // Desktop markup first, then the mobile site (served to phones, sometimes less filtered).
  let last = null;
  for (const ua of [DESKTOP_UA, MOBILE_UA]) {
    const pg = await upstream(url, { ua, as: 'page' });
    const items = parseXVideos(pg.text);
    if (items.length) return { items, more: items.length >= 20 };
    if (NO_RESULTS.test(pg.text) && /mozaique|thumb-block|search/i.test(pg.text)) return { items: [], more: false };
    last = pg;
  }
  throw unexpectedPage(last);
}

/** Finds every `<div … id="video_123" …>` block, whatever the attribute order. */
export function parseXVideos(html) {
  const text = String(html);
  const starts = [];
  const re = /<div\b[^>]*\bid="video_([0-9a-z_]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(text))) starts.push({ id: m[1], at: m.index });
  const items = [];
  const seen = new Set();
  for (let i = 0; i < starts.length; i++) {
    const { id, at } = starts[i];
    const chunk = text.slice(at, Math.min(starts[i + 1]?.at ?? text.length, at + 8000));
    const href = first(/href="(\/(?:video|prof-video-click|[a-z]{2}\/video)[^"]*)"/i, chunk) || first(/href="(\/video[^"]+)"/i, chunk);
    const thumb = absUrl(first(/data-src="([^"]+)"/i, chunk) || first(/<img[^>]+src="(https?:\/\/[^"]+\.(?:jpe?g|webp))"/i, chunk));
    if (!href || !thumb || seen.has(id)) continue;
    seen.add(id);

    const title = first(/<p class="title">\s*<a[^>]*title="([^"]+)"/i, chunk) ||
      first(/<a[^>]*href="\/video[^"]*"[^>]*title="([^"]+)"/i, chunk) ||
      stripTags(first(/<p class="title">\s*<a[^>]*>([\s\S]*?)<\/a>/i, chunk) || '') || 'Sans titre';
    const durText = first(/<span class="duration">([^<]+)<\/span>/i, chunk);
    const hdMark = first(/video-hd-mark">([^<]+)</i, chunk);
    const viewsText = first(/([\d.,]+\s*[kKmMbB]?)\s*<span class="sprfluous">\s*Views/i, chunk) ||
      first(/<span class="views?">\s*([\d.,]+\s*[kKmMbB]?)/i, chunk);
    const creator = first(/<span class="name">([^<]+)<\/span>/i, chunk);

    items.push({
      id: `xvideos:${id}`,
      src: 'xvideos',
      title: decodeEntities(title).replace(/\s+/g, ' ').trim(),
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
