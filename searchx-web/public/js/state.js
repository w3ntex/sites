import { useState, useEffect } from '../vendor/preact-htm.mjs';
import { load, save } from './lib/storage.js';
import { DEFAULT_FILTERS, DEFAULT_SETTINGS, SOURCE_ORDER } from './config.js';
import { splitRecents } from './modes.js';

function loadFilters(key) {
  const saved = load(key, {}) || {};
  const f = { ...DEFAULT_FILTERS, ...saved };
  // v2.5: new sources per mode; older saved lists are replaced by the new defaults.
  if (saved.v !== DEFAULT_FILTERS.v || !Array.isArray(f.sources)) f.sources = DEFAULT_FILTERS.sources.slice();
  f.sources = f.sources.filter(s => SOURCE_ORDER.includes(s));
  f.v = DEFAULT_FILTERS.v;
  return f;
}

export function emptySearch() {
  return {
    query: '',
    per: {},            // per source: { state, items, page, more, cursor, error, tags, profile }
    mode: 'porn',       // the mode the search was made in
    sent: '',           // the words sent to the sites (French words translated)
    words: [],          // keywords every result of a loose site must contain
    redirect: null,     // 'hentai': this search belongs to hentai mode
    tab: null,          // the site shown (results are never mixed)
    tabChosen: false,   // the user picked the tab (no automatic switching any more)
    results: [],
    creators: [],
    selectedCreators: [],
    loading: false,
    loadingMore: false,
    xKind: 'all',       // X account: 'all' | 'video' | 'photo' (like X's media tab menu)
    notice: null
  };
}

const savedSettings = load('settings', {}) || {};
const settings = { ...DEFAULT_SETTINGS, ...savedSettings };
// v2.4 → v2.5: "Mode hentai" switch + theme became a single mode (porn / hentai).
if (!savedSettings.mode && (savedSettings.hentai === true || (savedSettings.hentai === undefined && savedSettings.theme === 'hentai'))) settings.mode = 'hentai';
delete settings.hentai;
delete settings.theme;
// 2.7.7: the music keeps playing during videos by default (asked for); applied once to older settings.
if (savedSettings.mixV !== 2) {
  settings.musicMix = true;
  settings.mixV = 2;
  save('settings', settings);
}

/** The whole app state. Mutated in place by actions, then `notify()` re-renders. */
export const state = {
  tab: 'search',
  settings,
  filters: loadFilters('filters'),
  defaultFilters: loadFilters('defaultFilters'),
  favorites: load('favorites', []) || [],
  playlists: load('playlists', []) || [],
  history: load('history', []) || [],
  recents: load('recents', null) || splitRecents(load('recent', [])), // recent searches, one list per mode
  xFollows: load('xFollows', []) || [], // X accounts: [{ user, name, avatar }]
  search: emptySearch(),
  viewer: null,        // { items, index }
  sheet: null,         // { type, ...props }
  toast: null,         // { msg, id }
  playlistId: null,    // open playlist in the Favorites tab
  libSegment: 'favorites',
  locked: Boolean(settings.pinHash || settings.bioId),
  hidden: false,
  update: false
};

const listeners = new Set();
let scheduled = false;

export function notify() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const l of listeners) l();
  });
}

export function setState(patch) {
  Object.assign(state, patch);
  notify();
}

/** Re-renders the calling component whenever the state changes. */
export function useAppState() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(x => x + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return state;
}

export function persist(...keys) {
  for (const k of keys) save(k, state[k]);
}

const scrollMemory = {};
export function switchTab(id) {
  scrollMemory[state.tab] = window.scrollY;
  state.tab = id;
  notify();
  requestAnimationFrame(() => window.scrollTo(0, scrollMemory[id] || 0));
}

export function lockEnabled() {
  return Boolean(state.settings.pinHash || state.settings.bioId);
}

export function lockNow() {
  if (!lockEnabled()) return;
  state.locked = true;
  state.viewer = null;
  state.sheet = null;
  notify();
}

// Connection settings survive a reset: they are not personal data, and re-entering an API key is a pain.
const KEPT_ON_RESET = ['r34key', 'r34user', 'accessKey', 'rgRelay'];

/** Last resort when locked out: erase everything personal stored by SearchX on this phone, then restart. */
export async function resetEverything() {
  const kept = {};
  for (const k of KEPT_ON_RESET) if (state.settings[k]) kept[k] = state.settings[k];
  try {
    // The Spotify connection is kept too (it is the user's Spotify account, not SearchX data).
    for (const k of Object.keys(localStorage)) if (k.startsWith('sx.') && k !== 'sx.spotify' && k !== 'sx.spotify.clientId') localStorage.removeItem(k);
  } catch { /* ignore */ }
  if (Object.keys(kept).length) save('settings', kept);
  try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* ignore */ }
  location.reload();
}

export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  save('settings', state.settings);
  notify();
}

let toastId = 0;
export function toast(msg) {
  const id = ++toastId;
  state.toast = { msg, id };
  notify();
  setTimeout(() => {
    if (state.toast?.id === id) { state.toast = null; notify(); }
  }, 2400);
}

export function openSheet(type, props = {}) {
  state.sheet = { type, ...props };
  notify();
}

export function closeSheet() {
  state.sheet = null;
  notify();
}
