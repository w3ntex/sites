// Keeps the two modes apart and the results on topic:
//  - porn mode never shows drawn content (hentai, anime, 3D…), hentai mode never real photos;
//  - every saved item (favorites, history, playlists) belongs to the mode it was found in;
//  - common French words are searched in English (the sites tag in English), and the sources
//    whose search is loose (RedGIFs, X) only keep results that contain every word searched.

import { looksDrawn } from './shared/safety.js';
import { HENTAI_CATEGORIES } from './config.js';

const HENTAI_ONLY = new Set(['hstream', 'r34video', 'rule34', 'danbooru', 'yandere']);
// RedGIFs / booru tags that mark drawn or animated content.
const DRAWN_TAG = /^(?:hentai|hentai gifs?|anime|anime girls?|animation|animated|3d|3d animation|3d porn|cartoon|cartoons|toon|sfm|source filmmaker|blender|rule ?34|r34|furry|yiff|ai|ai generated|ai art|ai porn|drawn|drawing|art|comic|comics|manga|doujin|doujinshi|futanari|futa|koikatsu|mmd|honey select|cgi|monster girl|tentacles?|ecchi|waifu)$/i;
// Booru tags that mark photos of real people.
const REAL_TAG = /^(?:photo_\(medium\)|real_life|cosplay_photo|real_person)$/i;

export function isDrawnItem(it) {
  if (HENTAI_ONLY.has(it?.src)) return true;
  const tags = (it?.tags || []).map(t => String(t).trim());
  if (tags.some(t => DRAWN_TAG.test(t))) return true;
  return looksDrawn(it?.title) || tags.some(looksDrawn);
}

export function isRealPhotoItem(it) {
  return (it?.tags || []).some(t => REAL_TAG.test(String(t).trim()));
}

/** porn mode: no drawn content; hentai mode: no photos of real people. */
export function fitsMode(it, mode) {
  return mode === 'hentai' ? !isRealPhotoItem(it) : !isDrawnItem(it);
}

/** The mode an item belongs to (saved with it since v2.5.1; guessed for older items). */
export function itemMode(it) {
  if (it?.mode === 'porn' || it?.mode === 'hentai') return it.mode;
  if (HENTAI_ONLY.has(it?.src)) return 'hentai';
  return isDrawnItem(it) ? 'hentai' : 'porn';
}

const HENTAI_WORDS = new Set(HENTAI_CATEGORIES.map(c => c.q));

/** Is this query about drawn content (for porn mode: "that's hentai, switch mode")? */
export function isHentaiQuery(q) {
  const t = String(q || '').trim().toLowerCase();
  return /\b(?:hentai|anime|manga|doujin|doujinshi|ecchi|rule ?34|r34|sfm|koikatsu|mmd|futanari|futa|waifu|cartoon|3dcg)\b/.test(t);
}

/** Old (mixed) recent searches → one list per mode. */
export function splitRecents(list) {
  const out = { porn: [], hentai: [] };
  for (const q of Array.isArray(list) ? list : []) {
    const t = String(q || '').toLowerCase();
    (isHentaiQuery(t) || HENTAI_WORDS.has(t) ? out.hentai : out.porn).push(q);
  }
  return out;
}

// ---- French → English ---------------------------------------------------------------------------

const FR_EN = {
  // phrases first (longest match wins)
  'branlette espagnole': 'titjob', 'femme fontaine': 'squirt', 'plan à trois': 'threesome', 'plan a trois': 'threesome',
  'gros seins': 'big tits', 'petits seins': 'small tits', 'seins naturels': 'natural tits', 'gros cul': 'big ass',
  'grosses fesses': 'big ass', 'belle mère': 'stepmom', 'belle-mère': 'stepmom', 'non censuré': 'uncensored', 'non censure': 'uncensored',
  'en public': 'public', 'sexe en public': 'public', 'fille chat': 'cat girl', 'femme chat': 'cat girl', 'salle de sport': 'gym',
  // words
  infirmiere: 'nurse', 'infirmière': 'nurse', prof: 'teacher', professeure: 'teacher', rousse: 'redhead', rousses: 'redhead',
  brune: 'brunette', brunes: 'brunette', blondes: 'blonde', fellation: 'blowjob', pipe: 'blowjob', sodomie: 'anal',
  lesbienne: 'lesbian', lesbiennes: 'lesbian', asiatique: 'asian', asiatiques: 'asian', japonaise: 'japanese', 'coréenne': 'korean',
  coreenne: 'korean', chinoise: 'chinese', arabe: 'arab', 'française': 'french', francaise: 'french', russe: 'russian',
  'brésilienne': 'brazilian', bresilienne: 'brazilian', colombienne: 'colombian', indienne: 'indian', noire: 'ebony',
  amatrice: 'amateur', cougar: 'milf', 'éjaculation': 'cumshot', ejaculation: 'cumshot', faciale: 'facial', branlette: 'handjob',
  levrette: 'doggystyle', missionnaire: 'missionary', 'chevauchée': 'riding', chevauchee: 'riding', gode: 'dildo',
  jouet: 'toy', jouets: 'toys', douche: 'shower', bain: 'bath', plage: 'beach', piscine: 'pool', voiture: 'car',
  bureau: 'office', cuisine: 'kitchen', bas: 'stockings', collants: 'pantyhose', talons: 'heels', pieds: 'feet',
  poilue: 'hairy', 'rasée': 'shaved', rasee: 'shaved', 'tatouée': 'tattoo', tatouee: 'tattoo', tatouages: 'tattoo',
  lunettes: 'glasses', trio: 'threesome', partouze: 'orgy', masseuse: 'massage', exhib: 'public', exhibition: 'public',
  soumise: 'submissive', 'fessée': 'spanking', fessee: 'spanking', danse: 'dance', cocu: 'cuckold', 'échangiste': 'swinger',
  echangiste: 'swinger', sportive: 'fitness', ronde: 'curvy', maigre: 'skinny', enceinte: 'pregnant', baignoire: 'bath',
  elfe: 'elf', elfes: 'elf', succube: 'succubus', tentacule: 'tentacles', tentacules: 'tentacles', soubrette: 'maid',
  'démone': 'demon girl', demone: 'demon girl', 'sorcière': 'witch', sorciere: 'witch', monstre: 'monster'
};
const PHRASES = Object.keys(FR_EN).filter(k => k.includes(' ')).sort((a, b) => b.length - a.length);

/** "gros seins rousse" → "big tits redhead". Words without a translation are kept as typed. */
export function translateQuery(q) {
  let t = ` ${String(q || '').trim().toLowerCase().replace(/\s+/g, ' ')} `;
  if (t.trim().startsWith('@')) return String(q || '').trim();
  for (const p of PHRASES) t = t.split(` ${p} `).join(` ${FR_EN[p]} `);
  return t.trim().split(' ').map(w => FR_EN[w] || w).join(' ');
}

// ---- exact keyword match --------------------------------------------------------------------------

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'with', 'in', 'on', 'de', 'la', 'le', 'les', 'et', 'du', 'des', 'en', 'avec']);

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_#-]/g, ' ');
}

export function keywords(q) {
  return norm(q).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w));
}

/** Every word of the search appears in the item (title, tags, creator), singular or plural. */
export function matchesKeywords(it, words) {
  if (!words.length) return true;
  const hay = ` ${norm([it.title, ...(it.tags || []), ...(it.by || [])].join(' ')).replace(/[^a-z0-9]+/g, ' ')} `;
  return words.every(w => {
    const stem = w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
    // Word starts ("blonde" in "blondes"), or inside a longer word for long ones ("milf" in "hotmilf" no, "squirt" in "squirting" yes).
    return hay.includes(` ${w}`) || hay.includes(` ${stem}`) || (w.length >= 5 && hay.includes(w));
  });
}

/** Sources whose own search is loose: only results containing every word are kept. */
export const KEYWORD_FILTERED = new Set(['redgifs', 'x']);

/** In hentai mode every site is hentai: "hentai" / "anime" in the words add nothing and hide title matches. */
export function forMode(q, mode) {
  if (mode !== 'hentai' || /^@/.test(q)) return q;
  const t = String(q).replace(/\b(?:hentai|anime)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return t || q;
}
