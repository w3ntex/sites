import { upstream } from '../lib.js';
import { danbooruTags, danbooruPostsUrl, parseDanbooru, danbooruMore } from '../../public/js/shared/apis.js';

// Danbooru — anime art. Called from the phone first (the API allows it); this is the fallback.
// Typed words become real tags with the site's autocomplete (shared with the phone: apis.js).
export { danbooruTags };

export async function search({ q, page }) {
  const fetchJSON = url => upstream(url, { as: 'json', headers: { Accept: 'application/json' }, timeout: 10000 });
  const tags = await danbooruTags(q, fetchJSON);
  const posts = await fetchJSON(danbooruPostsUrl({ tags, page }));
  return { items: parseDanbooru(posts), more: danbooruMore(posts), tags };
}
