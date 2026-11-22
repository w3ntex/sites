import { html, useState, useEffect, useRef, useCallback } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Spinner, cx, EmptyState } from './common.js';
import { Grid, SkeletonGrid, Strip } from './grid.js';
import { state, openSheet, lockEnabled, lockNow, updateSettings, switchTab } from '../state.js';
import { SOURCES, POPULAR, MEDIA_OPTIONS, SORT_OPTIONS, SOURCE_ORDER, LAYOUTS } from '../config.js';
import {
  runSearch, loadMore, canLoadMore, refresh, activeSources, setFilters, resetFilters, activeFilterCount,
  toggleVisibleSource, showAllSources, clearCreators, clearRecent, isAnySourceLoading
} from '../search.js';
import { suggestTags } from '../api.js';
import { haptic } from '../lib/haptics.js';
import { compact } from '../lib/format.js';
import { openViewer } from './viewer.js';

const label = (opts, v) => (opts.find(o => o[0] === v) || [, ''])[1];
const LAYOUT_ICON = { grid2: 'layers', grid3: 'grip', list: 'list' };

function SearchField({ focused, setFocused }) {
  const [text, setText] = useState(state.search.query);
  const [tags, setTags] = useState([]);
  const input = useRef(null);

  useEffect(() => { setText(state.search.query); }, [state.search.query]);

  // Rule34 tag suggestions, debounced (like the site's search box).
  useEffect(() => {
    const q = text.trim();
    if (!focused || q.length < 2 || !state.filters.sources.includes('rule34')) { setTags([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const list = await suggestTags(q.split(/[\s,]+/).pop() || q, ctrl.signal);
      if (!ctrl.signal.aborted) setTags(list.slice(0, 6));
    }, 280);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [text, focused]);

  const submit = value => {
    const v = (value ?? text).trim();
    if (!v) return;
    setText(v);
    input.current?.blur();
    setFocused(false);
    haptic();
    runSearch(v);
  };

  const q = text.trim().toLowerCase();
  const recent = state.recent.filter(r => !q || r.toLowerCase().includes(q)).slice(0, q ? 4 : 8);
  const popular = q ? POPULAR.filter(p => p.startsWith(q) && !recent.some(r => r.toLowerCase() === p)).slice(0, 4) : [];
  const showPanel = focused && (recent.length || popular.length || tags.length);

  return html`<div class="search-wrap">
    <form class=${cx('search-field', focused && 'focused')} onSubmit=${e => { e.preventDefault(); submit(); }} role="search">
      <${Icon} name="search" size=${18} />
      <input ref=${input} type="search" value=${text} placeholder="Rechercher partout"
        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search"
        onInput=${e => setText(e.currentTarget.value)}
        onFocus=${() => setFocused(true)}
        onBlur=${() => setTimeout(() => setFocused(false), 160)} />
      ${text && html`<button type="button" class="clear" aria-label="Effacer" onPointerDown=${e => e.preventDefault()}
        onClick=${() => { setText(''); input.current?.focus(); }}><${Icon} name="x" size=${14} stroke=${3} /></button>`}
    </form>
    ${focused && html`<button type="button" class="cancel-btn" onPointerDown=${e => e.preventDefault()}
      onClick=${() => { setText(state.search.query); input.current?.blur(); setFocused(false); }}>Annuler</button>`}
    ${showPanel ? html`<div class="suggest" onPointerDown=${e => e.preventDefault()}>
      ${recent.map(r => html`<button type="button" class="sug" key=${`r-${r}`} onClick=${() => submit(r)}>
        <${Icon} name="clock" size=${16} /><span>${r}</span></button>`)}
      ${popular.map(p => html`<button type="button" class="sug" key=${`p-${p}`} onClick=${() => submit(p)}>
        <${Icon} name="search" size=${16} /><span>${p}</span></button>`)}
      ${tags.length ? html`<div class="sug-head">Tags Rule34</div>` : null}
      ${tags.map(t => html`<button type="button" class="sug" key=${`t-${t.tag}`} onClick=${() => submit(t.tag.replace(/_/g, ' '))}>
        <${Icon} name="tag" size=${16} /><span>${t.tag.replace(/_/g, ' ')}</span><em>${t.count ? compact(t.count) : ''}</em></button>`)}
    </div>` : null}
  </div>`;
}

function TypePills() {
  const f = state.filters;
  const S = state.search;
  return html`<div class="type-row">
    <div class="type-pills" role="tablist">
      ${MEDIA_OPTIONS.map(([v, l]) => html`<button type="button" key=${v} role="tab" aria-selected=${f.media === v ? 'true' : 'false'}
        class=${cx('type-pill', f.media === v && 'on')} onClick=${() => { if (f.media !== v) { haptic(); setFilters({ media: v }); } }}>${l}</button>`)}
    </div>
    ${S.creators.length ? html`<button type="button" class=${cx('chip small', S.selectedCreators.length && 'active')}
      onClick=${() => { haptic(); openSheet('creators'); }}>
      <${Icon} name="users" size=${13} /><span>${S.selectedCreators.length || S.creators.length}</span>
    </button>` : null}
  </div>`;
}

function SourceChips() {
  const S = state.search;
  const srcs = activeSources().filter(s => S.per[s]);
  if (!srcs.length) return null;
  return html`<div class="chips scroll-x status">
    ${S.visibleSources.length ? html`<button type="button" class="chip small" onClick=${() => { haptic(); showAllSources(); }}>
      <${Icon} name="x" size=${12} stroke=${3} /><span>Toutes</span></button>` : null}
    ${srcs.map(src => {
      const p = S.per[src];
      const on = S.visibleSources.includes(src);
      const dim = S.visibleSources.length && !on;
      return html`<button type="button" key=${src} class=${cx('chip small src', on && 'selected', dim && 'dim', p.state === 'error' && 'err')}
        style=${`--c:${SOURCES[src].color}`}
        onClick=${() => { haptic(); if (p.state === 'error') openSheet('sourceError', { src }); else toggleVisibleSource(src); }}>
        <i class="dotc"></i><span>${SOURCES[src].name}</span>
        ${p.state === 'loading' ? html`<${Spinner} size=${11} />`
          : p.state === 'error' ? html`<${Icon} name="warn" size=${13} class="warn" />`
          : html`<em>${p.items.length}</em>`}
      </button>`;
    })}
  </div>`;
}

function ResultsToolbar() {
  const S = state.search;
  const f = state.filters;
  const cycleLayout = () => {
    const i = LAYOUTS.findIndex(l => l[0] === state.settings.layout);
    haptic();
    updateSettings({ layout: LAYOUTS[(i + 1) % LAYOUTS.length][0] });
  };
  const tags = activeSources().map(s => S.per[s]?.tags).find(Boolean);
  const showTags = tags && tags.length && tags.join(' ') !== S.query.toLowerCase().replace(/\s+/g, '_');
  return html`<div class="results-bar">
    <span class="rb-count">${S.results.length ? `${S.results.length} résultat${S.results.length > 1 ? 's' : ''}` : ''}
      ${showTags ? html`<small>Rule34 : ${tags.join(', ')}</small>` : null}</span>
    <button type="button" class="rb-btn" onClick=${() => { haptic(); openSheet('options', { title: 'Trier par', key: 'sort', options: SORT_OPTIONS, value: f.sort, onPick: v => setFilters({ sort: v }) }); }}>
      <${Icon} name="sort" size=${14} />${label(SORT_OPTIONS, f.sort)}
    </button>
    <button type="button" class="rb-btn icon" aria-label="Changer l'affichage" onClick=${cycleLayout}>
      <${Icon} name=${LAYOUT_ICON[state.settings.layout] || 'layers'} size=${16} />
    </button>
  </div>`;
}

function usePullToRefresh(onRefresh, enabled) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let startY = null;
    let current = 0;
    const down = e => { startY = window.scrollY <= 0 && !state.viewer && !state.sheet ? e.touches[0].clientY : null; current = 0; };
    const move = e => {
      if (startY == null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) { if (current) { current = 0; setPull(0); } return; }
      current = Math.min(110, dy * 0.5);
      setPull(current);
    };
    const up = async () => {
      if (startY == null) return;
      startY = null;
      if (current > 70) {
        haptic();
        setBusy(true);
        setPull(56);
        try { await onRefresh(); } finally { setBusy(false); setPull(0); }
      } else setPull(0);
      current = 0;
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [enabled]);
  return { pull, busy };
}

/** Hides the header while scrolling down through results, shows it again when scrolling up. */
function useAutoHide(enabled) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) { setHidden(false); return; }
    let last = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < 140) setHidden(false);
        else if (y > last + 8) setHidden(true);
        else if (y < last - 8) setHidden(false);
        last = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled]);
  return hidden;
}

function InstallCard() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (standalone || !ios) return null;
  return html`<div class="install-card">
    <div class="install-icon"><img src="icons/app-180.png" alt="" /></div>
    <div>
      <strong>Installe SearchX sur ton iPhone</strong>
      <p>Touche <span class="kbd"><${Icon} name="share" size=${14} /></span> puis <b>« Sur l'écran d'accueil »</b>.
        Plus besoin d'ordinateur, et ça ne s'arrête jamais.</p>
    </div>
  </div>`;
}

function Welcome() {
  const seen = new Set();
  const resume = state.history.map(h => h.item).filter(it => !seen.has(it.id) && seen.add(it.id)).slice(0, 14);
  const favs = state.favorites.slice(0, 14);
  return html`<div class="welcome">
    <${InstallCard} />
    <div class="hero">
      <h1>Une recherche,<br /><span>toutes les sources.</span></h1>
      <p>${SOURCE_ORDER.filter(s => state.filters.sources.includes(s)).map(s => SOURCES[s].name).join(' · ') || 'Aucune source activée'}</p>
    </div>
    <${Strip} title="Reprendre" items=${resume} onOpen=${it => { haptic(); openViewer(resume, it.id); }}
      action=${html`<button type="button" class="text-btn" onClick=${() => { haptic(); switchTab('history'); }}>Historique</button>`} />
    <${Strip} title="Favoris" items=${favs} onOpen=${it => { haptic(); openViewer(favs, it.id); }}
      action=${html`<button type="button" class="text-btn" onClick=${() => { haptic(); state.libSegment = 'favorites'; switchTab('library'); }}>Tout voir</button>`} />
    ${state.recent.length ? html`<section class="chip-section">
      <header><h3>Recherches récentes</h3><button type="button" class="text-btn" onClick=${() => { haptic(); clearRecent(); }}>Effacer</button></header>
      <div class="chips wrap">${state.recent.slice(0, 14).map(r => html`<button type="button" key=${r} class="chip pillish"
        onClick=${() => { haptic(); runSearch(r); }}>${r}</button>`)}</div>
    </section>` : null}
    <section class="chip-section">
      <header><h3>Populaires</h3></header>
      <div class="chips wrap">${POPULAR.map(p => html`<button type="button" key=${p} class="chip pillish"
        onClick=${() => { haptic(); runSearch(p); }}>${p}</button>`)}</div>
    </section>
  </div>`;
}

function Results() {
  const S = state.search;
  const onOpen = useCallback(item => { haptic(); openViewer(state.search.results, item.id); }, []);
  const onLong = useCallback(item => openSheet('item', { item }), []);
  const onEnd = useCallback(() => loadMore(), []);
  const loadingAny = isAnySourceLoading();

  if (S.notice) return html`<${EmptyState} icon="shield" title="Recherche refusée" text=${S.notice} />`;
  if (!S.results.length && (S.loading || loadingAny)) return html`<${SkeletonGrid} count=${8} />`;
  if (!S.results.length) {
    const act = activeSources().filter(s => S.per[s]);
    const errors = act.filter(s => S.per[s]?.state === 'error');
    const allFailed = errors.length && errors.length === act.length;
    return html`<${EmptyState} icon=${allFailed ? 'warn' : 'search'}
      title=${allFailed ? 'Les sources ne répondent pas' : 'Aucun résultat'}
      text=${allFailed ? 'Touche une source marquée ⚠️ pour voir pourquoi.'
        : (S.selectedCreators.length || S.visibleSources.length) ? 'Rien pour cette sélection. Élargis les filtres.'
        : `Rien trouvé pour « ${S.query} ». Essaie un autre mot ou d'autres filtres.`}>
      <button type="button" class="btn ghost small" onClick=${() => { resetFilters(); clearCreators(); showAllSources(); }}>Réinitialiser les filtres</button>
    <//>`;
  }
  const footer = S.loadingMore || (loadingAny && !S.loading)
    ? html`<div class="list-end"><${Spinner} /></div>`
    : canLoadMore()
      ? html`<div class="list-end"><button type="button" class="btn ghost small" onClick=${() => { haptic(); loadMore(); }}>Charger plus</button></div>`
      : html`<div class="list-end muted">Fin des résultats</div>`;
  return html`<${Grid} items=${S.results} onOpen=${onOpen} onLongPress=${onLong} footer=${footer} onEndReached=${onEnd} />`;
}

function ScrollTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 1400);
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  if (!show) return null;
  return html`<button type="button" class="fab" aria-label="Remonter" onClick=${() => { haptic(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
    <${Icon} name="chevronDown" size=${22} class="up" />
  </button>`;
}

export function SearchTab() {
  const S = state.search;
  const [focused, setFocused] = useState(false);
  const { pull, busy } = usePullToRefresh(refresh, Boolean(S.query));
  const hidden = useAutoHide(Boolean(S.query && S.results.length) && !focused);
  const nFilters = activeFilterCount();
  return html`<div class="tab tab-search">
    <header class=${cx('topbar', hidden && 'tucked')}>
      <div class="search-row">
        <${SearchField} focused=${focused} setFocused=${setFocused} />
        ${!focused && html`<button type="button" class=${cx('icon-btn tool', nFilters && 'on')} aria-label="Filtres"
          onClick=${() => { haptic(); openSheet('filters'); }}>
          <${Icon} name="sliders" size=${19} />${nFilters ? html`<i class="badge-n">${nFilters}</i>` : null}
        </button>`}
        ${!focused && lockEnabled() && html`<button type="button" class="icon-btn tool" aria-label="Verrouiller maintenant"
          onClick=${() => { haptic(); lockNow(); }}><${Icon} name="lock" size=${18} /></button>`}
      </div>
      <${TypePills} />
      ${S.query && html`<${SourceChips} />`}
    </header>
    <div class="ptr" style=${`height:${pull}px`}>
      ${(pull > 0 || busy) && html`<span class=${cx('ptr-icon', (pull > 70 || busy) && 'ready', busy && 'spin')}><${Icon} name="refresh" size=${20} /></span>`}
    </div>
    <main class="content">
      ${S.query ? html`<${ResultsToolbar} /><${Results} />` : html`<${Welcome} />`}
    </main>
    ${S.query && html`<${ScrollTop} />`}
  </div>`;
}
