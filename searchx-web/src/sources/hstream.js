import { upstream, unexpectedPage, decodeEntities, stripTags, absUrl, compactNumber } from '../lib.js';

// hstream.moe — hentai episodes in HD / 4K. Its search page is server-rendered (Livewire).
// "school-girl" episodes are always excluded (minor-safety rule for drawn content).
const BASE = 'https://hstream.moe';
const PER_PAGE = 25;
const SAFETY_BLACKLIST = ['school-girl'];

// Words that are also hstream genres: searching the genre is far more precise than the titles.
const GENRES = {
  uncensored: 'uncensored', '3d': '3d', milf: 'milf', 'big breasts': 'big-boobs', 'big boobs': 'big-boobs', 'gros seins': 'big-boobs',
  elf: 'elf', elfe: 'elf', succubus: 'succubus', succube: 'succubus', 'monster girl': 'monster', monster: 'monster',
  tentacle: 'tentacle', tentacles: 'tentacle', tentacules: 'tentacle', futanari: 'futanari', futa: 'futanari', yuri: 'yuri',
  ahegao: 'ahegao', netorare: 'ntr', ntr: 'ntr', maid: 'maid', soubrette: 'maid', bondage: 'bondage', bdsm: 'bdsm',
  anal: 'anal', creampie: 'creampie', harem: 'harem', nurse: 'nurse', teacher: 'teacher', orc: 'orc', pregnant: 'pregnant',
  lactation: 'lactation', 'mind control': 'mind-control', 'mind break': 'mind-break', vanilla: 'vanilla', cosplay: 'cosplay',
  'dark skin': 'dark-skin', glasses: 'glasses', gangbang: 'gangbang', threesome: 'threesome', 'x-ray': 'x-ray', virgin: 'virgin',
  'swim suit': 'swim-suit', swimsuit: 'swim-suit', tsundere: 'tsundere', inflation: 'inflation', fantasy: 'fantasy', '4k': '4k'
};
const ORDERS = { views: 'view-count', rating: 'most-likes', newest: 'recently-released' };

export function hstreamUrl({ q, page = 1, sort = 'relevance' }) {
  const p = new URLSearchParams();
  const genre = GENRES[String(q || '').trim().toLowerCase()];
  if (genre) p.append('tags[]', genre);
  else p.set('search', q);
  for (const b of SAFETY_BLACKLIST) p.append('blacklist[]', b);
  if (ORDERS[sort]) p.set('order', ORDERS[sort]);
  if (page > 1) p.set('page', String(page));
  return `${BASE}/search?${p}`;
}

// The markup changes now and then (attributes on their own lines since November 2026): every pattern
// accepts any spacing and attribute order.
export function parseHstream(html) {
  const items = [];
  const parts = String(html || '').split(/<div\s+wire:key="episode-\d+"[^>]*>/).slice(1);
  for (const raw of parts) {
    const block = raw.split(/<div\s+wire:key="episode-/)[0];
    const href = (/<a\b[^>]*?\bhref="((?:https:\/\/hstream\.moe)?\/hentai\/([a-z0-9-]+))"/i.exec(block) || []);
    if (!href[1]) continue;
    const img = (/<img\b[^>]*?\bsrc="([^"]+)"/i.exec(block) || [])[1];
    const alt = (/<img\b[^>]*?\balt="([^"]+)"/i.exec(block) || [])[1] || '';
    const title = stripTags((/<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(block) || [])[1] || decodeEntities(alt));
    const quality = stripTags((/rounded-full bg-black\/70[^>]*>([\s\S]*?)<\/div>/i.exec(block) || [])[1] || '').toLowerCase();
    const stats = [...block.matchAll(/fa-(eye|heart)[^<]*<\/i>\s*([\d.,]+[kKmM]?)/g)];
    const views = compactNumber((stats.find(s => s[1] === 'eye') || [])[2]);
    const likes = compactNumber((stats.find(s => s[1] === 'heart') || [])[2]);
    items.push({
      id: `hstream:${href[2]}`,
      src: 'hstream',
      title: title || href[2].replace(/-/g, ' '),
      dur: null,
      thumb: absUrl(img, BASE),
      views,
      rating: null,
      likes,
      url: absUrl(href[1], BASE),
      type: 'video',
      media: null,
      embed: null, // hstream refuses to be shown inside another site: opened on hstream.moe
      h: quality.includes('4k') ? 2160 : quality.includes('fhd') || quality.includes('1080') ? 1080 : 720,
      date: null,
      tags: quality ? quality.split('|').map(s => s.trim()).filter(Boolean) : [],
      by: [title.replace(/\s*-\s*\d+\s*$/, '')].filter(Boolean)
    });
  }
  return items.filter(i => i.thumb);
}

export async function search({ q, page, sort }) {
  const res = await upstream(hstreamUrl({ q, page, sort }), { as: 'page', timeout: 15000 });
  const items = parseHstream(res.text);
  if (!items.length && !/wire:key|No results|Aucun|search/i.test(res.text)) throw unexpectedPage(res);
  return { items, more: items.length >= PER_PAGE };
}
