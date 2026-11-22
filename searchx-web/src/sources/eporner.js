import { upstream } from '../lib.js';
import { epornerSearchUrl, parseEporner, epornerMore } from '../../public/js/shared/apis.js';

// Eporner public JSON API v2 (the app first tries it straight from the phone).
export async function search({ q, page, sort, hd }) {
  const data = await upstream(epornerSearchUrl({ q, page, sort, hd }), { as: 'json', headers: { Accept: 'application/json' } });
  const items = parseEporner(data);
  return { items, more: epornerMore(data, page, items) };
}

export { parseEporner };
