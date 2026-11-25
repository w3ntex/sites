import { upstream } from '../lib.js';
import { danbooruAutocompleteUrl, parseDanbooruAutocomplete, danbooruPostsUrl, parseDanbooru } from '../../public/js/shared/apis.js';

// Danbooru — anime art. Called from the phone first (the API allows it); this is the fallback.
// Typed words become real tags with the site's autocomplete ("big breasts" → large_breasts).
export async function danbooruTags(q, fetchJSON) {
  const raw = String(q || '').trim().toLowerCase();
  if (raw.includes(',')) return raw.split(',').map(t => t.trim().replace(/\s+/g, '_')).filter(Boolean).slice(0, 2);
  const words = raw.split(/\s+/).filter(Boolean);
  const resolve = async term => {
    try {
      const list = parseDanbooruAutocomplete(await fetchJSON(danbooruAutocompleteUrl(term)));
      return (list.find(t => t.tag === term.replace(/\s+/g, '_')) || list[0] || {}).tag || term.replace(/\s+/g, '_');
    } catch {
      return term.replace(/\s+/g, '_');
    }
  };
  if (words.length <= 1) return [await resolve(raw)];
  const joined = await resolve(words.join(' '));
  if (joined && joined.split('_').length >= words.length) return [joined];
  return Promise.all(words.slice(0, 2).map(resolve));
}

export async function search({ q, page }) {
  const fetchJSON = url => upstream(url, { as: 'json', headers: { Accept: 'application/json' }, timeout: 10000 });
  const tags = await danbooruTags(q, fetchJSON);
  const posts = await fetchJSON(danbooruPostsUrl({ tags, page }));
  return { items: parseDanbooru(posts), more: Array.isArray(posts) && posts.length >= 90, tags };
}
