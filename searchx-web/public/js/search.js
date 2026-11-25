// Search engine: asks every enabled source of the current mode at once, and shows ONE site at a
// time (tabs), in that site's own order — results are never mixed. Changing sort, duration or
// quality re-ranks what is already loaded (no reload); changing the media type searches again.

import { state, notify, emptySearch, toast, persist } from './state.js';
import { SOURCES, SOURCE_ORDER, modeOf, modeSources } from './config.js';
import { searchSource, REFUSED_MESSAGE } from './api.js';
import { isQueryAllowed } from './shared/safety.js';
import { save } from './lib/storage.js';
import { fitsMode, translateQuery, keywords, matchesKeywords, KEYWORD_FILTERED, isHentaiQuery, forMode } from './modes.js';

const SOURCE_TIMEOUT_MS = 35000;
let generation = 0;
const controllers = new Set();

/** Enabled sources of the current mode (in tab order) that can return the chosen media type. */
export function activeSources(f = state.filters) {
  return modeSources(modeOf(state.settings))
    .filter(s => f.sources.includes(s) && (f.media === 'all' || SOURCES[s].types.includes(f.media)));
}

function abortAll() {
  for (const c of controllers) c.abort('cancel');
  controllers.clear();
}

const mode = () => modeOf(state.settings);

/** Recent searches of the current mode (each mode keeps its own). */
export function recentList() {
  return state.recents?.[mode()] || [];
}

function rememberRecent(q) {
  const list = recentList().filter(r => r.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  state.recents = { ...state.recents, [mode()]: list.slice(0, 30) };
  persist('recents');
}

/** all: both modes (Réglages); otherwise only the current mode's list. */
export function clearRecent({ all = false } = {}) {
  state.recents = all ? { porn: [], hentai: [] } : { ...state.recents, [mode()]: [] };
  persist('recents');
  notify();
}

function allowed(q) {
  return isQueryAllowed(q, { drawn: state.settings.mode === 'hentai' });
}

/** @param opts.tab open this site's tab (e.g. "x" for an @account) */
export function runSearch(raw, { tab = null } = {}) {
  const q = String(raw || '').trim();
  if (!q) return;
  if (!allowed(q)) { start(q); return; } // shows the refusal, not remembered
  if (!activeSources().length) {
    toast('Aucune source activée pour ce type de média.');
    return;
  }
  // Porn mode never shows hentai: "hentai", "anime"… are offered in hentai mode instead.
  if (mode() === 'porn' && isHentaiQuery(q)) {
    abortAll();
    generation++;
    state.search = { ...emptySearch(), query: q, redirect: 'hentai' };
    notify();
    return;
  }
  rememberRecent(q);
  // "@name" is an X account: open the X tab directly.
  const wanted = tab || (/^@\w{1,15}$/.test(q) && activeSources().includes('x') ? 'x' : null);
  start(q, { tab: wanted });
}

/** Home: back to the welcome page (searches in progress stopped, results forgotten), at the top. */
export function goHome() {
  abortAll();
  generation++;
  state.search = emptySearch();
  state.tab = 'search';
  notify();
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function start(q, { fresh = false, tab = null, keepTab = false } = {}) {
  abortAll();
  const g = ++generation;
  const previousTab = state.search.tab;
  if (!allowed(q)) {
    // Kept in the field so the user sees what was refused; nothing is sent anywhere.
    state.search = { ...emptySearch(), query: q, notice: REFUSED_MESSAGE };
    notify();
    return;
  }
  const S = emptySearch();
  S.query = q;
  S.mode = mode();
  // Sites tag in English: common French words are searched in English.
  S.sent = forMode(translateQuery(q), S.mode);
  S.words = /^@\w+$/.test(q) ? [] : keywords(S.sent);
  S.loading = true;
  const sources = activeSources();
  for (const src of sources) S.per[src] = newPer();
  if (tab && sources.includes(tab)) { S.tab = tab; S.tabChosen = true; }
  else if (keepTab && sources.includes(previousTab)) { S.tab = previousTab; S.tabChosen = true; }
  else S.tab = sources[0] || null;
  state.search = S;
  notify();
  window.scrollTo({ top: 0 });
  Promise.all(sources.map(src => fetchOne(g, src, 1, fresh))).then(() => {
    if (g !== generation) return;
    S.loading = false;
    notify();
  });
}

function newPer() {
  return { state: 'loading', items: [], page: 0, more: true, cursor: null, error: null, debug: '', phone: '', tags: null, via: null, profile: null };
}

async function fetchOne(g, src, page, fresh = false) {
  const S = state.search;
  const per = S.per[src];
  if (!per) return;
  const ctrl = new AbortController();
  controllers.add(ctrl);
  const timer = setTimeout(() => ctrl.abort('timeout'), SOURCE_TIMEOUT_MS);
  per.state = 'loading';
  notify();
  try {
    const f = state.filters;
    const res = await searchSource(src, {
      q: S.sent || S.query, page, sort: f.sort, media: f.media, dur: f.dur, hd: f.hd,
      cursor: page > 1 ? per.cursor : '', fresh
    }, ctrl.signal);
    if (g !== generation || state.search !== S) return;
    const known = new Set(per.items.map(i => i.id));
    const fresh_ = (res.items || []).filter(i => i && i.id && !known.has(i.id));
    // Never mix the modes, and keep only what really matches the words where a site's search is loose.
    const strictWords = KEYWORD_FILTERED.has(src) ? S.words : [];
    const added = fresh_.filter(it => fitsMode(it, S.mode) && matchesKeywords(it, strictWords));
    for (const it of added) it.mode = S.mode;
    per.hidden = (per.hidden || 0) + (fresh_.length - added.length);
    per.items = per.items.concat(added);
    per.page = page;
    per.more = Boolean(res.more) && fresh_.length > 0;
    per.cursor = res.cursor || null;
    per.tags = res.tags || per.tags;
    per.profile = res.profile || per.profile;
    per.via = res.via || per.via;
    per.embed = Boolean(res.embed);
    per.relayError = res.relayError || '';
    per.state = 'done';
    per.error = null;
  } catch (e) {
    if (g !== generation || state.search !== S) return;
    const timedOut = ctrl.signal.aborted && ctrl.signal.reason === 'timeout';
    if (ctrl.signal.aborted && !timedOut) return; // cancelled by a newer search
    const msg = timedOut ? `${SOURCES[src].name} n'a pas répondu en 35 secondes.` : (e?.message || 'Erreur inconnue.');
    per.more = false;
    if (page === 1) { per.state = 'error'; per.error = msg; per.debug = e?.debug || ''; per.phone = e?.phone || ''; per.hint = e?.relayHint ? 'relay' : ''; }
    else per.state = 'done';
  } finally {
    clearTimeout(timer);
    controllers.delete(ctrl);
  }
  autoTab();
  recompute();
  notify();
  // Few results left after the checks: fetch the next page right away (twice at most).
  if (per.state === 'done' && per.more && per.items.length < 40 && page < 3 && g === generation && state.search === S) {
    fetchOne(g, src, page + 1);
  }
}

/**
 * Until the user picks a tab, show the first site (in tab order) that has results, without
 * jumping away from one that is still loading before it.
 */
function autoTab() {
  const S = state.search;
  if (S.tabChosen) return;
  const per = S.per[S.tab];
  if (per && (per.state === 'loading' || per.items.length || per.embed)) return;
  for (const src of activeSources()) {
    const p = S.per[src];
    if (!p) continue;
    if (p.state === 'loading') return; // wait: an earlier tab may still answer
    if (p.items.length || p.embed) { S.tab = src; return; }
  }
}

export function setTab(src) {
  const S = state.search;
  if (!S.per[src]) return;
  S.tab = src;
  S.tabChosen = true;
  S.selectedCreators = [];
  recompute();
  notify();
  window.scrollTo({ top: 0 });
}

export function canLoadMore() {
  const S = state.search;
  const per = S.per[S.tab];
  if (!S.query || S.loadingMore || !per) return false;
  return per.state === 'done' && per.more;
}

/**
 * Next page of the site shown. Infinite scroll (auto) stops by itself when the last two pages brought
 * almost nothing on screen — strict filters such as "Vidéos" on an image site would otherwise fetch
 * page after page without end. The "Charger plus" button still works, and a good page resumes it.
 */
export function loadMore({ auto = false } = {}) {
  if (!canLoadMore()) return;
  const S = state.search;
  const src = S.tab;
  const per = S.per[src];
  if (auto && per.autoStop) return;
  const g = generation;
  const before = S.results.length;
  S.loadingMore = true;
  notify();
  fetchOne(g, src, (per.page || 1) + 1).then(() => {
    if (g !== generation) return;
    S.loadingMore = false;
    const gained = S.tab === src ? S.results.length - before : 0;
    per.lean = gained < 6 ? (per.lean || 0) + 1 : 0;
    per.autoStop = per.lean >= 2;
    notify();
  });
}

/** Runs the current search again (e.g. after switching mode). */
export function rerunSearch() {
  if (state.search.query) runSearch(state.search.query);
}

export async function refresh() {
  const S = state.search;
  if (!S.query) return;
  const creators = S.selectedCreators;
  start(S.query, { fresh: true, keepTab: true });
  state.search.selectedCreators = creators;
  await new Promise(resolve => {
    const check = () => (!state.search.loading ? resolve() : setTimeout(check, 200));
    check();
  });
}

export function retrySource(src) {
  const S = state.search;
  if (!S.query || !S.per[src]) return;
  S.per[src] = newPer();
  notify();
  fetchOne(generation, src, 1, true);
}

export function setFilters(patch) {
  const old = state.filters;
  const next = { ...old, ...patch };
  state.filters = next;
  save('filters', next);
  const S = state.search;
  if (!S.query || S.notice) { notify(); return; }

  // A different media type changes what every source must be asked → new search.
  if (old.media !== next.media) { start(S.query, { keepTab: true }); return; }
  for (const p of Object.values(S.per)) { p.lean = 0; p.autoStop = false; }

  const after = activeSources(next);
  for (const src of after) {
    if (!S.per[src]) {
      S.per[src] = newPer();
      fetchOne(generation, src, 1);
    }
  }
  if (!after.includes(S.tab)) { S.tab = after[0] || null; S.tabChosen = false; }
  recompute();
  notify();
}

/** Turns off the given sources (e.g. the ones that failed the test). */
export function disableSources(list) {
  const off = new Set(list);
  setFilters({ sources: state.filters.sources.filter(s => !off.has(s)) });
  state.defaultFilters.sources = state.defaultFilters.sources.filter(s => !off.has(s));
  save('defaultFilters', state.defaultFilters);
}

/** Turns a source on or off, now and by default. */
export function enableSource(src, on) {
  const sources = on ? [...new Set([...state.filters.sources, src])] : state.filters.sources.filter(s => s !== src);
  setFilters({ sources: SOURCE_ORDER.filter(s => sources.includes(s)) });
  const d = state.defaultFilters;
  d.sources = on ? [...new Set([...d.sources, src])] : d.sources.filter(s => s !== src);
  save('defaultFilters', d);
}

export function activeFilterCount(f = state.filters) {
  const d = state.defaultFilters;
  let n = 0;
  if (f.dur !== 'any') n++;
  if (f.hd !== 'any') n++;
  if (f.sort !== d.sort) n++;
  return n;
}

export function resetFilters() {
  setFilters({ ...state.defaultFilters, sources: state.defaultFilters.sources.slice() });
}

// ---- creators -----------------------------------------------------------------------------------

export function creatorKey(name) {
  return String(name || '').toLowerCase().replace(/^[@\s]+|\s+$/g, '');
}

export function toggleCreator(key) {
  const S = state.search;
  S.selectedCreators = S.selectedCreators.includes(key) ? S.selectedCreators.filter(k => k !== key) : [...S.selectedCreators, key];
  recompute();
  notify();
}

export function showOnlyCreator(name) {
  state.search.selectedCreators = [creatorKey(name)];
  recompute();
  notify();
}

export function clearCreators() {
  state.search.selectedCreators = [];
  recompute();
  notify();
}

// ---- ranking (within one site) ------------------------------------------------------------------

function matchesLocal(it, f) {
  if (f.media !== 'all' && it.type !== f.media) return false;
  if (f.dur !== 'any' && (f.media === 'all' || f.media === 'video')) {
    if (it.type !== 'video' || it.dur == null) return false;
    const d = it.dur;
    if (f.dur === 'short' && !(d < 600)) return false;
    if (f.dur === 'medium' && !(d >= 600 && d <= 1800)) return false;
    if (f.dur === 'long' && !(d > 1800)) return false;
  }
  if (f.hd === 'hd' && !((it.h || 0) >= 720)) return false;
  if (f.hd === 'uhd' && !((it.h || 0) >= 2160)) return false;
  return true;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'with', 'in', 'on', 'de', 'la', 'le', 'les', 'et', 'du', 'des']);
const TAGGED = new Set(['rule34', 'danbooru', 'yandere']);

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[_-]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function makeScorer(query) {
  const phrase = norm(query);
  const words = phrase.split(' ').filter(w => w.length > 1 && !STOP.has(w));
  return it => {
    if (!words.length) return 0;
    if (TAGGED.has(it.src)) {
      // Fetched by exact tag: every post matches; score evenly to keep the site's own order.
      const tags = ` ${norm((it.tags || []).join(' '))} `;
      let s = words.length > 1 && tags.includes(` ${phrase}`) ? 4 : 0;
      for (const w of words) if (tags.includes(` ${w}`)) s += 2;
      return s;
    }
    const title = ` ${norm(it.title)} `;
    const meta = ` ${norm([...(it.tags || []), ...(it.by || [])].join(' '))} `;
    let s = 0;
    if (words.length > 1 && title.includes(` ${phrase} `)) s += 4;
    else if (words.length > 1 && meta.includes(` ${phrase} `)) s += 2;
    for (const w of words) {
      if (title.includes(` ${w} `) || title.includes(` ${w}s `)) s += 2;
      else if (meta.includes(` ${w} `) || meta.includes(` ${w}s `)) s += 1;
      else if (title.includes(w)) s += 1;
    }
    return s;
  };
}

function stableSort(list, key) {
  return list.map((it, i) => [it, i, key(it)]).sort((a, b) => (b[2] - a[2]) || (a[1] - b[1])).map(x => x[0]);
}

/** Order shown. X keeps X's own order (account timeline, or the search's "Récent" tab) whatever the sort. */
export function rank(list, sort, query, src = '') {
  if (src === 'x') return list;
  if (sort === 'views') return stableSort(list, it => it.views ?? it.likes ?? -1);
  if (sort === 'newest') return stableSort(list, it => it.date ?? -1);
  if (sort === 'rating') return stableSort(list, it => it.rating ?? it.likes ?? -1);
  // Relevance: the site's own order, with what really matches the words moved up.
  // An X account (@name) keeps the account's own order.
  if (/^@\w+$/.test(query)) return list;
  return stableSort(list, makeScorer(query));
}

function computeCreators(items) {
  const map = new Map();
  for (const it of items) {
    for (const name of new Set(it.by || [])) {
      const key = creatorKey(name);
      if (!key) continue;
      const e = map.get(key) || { key, name, count: 0, sources: new Set(), thumb: it.thumb };
      e.count++;
      e.sources.add(it.src);
      map.set(key, e);
    }
  }
  return [...map.values()]
    .map(e => ({ ...e, sources: SOURCE_ORDER.filter(s => e.sources.has(s)) }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
}

export function recompute() {
  const S = state.search;
  const f = state.filters;
  const per = S.per[S.tab];
  const seen = new Set();
  const list = (per?.items || []).filter(it => {
    if (!matchesLocal(it, f) || seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
  S.creators = computeCreators(list);
  const selected = new Set(S.selectedCreators);
  const filtered = selected.size ? list.filter(it => (it.by || []).some(n => selected.has(creatorKey(n)))) : list;
  S.results = rank(filtered, f.sort, S.query, S.tab);
}

export function isAnySourceLoading() {
  const per = state.search.per;
  return activeSources().some(s => per[s]?.state === 'loading');
}

// ---- X accounts ---------------------------------------------------------------------------------

export function isFollowing(user) {
  const u = String(user || '').replace(/^@/, '').toLowerCase();
  return state.xFollows.some(f => f.user.toLowerCase() === u);
}

export function toggleFollow({ user, name = '', avatar = '' }) {
  const u = String(user || '').replace(/^@/, '');
  if (!/^\w{1,15}$/.test(u)) return false;
  if (isFollowing(u)) state.xFollows = state.xFollows.filter(f => f.user.toLowerCase() !== u.toLowerCase());
  else state.xFollows = [{ user: u, name: name || u, avatar: avatar || '' }, ...state.xFollows].slice(0, 60);
  persist('xFollows');
  notify();
  return isFollowing(u);
}

/** Keeps the name / avatar of followed accounts fresh when their feed is opened. */
export function updateFollow(profile) {
  if (!profile?.user) return;
  const f = state.xFollows.find(x => x.user.toLowerCase() === profile.user.toLowerCase());
  if (!f || (f.avatar === profile.avatar && f.name === profile.name)) return;
  f.name = profile.name || f.name;
  f.avatar = profile.avatar || f.avatar;
  persist('xFollows');
}
