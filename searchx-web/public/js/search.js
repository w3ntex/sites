// Search engine: fans the query out to every enabled source, streams results in as each one
// answers, then filters / de-duplicates / ranks them locally. Changing sort, duration, quality or
// the source chips only re-ranks what is already loaded (no reload).

import { state, notify, emptySearch, toast, persist } from './state.js';
import { SOURCES, SOURCE_ORDER } from './config.js';
import { searchSource } from './api.js';
import { isQueryAllowed } from './shared/safety.js';
import { save } from './lib/storage.js';

const SOURCE_TIMEOUT_MS = 35000;
let generation = 0;
const controllers = new Set();

export function activeSources(f = state.filters) {
  return SOURCE_ORDER.filter(s => f.sources.includes(s) && (f.media === 'all' || SOURCES[s].types.includes(f.media)));
}

function abortAll() {
  for (const c of controllers) c.abort('cancel');
  controllers.clear();
}

function rememberRecent(q) {
  const list = state.recent.filter(r => r.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  state.recent = list.slice(0, 30);
  persist('recent');
}

export function clearRecent() {
  state.recent = [];
  persist('recent');
  notify();
}

export function runSearch(raw) {
  const q = String(raw || '').trim();
  if (!q) return;
  if (!isQueryAllowed(q)) {
    abortAll();
    generation++;
    state.search = { ...emptySearch(), notice: "Cette recherche n'est pas autorisée : SearchX ne cherche jamais de contenu impliquant des mineurs." };
    notify();
    return;
  }
  if (!activeSources().length) {
    toast('Aucune source activée pour ce type de média.');
    return;
  }
  rememberRecent(q);
  start(q);
}

function start(q, { fresh = false } = {}) {
  abortAll();
  const g = ++generation;
  const S = emptySearch();
  S.query = q;
  S.loading = true;
  for (const src of activeSources()) S.per[src] = newPer();
  state.search = S;
  notify();
  window.scrollTo({ top: 0 });
  Promise.all(Object.keys(S.per).map(src => fetchOne(g, src, 1, fresh))).then(() => {
    if (g !== generation) return;
    S.loading = false;
    notify();
  });
}

function newPer() {
  return { state: 'loading', items: [], page: 0, more: true, cursor: null, error: null, debug: '', phone: '', tags: null, via: null };
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
      q: S.query, page, sort: f.sort, media: f.media, dur: f.dur, hd: f.hd,
      cursor: page > 1 ? per.cursor : '', fresh
    }, ctrl.signal);
    if (g !== generation || state.search !== S) return;
    const known = new Set(per.items.map(i => i.id));
    const fresh_ = (res.items || []).filter(i => i && i.id && !known.has(i.id));
    per.items = per.items.concat(fresh_);
    per.page = page;
    per.more = Boolean(res.more) && fresh_.length > 0;
    per.cursor = res.cursor || null;
    per.tags = res.tags || per.tags;
    per.via = res.via || per.via;
    per.state = 'done';
    per.error = null;
  } catch (e) {
    if (g !== generation || state.search !== S) return;
    const timedOut = ctrl.signal.aborted && ctrl.signal.reason === 'timeout';
    if (ctrl.signal.aborted && !timedOut) return; // cancelled by a newer search
    const msg = timedOut ? `${SOURCES[src].name} n'a pas répondu en 35 secondes.` : (e?.message || 'Erreur inconnue.');
    per.more = false;
    if (page === 1) { per.state = 'error'; per.error = msg; per.debug = e?.debug || ''; per.phone = e?.phone || ''; }
    else per.state = 'done';
  } finally {
    clearTimeout(timer);
    controllers.delete(ctrl);
  }
  recompute();
  notify();
}

export function canLoadMore() {
  const S = state.search;
  if (!S.query || S.loading || S.loadingMore) return false;
  return activeSources().some(s => S.per[s]?.state === 'done' && S.per[s].more);
}

export function loadMore() {
  if (!canLoadMore()) return;
  const S = state.search;
  const g = generation;
  const srcs = activeSources().filter(s => S.per[s]?.state === 'done' && S.per[s].more);
  S.loadingMore = true;
  notify();
  Promise.all(srcs.map(s => fetchOne(g, s, (S.per[s].page || 1) + 1))).then(() => {
    if (g !== generation) return;
    S.loadingMore = false;
    notify();
  });
}

export async function refresh() {
  const S = state.search;
  if (!S.query) return;
  const keep = { visible: S.visibleSources, creators: S.selectedCreators };
  start(S.query, { fresh: true });
  state.search.visibleSources = keep.visible;
  state.search.selectedCreators = keep.creators;
  await new Promise(resolve => {
    const check = () => (!state.search.loading ? resolve() : setTimeout(check, 200));
    check();
  });
}

export function retrySource(src) {
  const S = state.search;
  if (!S.query || !S.per[src]) return;
  S.per[src] = newPer();
  fetchOne(generation, src, 1, true);
}

export function setFilters(patch) {
  const old = state.filters;
  const next = { ...old, ...patch };
  state.filters = next;
  save('filters', next);
  const S = state.search;
  if (!S.query) { notify(); return; }

  // A different media type changes what every source must be asked → new search.
  if (old.media !== next.media) { start(S.query); return; }

  const before = new Set(activeSources(old));
  const after = activeSources(next);
  S.visibleSources = S.visibleSources.filter(s => after.includes(s));
  for (const src of after) {
    if (!before.has(src)) {
      S.per[src] = newPer();
      fetchOne(generation, src, 1);
    }
  }
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

export function activeFilterCount(f = state.filters) {
  const d = state.defaultFilters;
  let n = 0;
  if (f.dur !== 'any') n++;
  if (f.hd !== 'any') n++;
  if (f.sort !== d.sort) n++;
  if (f.sources.length !== SOURCE_ORDER.length) n++;
  return n;
}

export function resetFilters() {
  setFilters({ ...state.defaultFilters, sources: state.defaultFilters.sources.slice() });
}

// ---- chips & creators -------------------------------------------------------------------------

export function toggleVisibleSource(src) {
  const S = state.search;
  S.visibleSources = S.visibleSources.includes(src) ? S.visibleSources.filter(s => s !== src) : [...S.visibleSources, src];
  recompute();
  notify();
}

export function showAllSources() {
  state.search.visibleSources = [];
  recompute();
  notify();
}

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

// ---- ranking ------------------------------------------------------------------------------------

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

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[_-]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function makeScorer(query) {
  const phrase = norm(query);
  const words = phrase.split(' ').filter(w => w.length > 1 && !STOP.has(w));
  return it => {
    if (!words.length) return 0;
    if (it.src === 'rule34') {
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

function rank(lists, sort, query) {
  if (sort === 'views') return stableSort(lists.flat(), it => it.views ?? it.likes ?? -1);
  if (sort === 'newest') return stableSort(lists.flat(), it => it.date ?? -1);
  if (sort === 'rating') return stableSort(lists.flat(), it => it.rating ?? -1);
  // Relevance: round-robin keeps each site's own ranking while mixing sources, then items that
  // really match the query (title, tags, creators) move up.
  const merged = [];
  for (let i = 0; lists.some(l => i < l.length); i++) {
    for (const l of lists) if (i < l.length) merged.push(l[i]);
  }
  const score = makeScorer(query);
  return stableSort(merged, score);
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
  const active = activeSources(f);
  const visible = S.visibleSources.filter(s => active.includes(s));
  const seen = new Set();
  const lists = active.map(src => {
    if (visible.length && !visible.includes(src)) return [];
    return (S.per[src]?.items || []).filter(it => {
      if (!matchesLocal(it, f) || seen.has(it.url)) return false;
      seen.add(it.url);
      return true;
    });
  });
  S.creators = computeCreators(lists.flat());
  const selected = new Set(S.selectedCreators);
  const filtered = selected.size ? lists.map(l => l.filter(it => (it.by || []).some(n => selected.has(creatorKey(n))))) : lists;
  S.results = rank(filtered, f.sort, S.query);
}

export function isAnySourceLoading() {
  const per = state.search.per;
  return activeSources().some(s => per[s]?.state === 'loading');
}
