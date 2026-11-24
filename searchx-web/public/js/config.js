import { HENTAI_SUBREDDITS } from './shared/reddit.js';

export const APP_VERSION = '2.4.0';

// Rule34 first: in the mixed results its posts come first (round-robin follows this order).
export const SOURCES = {
  rule34: { name: 'Rule34', badge: 'R34', color: '#46a758', types: ['video', 'gif', 'image'], note: 'Clé API gratuite requise (voir plus bas).' },
  reddit: { name: 'Reddit', badge: 'RD', color: '#ff5f1f', types: ['video', 'gif', 'image'], note: 'Interrogé directement depuis ton téléphone.' },
  redgifs: { name: 'RedGIFs', badge: 'RG', color: '#e93d82', types: ['gif', 'image'], note: 'Jeton gratuit automatique.' },
  eporner: { name: 'Eporner', badge: 'EP', color: '#3e8ef7', types: ['video'], note: 'API officielle, catalogue HD.' },
  xhamster: { name: 'xHamster', badge: 'XH', color: '#f76b15', types: ['video'], note: 'API du site, sinon page de recherche.' },
  xvideos: { name: 'xVideos', badge: 'XV', color: '#e5484d', types: ['video'], note: 'Recherche du site.' },
  redtube: { name: 'RedTube', badge: 'RT', color: '#d6293d', types: ['video'], note: 'API officielle.' }
};

export const SOURCE_ORDER = Object.keys(SOURCES);

// ---- hentai mode ---------------------------------------------------------------------------------
// Video sites and RedGIFs get "hentai" added to the query, Reddit searches the hentai subreddits,
// Rule34 is drawn content already.
const HENTAI_PREFIXED = new Set(['xvideos', 'xhamster', 'redtube', 'eporner', 'redgifs']);
const ALREADY_DRAWN = /\b(?:hentai|anime|animated|animation|cartoon|3d|3dcg|sfm|mmd|rule ?34|r34|ecchi|doujin|doujinshi|manga|futa|futanari)\b/i;

/** The query actually sent to a source. */
export function sourceQuery(src, q, hentai) {
  const t = String(q || '').trim();
  if (!hentai || !HENTAI_PREFIXED.has(src) || ALREADY_DRAWN.test(t)) return t;
  return `hentai ${t}`;
}

/** Home-screen categories (adult themes only). `q` is what gets searched. */
export const HENTAI_CATEGORIES = [
  { q: 'uncensored', fr: 'Non censuré', jp: '無修正' },
  { q: 'animated', fr: 'Animé', jp: 'アニメ' },
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
  { q: 'bondage', fr: 'Bondage', jp: '緊縛' }
];

export const THEMES = [['hentai', 'Hentai néon'], ['classic', 'Sobre (noir et rouge)']];

/** The site's own search page for a query (fallback when a source can't be searched from here). */
export function siteSearchUrl(src, query, { hentai = false } = {}) {
  const q = sourceQuery(src, query, hentai);
  const e = encodeURIComponent(q);
  const dashed = encodeURIComponent(q.toLowerCase().replace(/\s+/g, '-'));
  const tags = encodeURIComponent(q.toLowerCase().replace(/\s+/g, '_'));
  switch (src) {
    case 'xvideos': return `https://www.xvideos.com/?k=${e}`;
    case 'xhamster': return `https://xhamster.com/search/${e}`;
    case 'redtube': return `https://www.redtube.com/?search=${e}`;
    case 'eporner': return `https://www.eporner.com/search/${dashed}/`;
    case 'rule34': return `https://rule34.xxx/index.php?page=post&s=list&tags=${tags}`;
    case 'redgifs': return `https://www.redgifs.com/search?query=${e}`;
    case 'reddit': return hentai
      ? `https://www.reddit.com/r/${HENTAI_SUBREDDITS.join('+')}/search/?q=${e}&restrict_sr=1&include_over_18=1`
      : `https://www.reddit.com/search/?q=${e}&include_over_18=1`;
    default: return null;
  }
}

export const DEFAULT_FILTERS = { media: 'all', dur: 'any', hd: 'any', sort: 'relevance', sources: SOURCE_ORDER.slice() };

export const MEDIA_OPTIONS = [['all', 'Tout'], ['video', 'Vidéos'], ['gif', 'GIFs'], ['image', 'Images']];
export const DUR_OPTIONS = [['any', 'Toutes durées'], ['short', 'Moins de 10 min'], ['medium', '10 à 30 min'], ['long', 'Plus de 30 min']];
export const HD_OPTIONS = [['any', 'Toute qualité'], ['hd', 'HD (720p+)'], ['uhd', '4K']];
export const SORT_OPTIONS = [['relevance', 'Pertinence'], ['views', 'Plus vues'], ['newest', 'Plus récentes'], ['rating', 'Mieux notées']];
export const LOCK_DELAYS = [[0, "Dès que je quitte l'app"], [60, 'Après 1 minute'], [300, 'Après 5 minutes'], [900, 'Après 15 minutes']];
export const LAYOUTS = [['grid2', 'Grille'], ['grid3', 'Compacte'], ['list', 'Liste']];

export const POPULAR = [
  'amateur', 'anal', 'asian', 'big ass', 'big tits', 'blonde', 'blowjob', 'brunette', 'compilation', 'cosplay',
  'couple', 'creampie', 'cumshot', 'ebony', 'hentai', 'homemade', 'latina', 'lesbian', 'massage', 'milf',
  'missionary', 'orgasm', 'pov', 'public', 'redhead', 'solo', 'squirt', 'threesome', 'toys', 'webcam'
];

export const INSTALL_ICONS = {
  app: { name: 'SearchX', label: 'SearchX', manifest: 'manifest.webmanifest', icon: 'icons/app-180.png' },
  classic: { name: 'SearchX', label: 'Sobre', manifest: 'manifest-classic.webmanifest', icon: 'icons/classic-180.png' },
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
  theme: 'hentai',      // 'hentai' (neon) | 'classic'
  hentai: true          // hentai mode: every source is steered towards hentai
};
