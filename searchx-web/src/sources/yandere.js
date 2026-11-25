import { upstream } from '../lib.js';
import { yandereUrl, parseYandere } from '../../public/js/shared/apis.js';
import { BOORU_NEGATIVE_TAGS } from '../../public/js/shared/safety.js';

// yande.re — high-resolution scans (Moebooru API, no key needed). Typed words are turned into
// the site's real tags first ("tentacle" → tentacles).
const json = url => upstream(url, { as: 'json', headers: { Accept: 'application/json' }, timeout: 10000 });

async function resolve(term, { loose }) {
  const name = term.trim().toLowerCase().replace(/\s+/g, '_');
  try {
    const list = await json(`https://yande.re/tag.json?${new URLSearchParams({ name, order: 'count', limit: '8' })}`);
    const tags = (Array.isArray(list) ? list : []).map(t => String(t?.name || '')).filter(Boolean);
    return tags.find(t => t === name) || tags.find(t => t.startsWith(name)) || (loose ? tags[0] : null) || null;
  } catch {
    return name;
  }
}

export async function yandereTags(q) {
  const raw = String(q || '').trim().toLowerCase();
  if (raw.includes(',')) return raw.split(',').map(t => t.trim().replace(/\s+/g, '_')).filter(Boolean);
  const whole = await resolve(raw, { loose: !raw.includes(' ') });
  if (whole) return [whole];
  const parts = (await Promise.all(raw.split(/\s+/).slice(0, 3).map(w => resolve(w, { loose: false })))).filter(Boolean);
  return parts.length ? parts : [raw.replace(/\s+/g, '_')];
}

export async function search({ q, page, sort }) {
  const tags = await yandereTags(q);
  const posts = await json(yandereUrl({ tags, page, sort, negative: BOORU_NEGATIVE_TAGS.slice(0, 5) }));
  return { items: parseYandere(posts), more: Array.isArray(posts) && posts.length >= 40, tags };
}
