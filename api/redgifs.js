// SearchX — RedGIFs relay (Vercel serverless function, Node runtime).
//
// RedGIFs limits Cloudflare's servers (where the SearchX Worker runs) and only lets its own
// website call its search API from a browser. This small function runs on Vercel instead and
// answers the SearchX app directly (CORS open), so RedGIFs searches work again.
//
//   GET /api/redgifs?query=<words>&order=score&page=1[&type=g|i][&tags=Hentai]
//
// RedGIFs' temporary tokens are tied to the address and User-Agent that asked for them, so the
// token is fetched and used from here, with the same User-Agent, and renewed when refused.

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json', Origin: 'https://www.redgifs.com', Referer: 'https://www.redgifs.com/' };
const PARAMS = ['query', 'tags', 'order', 'count', 'page', 'type', 'verified'];
const ORDERS = new Set(['top', 'top7', 'top28', 'latest', 'score', 'trending']);
// Only what the app shows (the full answer is several times bigger).
const KEEP = ['id', 'urls', 'tags', 'type', 'description', 'userName', 'views', 'likes', 'width', 'height', 'createDate', 'duration', 'hasAudio', 'niches'];

let token = null;

async function newToken() {
  const r = await fetch('https://api.redgifs.com/v2/auth/temporary', { headers: HEADERS });
  if (!r.ok) {
    const e = new Error(r.status === 429 ? 'RedGIFs limite aussi ce relais pour le moment (429).' : `Jeton RedGIFs refusé (${r.status}).`);
    e.status = r.status;
    throw e;
  }
  token = (await r.json()).token;
  return token;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') return send(res, 405, { error: 'GET seulement.' });

  const input = new URL(req.url, 'https://relay.local').searchParams;
  const params = new URLSearchParams();
  for (const k of PARAMS) {
    const v = input.get(k);
    if (v && v.length <= 200) params.set(k, v);
  }
  if (input.get('ping') === '1') return send(res, 200, { ok: true, relay: 'searchx-redgifs', version: 1 });
  if (!params.get('query') && !params.get('tags')) return send(res, 400, { error: 'Recherche vide.' });
  if (!ORDERS.has(params.get('order') || '')) params.set('order', 'score');
  params.set('count', String(Math.min(80, Math.max(10, parseInt(params.get('count') || '40', 10) || 40))));
  params.set('page', String(Math.min(500, Math.max(1, parseInt(params.get('page') || '1', 10) || 1))));
  const url = `https://api.redgifs.com/v2/gifs/search?${params}`;

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const t = attempt === 0 && token ? token : await newToken();
      const r = await fetch(url, { headers: { ...HEADERS, Authorization: `Bearer ${t}` } });
      if (r.status === 401) { token = null; continue; } // token from another address, or expired
      if (!r.ok) return send(res, r.status, { error: `RedGIFs a répondu ${r.status}.` });
      const data = await r.json();
      const gifs = (data.gifs || []).map(g => Object.fromEntries(KEEP.filter(k => g[k] !== undefined).map(k => [k, g[k]])));
      return send(res, 200, { page: data.page, pages: data.pages, total: data.total, gifs });
    }
    return send(res, 502, { error: 'RedGIFs refuse les jetons de ce relais.' });
  } catch (e) {
    return send(res, e.status === 429 ? 429 : 502, { error: e.message || String(e) });
  }
};
