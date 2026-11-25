// Favorites, playlists and history (stored on the phone, in this web app's storage).

import { state, notify, persist, toast } from './state.js';
import { itemMode } from './modes.js';
import { modeOf } from './config.js';

const currentMode = () => modeOf(state.settings);

const MAX_HISTORY = 1500;

/** Keeps what's needed to show and reopen an item. */
export function slim(it) {
  return {
    id: it.id, src: it.src, title: it.title, dur: it.dur ?? null, thumb: it.thumb, thumb2: it.thumb2 || null,
    url: it.url, type: it.type, media: it.media || null, full: it.full || null, embed: it.embed || null,
    h: it.h ?? null, views: it.views ?? null, likes: it.likes ?? null, rating: it.rating ?? null,
    by: (it.by || []).slice(0, 4), tags: (it.tags || []).slice(0, 12),
    mode: itemMode(it), user: it.user || undefined, tweet: it.tweet || undefined
  };
}

// The two modes never share anything: each list only shows the current mode's items.
export function favoritesOf(mode = currentMode()) {
  return state.favorites.filter(it => itemMode(it) === mode);
}

export function historyOf(mode = currentMode()) {
  return state.history.filter(e => itemMode(e.item) === mode);
}

export function playlistMode(p) {
  if (p.mode === 'porn' || p.mode === 'hentai') return p.mode;
  const n = p.items.filter(it => itemMode(it) === 'hentai').length;
  return p.items.length && n > p.items.length / 2 ? 'hentai' : 'porn';
}

export function playlistsOf(mode = currentMode()) {
  return state.playlists.filter(p => playlistMode(p) === mode);
}

// ---- favorites --------------------------------------------------------------------------------

export function isFavorite(id) {
  return state.favorites.some(f => f.id === id);
}

export function toggleFavorite(item) {
  if (isFavorite(item.id)) {
    state.favorites = state.favorites.filter(f => f.id !== item.id);
    persist('favorites');
    toast('Retiré des favoris');
    notify();
    return false;
  }
  state.favorites = [{ ...slim(item), savedAt: Date.now() }, ...state.favorites];
  persist('favorites');
  toast('Ajouté aux favoris');
  notify();
  return true;
}

// ---- playlists --------------------------------------------------------------------------------

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function createPlaylist(name) {
  const clean = String(name || '').trim().slice(0, 60) || `Playlist ${state.playlists.length + 1}`;
  const p = { id: uid(), name: clean, createdAt: Date.now(), items: [], mode: currentMode() };
  state.playlists = [...state.playlists, p];
  persist('playlists');
  notify();
  return p;
}

export function playlistById(id) {
  return state.playlists.find(p => p.id === id) || null;
}

export function addToPlaylist(id, item) {
  const p = playlistById(id);
  if (!p) return false;
  if (p.items.some(i => i.id === item.id)) {
    toast(`Déjà dans « ${p.name} »`);
    return false;
  }
  p.items = [...p.items, slim(item)];
  state.playlists = [...state.playlists];
  persist('playlists');
  toast(`Ajouté à « ${p.name} »`);
  notify();
  return true;
}

export function removeFromPlaylist(id, itemId) {
  const p = playlistById(id);
  if (!p) return;
  p.items = p.items.filter(i => i.id !== itemId);
  state.playlists = [...state.playlists];
  persist('playlists');
  notify();
}

export function moveInList(list, from, to) {
  const copy = list.slice();
  const [x] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(copy.length, to)), 0, x);
  return copy;
}

export function movePlaylistItem(id, from, to) {
  const p = playlistById(id);
  if (!p || from === to) return;
  p.items = moveInList(p.items, from, to);
  state.playlists = [...state.playlists];
  persist('playlists');
  notify();
}

export function movePlaylist(from, to) {
  if (from === to) return;
  state.playlists = moveInList(state.playlists, from, to);
  persist('playlists');
  notify();
}

export function renamePlaylist(id, name) {
  const p = playlistById(id);
  const clean = String(name || '').trim().slice(0, 60);
  if (!p || !clean) return;
  p.name = clean;
  state.playlists = [...state.playlists];
  persist('playlists');
  notify();
}

export function deletePlaylist(id) {
  state.playlists = state.playlists.filter(p => p.id !== id);
  if (state.playlistId === id) state.playlistId = null;
  persist('playlists');
  notify();
}

// ---- history ----------------------------------------------------------------------------------

/** Logs an opened item; reopening the same item within 30 min updates the existing entry. */
export function logHistory(item) {
  const now = Date.now();
  const last = state.history[0];
  if (last && last.item.id === item.id && now - last.at < 30 * 60 * 1000) {
    last.at = now;
    persist('history');
    return last.hid;
  }
  const entry = { hid: uid(), item: slim(item), at: now, watched: 0 };
  state.history = [entry, ...state.history].slice(0, MAX_HISTORY);
  persist('history');
  return entry.hid;
}

export function addWatched(hid, seconds) {
  const e = state.history.find(h => h.hid === hid);
  if (!e || !(seconds > 0)) return;
  e.watched = Math.round((e.watched || 0) + seconds);
  persist('history');
}

export function deleteHistory(hid) {
  state.history = state.history.filter(h => h.hid !== hid);
  persist('history');
  notify();
}

/** Clears the current mode's history since `ts` (the other mode's history is kept). */
export function clearHistorySince(ts, mode = currentMode()) {
  state.history = state.history.filter(h => h.at < ts || itemMode(h.item) !== mode);
  persist('history');
  notify();
}

/** mode: only that mode's history; null: everything. */
export function clearHistory(mode = null) {
  state.history = mode ? state.history.filter(h => itemMode(h.item) !== mode) : [];
  persist('history');
  notify();
}

// ---- backup -----------------------------------------------------------------------------------

export function exportData() {
  return {
    app: 'SearchX', version: 1, exportedAt: new Date().toISOString(),
    favorites: state.favorites, playlists: state.playlists, history: state.history, recents: state.recents,
    filters: state.filters, defaultFilters: state.defaultFilters,
    settings: { ...state.settings, pinHash: null, pinSalt: null, bioId: null }
  };
}

export function importData(data) {
  if (!data || data.app !== 'SearchX') throw new Error("Ce fichier n'est pas une sauvegarde SearchX.");
  const byId = (a, b) => {
    const seen = new Set(a.map(x => x.id));
    return [...a, ...(b || []).filter(x => x && x.id && !seen.has(x.id))];
  };
  state.favorites = byId(state.favorites, data.favorites);
  const pids = new Set(state.playlists.map(p => p.id));
  state.playlists = [...state.playlists, ...(data.playlists || []).filter(p => p && p.id && !pids.has(p.id))];
  const hids = new Set(state.history.map(h => h.hid));
  state.history = [...state.history, ...(data.history || []).filter(h => h && h.hid && !hids.has(h.hid))]
    .sort((a, b) => b.at - a.at).slice(0, MAX_HISTORY);
  if (data.settings) {
    for (const k of ['r34key', 'r34user', 'accessKey', 'sandbox', 'autoplayGifs', 'muteGifs', 'haptics']) {
      if (data.settings[k] != null && !state.settings[k]) state.settings[k] = data.settings[k];
    }
  }
  persist('favorites', 'playlists', 'history', 'settings');
  notify();
  return { favorites: state.favorites.length, playlists: state.playlists.length };
}
