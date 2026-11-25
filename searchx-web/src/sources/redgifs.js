import { upstream, UpstreamError, MOBILE_UA } from '../lib.js';
import { REDGIFS_TOKEN_URL, redgifsSearchUrl, parseRedGifs, redgifsMore } from '../../public/js/shared/apis.js';

// RedGIFs only lets its own website call its search API from a browser, so the search goes through
// the Worker. Its temporary tokens are tied to the IP address and User-Agent that asked for them
// ("WrongSender" otherwise): the token is fetched and used within the same request, with the same
// User-Agent, and fetched again whenever the server's address changed.
const UA = MOBILE_UA;
const FIRST_PARTY = { Accept: 'application/json', Origin: 'https://www.redgifs.com', Referer: 'https://www.redgifs.com/' };
let cached = null; // { token, exp } for this isolate

function tokenExpiry(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp = JSON.parse(atob(part + '==='.slice((part.length + 3) % 4))).exp;
    if (Number.isFinite(exp)) return exp * 1000 - 120 * 1000;
  } catch { /* not a JWT: fall back to a short life */ }
  return Date.now() + 3600 * 1000;
}

async function newToken() {
  let data;
  try {
    data = await upstream(REDGIFS_TOKEN_URL, { as: 'json', ua: UA, headers: FIRST_PARTY, timeout: 10000 });
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 429) {
      throw new UpstreamError('blocked', 429, 'RedGIFs limite le serveur pour le moment (trop de demandes de jeton). Réessaie dans une minute.', e.debug);
    }
    throw e;
  }
  if (!data?.token) throw new UpstreamError('auth', 0, 'RedGIFs a refusé de fournir un jeton.');
  cached = { token: data.token, exp: tokenExpiry(data.token) };
  return cached.token;
}

export async function search({ q, page, sort, media, scope, env }) {
  const url = redgifsSearchUrl({ q, page, sort, media, scope });
  if (env?.REDGIFS_TOKEN) {
    const data = await upstream(url, { as: 'json', ua: UA, headers: { ...FIRST_PARTY, Authorization: `Bearer ${env.REDGIFS_TOKEN}` } });
    const items = parseRedGifs(data);
    return { items, more: redgifsMore(data, page, items) };
  }
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const reuse = attempt === 0 && cached && cached.exp > Date.now();
    const token = reuse ? cached.token : await newToken();
    try {
      const data = await upstream(url, { as: 'json', ua: UA, headers: { ...FIRST_PARTY, Authorization: `Bearer ${token}` } });
      const items = parseRedGifs(data);
      return { items, more: redgifsMore(data, page, items) };
    } catch (e) {
      last = e;
      // WrongSender (token from another server address) or expired token: get a new one.
      if (e instanceof UpstreamError && e.kind === 'http' && e.status === 401) { cached = null; continue; }
      throw e;
    }
  }
  throw new UpstreamError('blocked', 401,
    'RedGIFs a refusé le serveur (son jeton est lié à une adresse IP et celle du serveur change). Réessaie : ça passe souvent au 2e essai.',
    last?.debug || '');
}

export { parseRedGifs };
