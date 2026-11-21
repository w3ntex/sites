import { useState, useEffect } from '../vendor/preact-htm.mjs';
import { load, save } from './lib/storage.js';
import { DEFAULT_FILTERS, DEFAULT_SETTINGS, SOURCE_ORDER } from './config.js';

function loadFilters(key) {
  const f = { ...DEFAULT_FILTERS, ...(load(key, {}) || {}) };
  f.sources = Array.isArray(f.sources) ? f.sources.filter(s => SOURCE_ORDER.includes(s)) : DEFAULT_FILTERS.sources.slice();
  return f;
}

export function emptySearch() {
  return {
    query: '',
    per: {},            // per source: { state, items, page, more, cursor, error, tags }
    results: [],
    creators: [],
    selectedCreators: [],
    visibleSources: [],
    loading: false,
    loadingMore: false,
    notice: null
  };
}

const settings = { ...DEFAULT_SETTINGS, ...(load('settings', {}) || {}) };

/** The whole app state. Mutated in place by actions, then `notify()` re-renders. */
export const state = {
  tab: 'search',
  settings,
  filters: loadFilters('filters'),
  defaultFilters: loadFilters('defaultFilters'),
  favorites: load('favorites', []) || [],
  playlists: load('playlists', []) || [],
  history: load('history', []) || [],
  recent: load('recent', []) || [],
  search: emptySearch(),
  viewer: null,        // { items, index }
  sheet: null,         // { type, ...props }
  toast: null,         // { msg, id }
  playlistId: null,    // open playlist in the Favorites tab
  libSegment: 'favorites',
  locked: Boolean(settings.pinHash),
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
