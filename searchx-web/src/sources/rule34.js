import { upstream, num, UpstreamError } from '../lib.js';
import { BOORU_NEGATIVE_TAGS, isBlockedText } from '../../public/js/shared/safety.js';

// Rule34.xxx — searched like the website: typed words are first turned into real tags with the
// site's own autocomplete ("missionary" → "missionary_position"), then the DAPI is queried.
// Always rating:explicit, always excluding tags that denote minors.

const PER_PAGE = 42;
const suggestCache = new Map();   // per isolate
const resolveCache = new Map();

function credentials(env, request) {
  const h = request?.headers;
  let key = (env?.R34_API_KEY || h?.get('x-r34-key') || '').trim();
  let user = (env?.R34_USER_ID || h?.get('x-r34-user') || '').trim();
  // Accept the whole "&api_key=…&user_id=…" line pasted into either field.
  const line = `${key}&${user}`.replace(/\s+/g, '');
  const k = /api_key=([^&]+)/.exec(line);
  const u = /user_id=([^&]+)/.exec(line);
  if (k) key = k[1];
  if (u) user = u[1];
  if (key.includes('=')) key = '';
  if (user.includes('=')) user = '';
  return { key, user };
}

/** Tag autocomplete, most-used first. Never throws. */
export async function suggestTags(term, { timeout = 6000 } = {}) {
  const q = String(term || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (q.length < 2) return [];
  if (suggestCache.has(q)) return suggestCache.get(q);

  const endpoints = [
    `https://ac.rule34.xxx/autocomplete.php?q=${encodeURIComponent(q)}`,
    `https://api.rule34.xxx/autocomplete.php?q=${encodeURIComponent(q)}`
  ];
  for (const url of endpoints) {
    try {
      const data = await upstream(url, {
        as: 'json', timeout, headers: { Accept: 'application/json', Referer: 'https://rule34.xxx/' }
      });
      if (!Array.isArray(data)) continue;
      const list = parseSuggestions(data);
      suggestCache.set(q, list);
      return list;
    } catch {
      // try the next endpoint
    }
  }
  return [];
}

export function parseSuggestions(data) {
  return (Array.isArray(data) ? data : [])
    .map(item => {
      const tag = String(item?.value || '').toLowerCase().trim();
      const count = parseInt((/\((\d+)\)\s*$/.exec(String(item?.label || '')) || [])[1] || '0', 10);
      return { tag, count };
    })
    .filter(t => t.tag && !BOORU_NEGATIVE_TAGS.includes(t.tag) && !isBlockedText(t.tag))
    .sort((a, b) => b.count - a.count);
}

async function bestTag(word, suggest) {
  const t = word.toLowerCase();
  const list = await suggest(t);
  if (list.some(s => s.tag === t)) return t;
  return (list.find(s => s.tag.startsWith(t)) || {}).tag || t;
}

/**
 * "big tits, blonde" → explicit tags (commas = typing tags).
 * "anime missionary" → one tag if "anime_missionary" exists, otherwise each word resolved.
 * "missionary" → exact tag if it exists, else the most-used tag starting with it.
 */
export async function resolveTags(keyword, suggestFn = suggestTags) {
  const raw = String(keyword || '').trim().toLowerCase();
  if (!raw) return [];
  if (resolveCache.has(raw)) return resolveCache.get(raw);
  // Only remember resolutions made while autocomplete actually answered.
  let answered = false;
  const suggest = async t => {
    const list = await suggestFn(t);
    if (list.length) answered = true;
    return list;
  };

  let tags;
  if (raw.includes(',')) {
    tags = raw.split(',').map(t => t.trim().replace(/\s+/g, '_')).filter(Boolean);
  } else {
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
      tags = [await bestTag(words[0], suggest)];
    } else if (words.some(w => w.includes('_') || w.includes(':'))) {
      tags = words; // already real tags
    } else {
      const joined = words.join('_');
      const list = await suggest(joined);
      if (list.some(s => s.tag === joined)) tags = [joined];
      else {
        const top = list.find(s => s.tag.startsWith(joined));
        tags = top ? [top.tag] : await Promise.all(words.map(w => bestTag(w, suggest)));
      }
    }
  }
  if (answered) resolveCache.set(raw, tags);
  return tags;
}

export async function search({ q, page, sort, media, env, request }) {
  const tags = await resolveTags(q);
  if (!tags.length) return { items: [], more: false };
  const all = [...tags, 'rating:explicit', ...BOORU_NEGATIVE_TAGS.map(t => `-${t}`)];
  if (media === 'gif') all.push('animated', '-video');
  else if (media === 'video') all.push('video');
  else if (media === 'image') all.push('-animated', '-video');
  if (sort === 'views' || sort === 'rating') all.push('sort:score:desc');

  const { key, user } = credentials(env, request);
  const p = new URLSearchParams({
    page: 'dapi', s: 'post', q: 'index', json: '1', limit: String(PER_PAGE),
    pid: String(Math.max(0, page - 1)), tags: all.join(' ')
  });
  if (key) p.set('api_key', key);
  if (user) p.set('user_id', user);

  const text = (await upstream(`https://api.rule34.xxx/index.php?${p}`, { headers: { Accept: 'application/json' } })).trim();
  if (!text) return { items: [], more: false, tags };
  let posts = null;
  try { posts = JSON.parse(text); } catch { /* not JSON: inspected below */ }
  if (!Array.isArray(posts)) {
    // Errors come back as plain text, a JSON string ("Missing authentication…") or an object.
    const message = typeof posts === 'string' ? posts : posts && typeof posts === 'object' ? JSON.stringify(posts) : text;
    const lower = message.slice(0, 300).toLowerCase();
    if (lower.includes('auth') || lower.includes('api key') || lower.includes('api_key')) {
      throw new UpstreamError('auth', 0, key
        ? 'Rule34 refuse ta clé API. Vérifie-la dans Réglages → Sources.'
        : 'Rule34 demande une clé API gratuite : ajoute-la dans Réglages → Sources.');
    }
    if (lower.startsWith('<?xml') || lower.includes('<posts') || (posts && typeof posts === 'object')) return { items: [], more: false, tags };
    throw new UpstreamError('parse');
  }
  const items = parseRule34(posts);
  return { items, more: items.length >= PER_PAGE - 2, tags };
}

export function parseRule34(posts) {
  const out = [];
  for (const p of posts) {
    if (!p || p.id == null) continue;
    if (!String(p.rating || 'explicit').toLowerCase().startsWith('e')) continue;
    const file = p.file_url;
    if (!file || !/^https?:\/\//.test(file)) continue;
    const ext = (file.split('?')[0].split('.').pop() || '').toLowerCase();
    const type = ['mp4', 'webm', 'm4v', 'mov'].includes(ext) ? 'video' : ext === 'gif' ? 'gif' : 'image';
    const sample = /^https?:\/\//.test(p.sample_url || '') ? p.sample_url : null;
    const preview = /^https?:\/\//.test(p.preview_url || '') ? p.preview_url : null;
    const tags = String(p.tags || '').split(/\s+/).filter(Boolean);
    const id = String(p.id);
    out.push({
      id: `rule34:${id}`,
      src: 'rule34',
      title: tags.slice(0, 8).map(t => t.replace(/_/g, ' ')).join(', ') || `Rule34 #${id}`,
      dur: null,
      // Sharper grid thumbnails than the tiny previews (like the site's own grid on retina screens).
      thumb: (type === 'image' && sample) ? sample : (preview || sample || file),
      thumb2: preview,
      views: null,
      rating: null,
      likes: num(p.score),
      url: `https://rule34.xxx/index.php?page=post&s=view&id=${id}`,
      type,
      media: type === 'image' ? (sample || file) : file,
      full: file,
      embed: null,
      h: num(p.height),
      w: num(p.width),
      date: num(p.change),
      tags,
      by: p.owner ? [String(p.owner)] : []
    });
  }
  return out;
}
