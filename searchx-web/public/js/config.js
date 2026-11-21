export const APP_VERSION = '1.0.0';

export const SOURCES = {
  xvideos: { name: 'xVideos', badge: 'XV', color: '#e5484d', types: ['video'], note: 'Recherche du site.' },
  xhamster: { name: 'xHamster', badge: 'XH', color: '#f76b15', types: ['video'], note: 'API du site, sinon page de recherche.' },
  redtube: { name: 'RedTube', badge: 'RT', color: '#d6293d', types: ['video'], note: 'API officielle.' },
  eporner: { name: 'Eporner', badge: 'EP', color: '#3e8ef7', types: ['video'], note: 'API officielle, catalogue HD.' },
  rule34: { name: 'Rule34', badge: 'R34', color: '#46a758', types: ['video', 'gif', 'image'], note: 'Clé API gratuite requise (voir plus bas).' },
  redgifs: { name: 'RedGIFs', badge: 'RG', color: '#e93d82', types: ['gif', 'image'], note: 'Jeton gratuit automatique.' },
  reddit: { name: 'Reddit', badge: 'RD', color: '#ff5f1f', types: ['video', 'gif', 'image'], note: 'Interrogé directement depuis ton téléphone.' }
};

export const SOURCE_ORDER = Object.keys(SOURCES);

export const DEFAULT_FILTERS = { media: 'all', dur: 'any', hd: 'any', sort: 'relevance', sources: SOURCE_ORDER.slice() };

export const MEDIA_OPTIONS = [['all', 'Tout'], ['video', 'Vidéos'], ['gif', 'GIFs'], ['image', 'Images']];
export const DUR_OPTIONS = [['any', 'Toutes durées'], ['short', 'Moins de 10 min'], ['medium', '10 à 30 min'], ['long', 'Plus de 30 min']];
export const HD_OPTIONS = [['any', 'Toute qualité'], ['hd', 'HD (720p+)'], ['uhd', '4K']];
export const SORT_OPTIONS = [['relevance', 'Pertinence'], ['views', 'Plus vues'], ['newest', 'Plus récentes'], ['rating', 'Mieux notées']];
export const LOCK_DELAYS = [[0, 'Immédiatement'], [60, 'Après 1 minute'], [300, 'Après 5 minutes'], [900, 'Après 15 minutes']];

export const POPULAR = [
  'amateur', 'anal', 'asian', 'big ass', 'big tits', 'blonde', 'blowjob', 'brunette', 'compilation', 'cosplay',
  'couple', 'creampie', 'cumshot', 'ebony', 'hentai', 'homemade', 'latina', 'lesbian', 'massage', 'milf',
  'missionary', 'orgasm', 'pov', 'public', 'redhead', 'solo', 'squirt', 'threesome', 'toys', 'webcam'
];

export const INSTALL_ICONS = {
  app: { name: 'SearchX', manifest: 'manifest.webmanifest', icon: 'icons/app-180.png' },
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
  r34key: '',
  r34user: '',
  accessKey: ''
};
