import { upstream, UpstreamError } from '../lib.js';
import { REDGIFS_TOKEN_URL, redgifsSearchUrl, parseRedGifs, redgifsMore } from '../../public/js/shared/apis.js';

// Server-side fallback (the app first calls RedGIFs straight from the phone).
let token = null;
let tokenExpiry = 0;
const TOKEN_KEY = 'https://cache.searchx/redgifs-token';

async function bearer(env, force = false) {
  if (env?.REDGIFS_TOKEN) return env.REDGIFS_TOKEN;
  if (!force && token && Date.now() < tokenExpiry) return token;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (!force && cache) {
    const hit = await cache.match(TOKEN_KEY);
    if (hit) {
      const t = await hit.text();
      if (t) { token = t; tokenExpiry = Date.now() + 3600 * 1000; return t; }
    }
  }
  const data = await upstream(REDGIFS_TOKEN_URL, { as: 'json', headers: { Accept: 'application/json' } });
  if (!data?.token) throw new UpstreamError('auth', 0, 'RedGIFs a refusé de fournir un jeton.');
  token = data.token;
  tokenExpiry = Date.now() + 20 * 3600 * 1000;
  if (cache) await cache.put(TOKEN_KEY, new Response(token, { headers: { 'Cache-Control': 'max-age=3600' } }));
  return token;
}

export async function search({ q, page, sort, media, env }) {
  const url = redgifsSearchUrl({ q, page, sort, media });
  const run = async force => upstream(url, {
    as: 'json', headers: { Accept: 'application/json', Authorization: `Bearer ${await bearer(env, force)}` }
  });
  let data;
  try {
    data = await run(false);
  } catch (e) {
    if (e instanceof UpstreamError && e.kind === 'http' && e.status === 401) data = await run(true);
    else throw e;
  }
  const items = parseRedGifs(data);
  return { items, more: redgifsMore(data, page, items) };
}

export { parseRedGifs };
