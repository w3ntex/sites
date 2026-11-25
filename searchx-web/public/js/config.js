import { HENTAI_SUBREDDITS } from './shared/reddit.js';

export const APP_VERSION = '2.5.1';

// ---- modes ---------------------------------------------------------------------------------------
// Two separate apps in one: each mode has its own sources (shown one site at a time, never mixed)
// and its own look.
export const MODES = {
  porn: { label: 'Porno', theme: 'porn', sub: 'RedGIFs et X', icon: 'flame' },
  hentai: { label: 'Hentai', theme: 'hentai', sub: 'Hstream, Rule34Video, Rule34…', icon: 'sakura' }
};

/**
 * Sources, in tab order. `modes`: where the source exists; `extra`: off until turned on in Réglages.
 * `strict`: drawn or unverified content, which gets the strict minor-safety rules.
 */
export const SOURCES = {
  // porn
  redgifs: { name: 'RedGIFs', badge: 'RG', color: '#ff4b6e', types: ['video', 'gif', 'image'], modes: ['porn', 'hentai'], note: 'Recherche par mots-clés et tags, très précise.' },
  x: { name: 'X', badge: 'X', color: '#e7e9ea', types: ['video', 'gif', 'image'], modes: ['porn'], strict: true, note: 'Tape @compte pour ses photos et vidéos. Via des miroirs Nitter.' },
  eporner: { name: 'Eporner', badge: 'EP', color: '#3e8ef7', types: ['video'], modes: ['porn'], extra: true, note: 'API officielle, catalogue HD.' },
  xhamster: { name: 'xHamster', badge: 'XH', color: '#f76b15', types: ['video'], modes: ['porn'], extra: true, note: 'API du site, sinon page de recherche.' },
  redtube: { name: 'RedTube', badge: 'RT', color: '#d6293d', types: ['video'], modes: ['porn'], extra: true, note: 'API officielle.' },
  xvideos: { name: 'xVideos', badge: 'XV', color: '#e5484d', types: ['video'], modes: ['porn'], extra: true, note: 'Recherche du site (souvent bloquée).' },
  reddit: { name: 'Reddit', badge: 'RD', color: '#ff5f1f', types: ['video', 'gif', 'image'], modes: ['porn'], extra: true, note: 'Subreddits NSFW.' },
  // hentai
  hstream: { name: 'Hstream', badge: 'HS', color: '#ff4f9a', types: ['video'], modes: ['hentai'], strict: true, note: 'Épisodes hentai HD et 4K (lecture sur hstream.moe).' },
  r34video: { name: 'Rule34Video', badge: 'R3V', color: '#8b5cf6', types: ['video'], modes: ['hentai'], strict: true, note: 'Animations 3D et 2D.' },
  rule34: { name: 'Rule34', badge: 'R34', color: '#46a758', types: ['video', 'gif', 'image'], modes: ['hentai'], strict: true, note: 'Clé API gratuite requise (voir plus bas).' },
  danbooru: { name: 'Danbooru', badge: 'DB', color: '#3b82f6', types: ['image', 'gif', 'video'], modes: ['hentai'], strict: true, note: 'Illustrations anime de qualité.' },
  yandere: { name: 'Yande.re', badge: 'YR', color: '#f0a0a0', types: ['image'], modes: ['hentai'], strict: true, note: 'Images haute résolution.' }
};

export const SOURCE_ORDER = Object.keys(SOURCES);
// RedGIFs comes last in hentai mode (it is not a hentai site, only its Hentai tag is searched).
const MODE_ORDER = {
  porn: ['redgifs', 'x', 'eporner', 'xhamster', 'redtube', 'xvideos', 'reddit'],
  hentai: ['hstream', 'r34video', 'rule34', 'danbooru', 'yandere', 'redgifs']
};

export function modeOf(settings) {
  return settings?.mode === 'hentai' ? 'hentai' : 'porn';
}

/** Every source of a mode, in tab order. */
export function modeSources(mode) {
  return MODE_ORDER[mode] || MODE_ORDER.porn;
}

/** Sources turned on by default (both modes). */
export const DEFAULT_SOURCES = SOURCE_ORDER.filter(s => !SOURCES[s].extra);

export function isStrictSource(src) {
  return Boolean(SOURCES[src]?.strict);
}

/** Home-screen categories (adult themes only). `q` is what gets searched. */
export const HENTAI_CATEGORIES = [
  { q: 'uncensored', fr: 'Non censuré', jp: '無修正' },
  { q: '3d', fr: '3D', jp: '3DCG' },
  { q: 'milf', fr: 'Milf', jp: '人妻' },
  { q: 'big breasts', fr: 'Gros seins', jp: '巨乳' },
  { q: 'elf', fr: 'Elfe', jp: 'エルフ' },
  { q: 'succubus', fr: 'Succube', jp: 'サキュバス' },
  { q: 'monster girl', fr: 'Monster girl', jp: 'モン娘' },
  { q: 'tentacle', fr: 'Tentacules', jp: '触手' },
  { q: 'futanari', fr: 'Futanari', jp: 'ふたなり' },
  { q: 'yuri', fr: 'Yuri', jp: '百合' },
  { q: 'ahegao', fr: 'Ahegao', jp: 'アヘ顔' },
  { q: 'netorare', fr: 'NTR', jp: '寝取られ' },
  { q: 'maid', fr: 'Soubrette', jp: 'メイド' },
  { q: 'bondage', fr: 'Bondage', jp: '緊縛' },
  { q: 'creampie', fr: 'Creampie', jp: '中出し' }
];

export const PORN_CATEGORIES = [
  { q: 'amateur', fr: 'Amateur' }, { q: 'milf', fr: 'MILF' }, { q: 'big tits', fr: 'Gros seins' }, { q: 'big ass', fr: 'Gros cul' },
  { q: 'blonde', fr: 'Blonde' }, { q: 'brunette', fr: 'Brune' }, { q: 'redhead', fr: 'Rousse' }, { q: 'latina', fr: 'Latina' },
  { q: 'asian', fr: 'Asiatique' }, { q: 'ebony', fr: 'Ebony' }, { q: 'lesbian', fr: 'Lesbiennes' }, { q: 'pov', fr: 'POV' },
  { q: 'blowjob', fr: 'Fellation' }, { q: 'anal', fr: 'Anal' }, { q: 'cosplay', fr: 'Cosplay' }, { q: 'squirt', fr: 'Squirt' }
];

/** The site's own search page for a query (when a source can't be searched from here). */
export function siteSearchUrl(src, query, { mode = 'porn' } = {}) {
  const q = String(query || '').trim();
  const e = encodeURIComponent(q);
  const dashed = encodeURIComponent(q.toLowerCase().replace(/\s+/g, '-'));
  const tags = encodeURIComponent(q.toLowerCase().replace(/\s+/g, '_'));
  switch (src) {
    case 'xvideos': return `https://www.xvideos.com/?k=${e}`;
    case 'xhamster': return `https://xhamster.com/search/${e}`;
    case 'redtube': return `https://www.redtube.com/?search=${e}`;
    case 'eporner': return `https://www.eporner.com/search/${dashed}/`;
    case 'rule34': return `https://rule34.xxx/index.php?page=post&s=list&tags=${tags}`;
    case 'redgifs': return mode === 'hentai' ? `https://www.redgifs.com/search?query=${e}&tags=Hentai` : `https://www.redgifs.com/search?query=${e}`;
    case 'reddit': return mode === 'hentai'
      ? `https://www.reddit.com/r/${HENTAI_SUBREDDITS.join('+')}/search/?q=${e}&restrict_sr=1&include_over_18=1`
      : `https://www.reddit.com/search/?q=${e}&include_over_18=1`;
    case 'x': return /^@\w+$/.test(q) ? `https://x.com/${q.slice(1)}/media` : `https://x.com/search?q=${e}&f=media`;
    case 'hstream': return `https://hstream.moe/search?search=${e}`;
    case 'r34video': return `https://rule34video.com/search/${dashed}/`;
    case 'danbooru': return `https://danbooru.donmai.us/posts?tags=${tags}`;
    case 'yandere': return `https://yande.re/post?tags=${tags}`;
    default: return null;
  }
}

export const DEFAULT_FILTERS = { v: 2, media: 'all', dur: 'any', hd: 'any', sort: 'relevance', sources: DEFAULT_SOURCES.slice() };

export const MEDIA_OPTIONS = [['all', 'Tout'], ['video', 'Vidéos'], ['gif', 'GIFs'], ['image', 'Images']];
export const DUR_OPTIONS = [['any', 'Toutes durées'], ['short', 'Moins de 10 min'], ['medium', '10 à 30 min'], ['long', 'Plus de 30 min']];
export const HD_OPTIONS = [['any', 'Toute qualité'], ['hd', 'HD (720p+)'], ['uhd', '4K']];
export const SORT_OPTIONS = [['relevance', 'Pertinence'], ['views', 'Plus vues'], ['newest', 'Plus récentes'], ['rating', 'Mieux notées']];
export const LOCK_DELAYS = [[0, "Dès que je quitte l'app"], [60, 'Après 1 minute'], [300, 'Après 5 minutes'], [900, 'Après 15 minutes']];
export const LAYOUTS = [['grid2', 'Grille'], ['grid3', 'Compacte'], ['list', 'Liste']];

export const POPULAR = [
  'amateur', 'anal', 'asian', 'big ass', 'big tits', 'blonde', 'blowjob', 'brunette', 'compilation', 'cosplay',
  'couple', 'creampie', 'cumshot', 'ebony', 'homemade', 'latina', 'lesbian', 'massage', 'milf',
  'missionary', 'orgasm', 'pov', 'public', 'redhead', 'solo', 'squirt', 'threesome', 'toys', 'webcam'
];

export const INSTALL_ICONS = {
  app: { name: 'SearchX', label: 'SearchX', manifest: 'manifest.webmanifest', icon: 'icons/app-180.png' },
  classic: { name: 'SearchX', label: 'Rouge', manifest: 'manifest-classic.webmanifest', icon: 'icons/classic-180.png' },
  calc: { name: 'Calculatrice', manifest: 'manifest-calc.webmanifest', icon: 'icons/calc-180.png' },
  notes: { name: 'Notes', manifest: 'manifest-notes.webmanifest', icon: 'icons/notes-180.png' },
  clock: { name: 'Horloge', manifest: 'manifest-clock.webmanifest', icon: 'icons/clock-180.png' }
};

export const DEFAULT_SETTINGS = {
  ageOK: false,
  haptics: true,
  sandbox: true,        // block popups/redirects inside embedded players
  autoplayGifs: true,
  muteGifs: true,
  blur: true,           // hide content when the app goes to the background
  lockDelay: 0,
  pinHash: null,
  pinSalt: null,
  bioId: null,          // WebAuthn credential id (Face ID / Touch ID)
  installIcon: 'app',
  layout: 'grid2',
  previews: true,       // animated previews of GIFs in the grid
  autoplayVideos: false, // start embedded players as soon as the slide is shown
  r34key: '',
  r34user: '',
  accessKey: '',
  mode: 'porn'          // 'porn' | 'hentai' (also picks the theme)
};
