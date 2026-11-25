import { upstream, UpstreamError, DESKTOP_UA, decodeEntities, stripTags } from '../lib.js';

// X (Twitter) through Nitter mirrors (X itself needs a logged-in account). Two kinds of queries:
//   "@name"  → that account's latest photos and videos (works well)
//   words    → X's media search, which hides most adult posts from logged-out readers
// Media files come straight from X's CDN (pbs.twimg.com / video.twimg.com), which the phone can load.

export const NITTER_INSTANCES = ['nitter.mie.foundation', 'nitter.tiekoetter.com', 'nitter.privacyredirect.com', 'nitter.catsarch.com'];
let preferred = null; // last instance that answered, for this isolate

const ACCOUNT = /^(?:@|from:)?([A-Za-z0-9_]{1,15})$/;

/** "@name" / "from:name" → "name"; anything else → null. */
export function accountOf(q) {
  const t = String(q || '').trim();
  if (!/^(@|from:)/i.test(t)) return null;
  const m = ACCOUNT.exec(t);
  return m ? m[1] : null;
}

/** Nitter "/pic/…" proxy URL → the original X CDN URL. */
export function twimgUrl(u) {
  if (!u) return null;
  let s = decodeEntities(String(u));
  const i = s.indexOf('/pic/');
  if (i < 0) return /^https:\/\/(pbs|video)\.twimg\.com\//.test(s) ? s : null;
  s = decodeURIComponent(s.slice(i + 5)).replace(/^orig\//, '');
  if (/^https?:\/\//.test(s)) return s.replace(/^http:/, 'https:');
  if (s.startsWith('video.twimg.com/')) return `https://${s}`;
  return `https://pbs.twimg.com/${s.replace(/^\/+/, '')}`;
}

function rfc822ToUnix(s) {
  const ms = Date.parse(s || '');
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

function tag(name, xml) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() : '';
}

/** Nitter RSS (search or account media) → SearchX items (one per photo / video). */
export function parseNitterRss(xml) {
  const text = String(xml || '');
  const channel = text.slice(0, Math.max(0, text.indexOf('<item>')));
  const channelTitle = decodeEntities(tag('title', channel));
  const profile = /\/\s*@/.test(channelTitle)
    ? { name: channelTitle.split(' / @')[0].trim(), user: (channelTitle.split(' / @')[1] || '').trim(), avatar: twimgUrl(tag('url', tag('image', channel))) }
    : null;
  const items = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const desc = decodeEntities(tag('description', it).replace(/^<!\[CDATA\[|\]\]>$/g, ''));
    const user = decodeEntities(tag('dc:creator', it)).replace(/^@/, '');
    const link = decodeEntities(tag('link', it));
    const id = (/\/status\/(\d+)/.exec(link) || [])[1] || tag('guid', it);
    if (!id || !user) continue;
    const words = stripTags(desc.replace(/<a [^>]*>[\s\S]*?<\/a>/g, ' ')).replace(/\bVideo\b|\bGif\b/g, '').trim();
    const title = words || stripTags(decodeEntities(tag('title', it))) || `@${user}`;
    const date = rfc822ToUnix(tag('pubDate', it));
    const url = `https://x.com/${user}/status/${id}`;
    const pics = [...desc.matchAll(/<img[^>]+src="([^"]+)"/g)].map(x => twimgUrl(x[1])).filter(Boolean);
    let n = 0;
    for (const pic of pics) {
      const base = { src: 'x', title, dur: null, views: null, rating: null, likes: null, url, embed: null, h: null, date, tags: [], by: [`@${user}`], tweet: id, user };
      if (/\/tweet_video_thumb\//.test(pic)) {
        // X "GIF": a short looping mp4 with a predictable address.
        const key = (/tweet_video_thumb\/([^./?]+)/.exec(pic) || [])[1];
        items.push({ ...base, id: `x:${id}:${n++}`, type: 'gif', thumb: pic, media: key ? `https://video.twimg.com/tweet_video/${key}.mp4` : null, preview: key ? `https://video.twimg.com/tweet_video/${key}.mp4` : null });
      } else if (/(amplify_video_thumb|ext_tw_video_thumb)\//.test(pic)) {
        // Real video: its file address is read from the post page when it is opened (/api/xvideo).
        items.push({ ...base, id: `x:${id}:${n++}`, type: 'video', thumb: pic, media: null });
      } else if (/pbs\.twimg\.com\/media\//.test(pic)) {
        const clean = pic.split('?')[0];
        items.push({ ...base, id: `x:${id}:${n++}`, type: 'image', thumb: `${clean}?name=small`, thumb2: clean, media: `${clean}?name=large`, full: `${clean}?name=orig` });
      }
    }
  }
  return { items, profile };
}

/** Video file addresses found on a Nitter post page → best mp4 (or the HLS playlist). */
export function pickTwitterVideo(html) {
  const found = new Set();
  for (const m of String(html || '').matchAll(/https?%3A%2F%2Fvideo\.twimg\.com[^"'<>\s]+|https?:\/\/video\.twimg\.com[^"'<>\s]+/g)) {
    let u = m[0];
    try { if (u.includes('%2F')) u = decodeURIComponent(u); } catch { /* keep */ }
    found.add(decodeEntities(u).replace(/^http:/, 'https:'));
  }
  const list = [...found];
  const mp4 = list.filter(u => /\.mp4(\?|$)/.test(u))
    .map(u => ({ u, px: (/\/(\d+)x(\d+)\//.exec(u) || []).slice(1).reduce((a, b) => a * Number(b), 1) }))
    .sort((a, b) => b.px - a.px);
  if (mp4.length) return { url: mp4[0].u, hls: false };
  const m3u8 = list.find(u => /\.m3u8(\?|$)/.test(u));
  return m3u8 ? { url: m3u8, hls: true } : null;
}

/** GET a path on the first Nitter mirror that answers with the expected content. */
async function nitter(path, check, { emptyOn404 = false } = {}) {
  const order = preferred ? [preferred, ...NITTER_INSTANCES.filter(h => h !== preferred)] : NITTER_INSTANCES;
  const failures = [];
  for (const host of order) {
    try {
      const { text, res } = await upstream(`https://${host}${path}`, { as: 'page', ua: DESKTOP_UA, timeout: 9000, headers: { Accept: 'application/rss+xml,text/html;q=0.9,*/*;q=0.5' } });
      if (!check(text)) {
        const title = (/<title[^>]*>([^<]{0,80})/i.exec(text) || [])[1] || `${Math.round(text.length / 1024)} Ko`;
        failures.push(`${host}: ${res.status} « ${title.trim()} »`);
        continue;
      }
      preferred = host;
      return text;
    } catch (e) {
      failures.push(`${host}: ${e.status || e.kind || e.message}`);
      if (e instanceof UpstreamError && e.status === 404) {
        // Nitter answers 404 for an unknown account, and for a search without any result.
        if (emptyOn404) { preferred = host; return ''; }
        if (path.includes('/media/rss')) throw new UpstreamError('unexpected', 404, "Ce compte X n'existe pas (ou est suspendu).", failures.join(' | '));
      }
    }
  }
  throw new UpstreamError('blocked', 0, "Aucun miroir de X (Nitter) ne répond au serveur pour le moment. X n'est lisible que via ces miroirs bénévoles.", failures.join(' | ').slice(0, 300));
}

const isRss = text => /<rss[\s>]/.test(text) && /<channel>/.test(text);

export async function search({ q, page }) {
  if (page > 1) return { items: [], more: false }; // RSS feeds have a single page
  const account = accountOf(q);
  const path = account
    ? `/${encodeURIComponent(account)}/media/rss`
    : `/search/rss?${new URLSearchParams({ f: 'media', q })}`;
  const xml = await nitter(path, isRss, { emptyOn404: !account });
  const { items, profile } = parseNitterRss(xml);
  return { items, more: false, profile: account ? (profile || { user: account }) : null };
}

/** Direct file of a video post (for /api/xvideo). */
export async function videoUrl(user, id) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(user || '') || !/^\d{5,25}$/.test(id || '')) throw new UpstreamError('http', 400, 'Lien de publication invalide.');
  const html = await nitter(`/${user}/status/${id}`, t => /video\.twimg\.com|<video/.test(t));
  const v = pickTwitterVideo(html);
  if (!v) throw new UpstreamError('unexpected', 200, 'Vidéo introuvable sur cette publication.');
  return v;
}
