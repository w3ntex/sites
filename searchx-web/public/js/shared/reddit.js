// Reddit search, shared by the app (tries Reddit directly from the phone first, which looks like
// normal browsing) and the Worker (fallback). Only NSFW posts that contain media are kept.

export const PRIORITY_SUBREDDITS = [
  'porn', 'nsfw', 'gonewild', 'NSFW_GIF', 'nsfw_gifs', 'porn_gifs', 'RealGirls', 'holdthemoan',
  'NSFW_HTML5', '60fpsporn', 'hentai', 'rule34'
];

const SORTS = { relevance: 'relevance', views: 'top', rating: 'top', newest: 'new' };

/** Cursor format: "p:<after>|g:<after>" (one per listing); empty = first page. */
export function parseCursor(cursor) {
  const out = { p: null, g: null };
  for (const part of String(cursor || '').split('|')) {
    const [k, v] = part.split(':');
    if ((k === 'p' || k === 'g') && v) out[k] = v;
  }
  return out;
}

export function makeCursor(p, g) {
  if (!p && !g) return '';
  return `p:${p || ''}|g:${g || ''}`;
}

/** The two listing URLs (priority subreddits + global search). `null` = listing exhausted. */
export function redditUrls({ q, sort = 'relevance', cursor = '', page = 1, base = 'https://www.reddit.com' }) {
  const s = SORTS[sort] || 'relevance';
  const c = parseCursor(cursor);
  const common = { q, include_over_18: 'on', limit: '50', sort: s, t: 'all', raw_json: '1' };
  const mk = (path, extra, after) => {
    const p = new URLSearchParams({ ...common, ...extra });
    if (after) p.set('after', after);
    return `${base}${path}?${p}`;
  };
  const later = page > 1;
  return {
    priority: later && !c.p ? null : mk(`/r/${PRIORITY_SUBREDDITS.join('+')}/search.json`, { restrict_sr: 'on' }, c.p),
    global: later && !c.g ? null : mk('/search.json', { type: 'link' }, c.g)
  };
}

function cleanUrl(u) {
  if (!u || typeof u !== 'string') return null;
  const s = u.replace(/&amp;/g, '&');
  return /^https?:\/\//.test(s) ? s : null;
}

function ext(u) {
  try { return new URL(u).pathname.split('.').pop().toLowerCase(); } catch { return ''; }
}

/** Normalizes one Reddit listing JSON into SearchX items. */
export function parseRedditListing(json) {
  const children = json?.data?.children || [];
  const items = [];
  for (const child of children) {
    const p = child?.data;
    if (!p || p.over_18 !== true || p.is_self) continue;
    const permalink = p.permalink ? `https://www.reddit.com${p.permalink}` : null;
    if (!permalink) continue;

    const img = p.preview?.images?.[0];
    const link = cleanUrl(p.url_overridden_by_dest || p.url) || '';
    const thumb = cleanUrl(img?.source?.url) || cleanUrl(img?.resolutions?.at?.(-1)?.url) ||
      (String(p.thumbnail || '').startsWith('http') ? cleanUrl(p.thumbnail) : null) ||
      (/\.(jpe?g|png|webp)(\?|$)/i.test(link) ? link : null);
    if (!thumb) continue;

    const domain = String(p.domain || '').toLowerCase();
    const video = p.secure_media?.reddit_video || p.media?.reddit_video;
    const previewVideo = p.preview?.reddit_video_preview;
    let type = null, media = null, embed = null, dur = null;
    let h = img?.source?.height || null;

    if (p.is_video && video?.fallback_url) {
      type = video.is_gif ? 'gif' : 'video';
      media = cleanUrl(video.fallback_url);
      dur = video.duration || null;
      h = video.height || h;
    } else if (domain.includes('redgifs')) {
      type = 'gif';
      const id = (link.match(/redgifs\.com\/(?:watch|ifr)\/([a-z0-9]+)/i) || [])[1];
      if (id) embed = `https://www.redgifs.com/ifr/${id.toLowerCase()}`;
      media = cleanUrl(previewVideo?.fallback_url);
    } else if (/\.gifv?$/i.test(link) || img?.variants?.mp4 || previewVideo) {
      type = 'gif';
      media = cleanUrl(previewVideo?.fallback_url) || cleanUrl(img?.variants?.mp4?.source?.url);
      if (!media && /\.gifv$/i.test(link)) media = link.replace(/\.gifv$/i, '.mp4');
    } else if (p.post_hint === 'image' || ['jpg', 'jpeg', 'png', 'webp'].includes(ext(link))) {
      type = 'image';
      media = link;
    } else if (p.post_hint === 'rich:video' || /xvideos|xhamster|redtube|eporner|pornhub/.test(domain)) {
      type = 'video';
    } else {
      continue; // text post or non-media link
    }

    // Link posts to other video sites open the linked page rather than the Reddit thread.
    const url = (type === 'video' && !media && link && !domain.includes('reddit')) ? link : permalink;
    items.push({
      id: `reddit:${p.id}`,
      src: 'reddit',
      title: `r/${p.subreddit || 'nsfw'} · ${p.title || 'Sans titre'}`,
      dur: type === 'video' ? dur : null,
      thumb,
      views: null,
      rating: typeof p.upvote_ratio === 'number' ? Math.round(p.upvote_ratio * 100) : null,
      likes: typeof p.ups === 'number' ? p.ups : null,
      url,
      type,
      media,
      preview: type === 'gif' && media && /\.mp4(\?|$)/i.test(media) ? media : null,
      embed,
      h,
      date: p.created_utc || null,
      tags: p.link_flair_text ? [String(p.link_flair_text)] : [],
      by: p.author && p.author !== '[deleted]' ? [`u/${p.author}`] : []
    });
  }
  return { items, after: json?.data?.after || null };
}

/** Merges the two listings (priority first), de-duplicated. */
export function mergeRedditResults(priority, global) {
  const seen = new Set();
  const items = [...(priority?.items || []), ...(global?.items || [])].filter(i => !seen.has(i.id) && seen.add(i.id));
  const cursor = makeCursor(priority?.after, global?.after);
  return { items, cursor, more: Boolean(priority?.after || global?.after) };
}
