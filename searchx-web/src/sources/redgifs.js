import { upstream, absUrl, num, UpstreamError } from '../lib.js';

let token = null;
let tokenExpiry = 0;

async function bearer(env, force = false) {
  if (env?.REDGIFS_TOKEN) return env.REDGIFS_TOKEN;
  if (!force && token && Date.now() < tokenExpiry) return token;
  const data = await upstream('https://api.redgifs.com/v2/auth/temporary', { as: 'json', headers: { Accept: 'application/json' } });
  if (!data?.token) throw new UpstreamError('auth', 0, 'RedGIFs a refusé de fournir un jeton.');
  token = data.token;
  tokenExpiry = Date.now() + 20 * 3600 * 1000;
  return token;
}

export async function search({ q, page, sort, media, env }) {
  const order = { relevance: 'trending', views: 'top', newest: 'latest', rating: 'best' }[sort] || 'trending';
  const p = new URLSearchParams({ search_text: q, order, count: '40', page: String(page) });
  if (media === 'image') p.set('type', 'i');
  else if (media === 'gif' || media === 'video') p.set('type', 'g');

  const run = async force => upstream(`https://api.redgifs.com/v2/gifs/search?${p}`, {
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
  const pages = num(data?.pages);
  return { items, more: pages != null ? page < pages : items.length >= 40 };
}

export function parseRedGifs(data) {
  const out = [];
  for (const g of data?.gifs || []) {
    const urls = g?.urls || {};
    const thumb = absUrl(urls.poster) || absUrl(urls.thumbnail);
    if (!g?.id || !thumb) continue;
    const tags = Array.isArray(g.tags) ? g.tags.map(String) : [];
    const isImage = num(g.type) === 2;
    const title = (g.description && String(g.description).trim()) || tags.slice(0, 4).join(', ') || `@${g.userName || 'redgifs'}`;
    out.push({
      id: `redgifs:${g.id}`,
      src: 'redgifs',
      title,
      dur: null,
      thumb,
      views: num(g.views),
      rating: null,
      likes: num(g.likes),
      url: `https://www.redgifs.com/watch/${g.id}`,
      type: isImage ? 'image' : 'gif',
      media: absUrl(urls.hd) || absUrl(urls.sd),
      embed: isImage ? null : `https://www.redgifs.com/ifr/${g.id}`,
      h: num(g.height),
      w: num(g.width),
      date: num(g.createDate),
      tags,
      by: g.userName ? [String(g.userName)] : []
    });
  }
  return out;
}
