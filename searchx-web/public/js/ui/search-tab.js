import { html, useState, useEffect, useRef, useCallback } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Spinner, cx, EmptyState } from './common.js';
import { Grid, SkeletonGrid } from './grid.js';
import { state, openSheet } from '../state.js';
import { SOURCES, POPULAR, MEDIA_OPTIONS, DUR_OPTIONS, HD_OPTIONS, SORT_OPTIONS, SOURCE_ORDER } from '../config.js';
import {
  runSearch, loadMore, canLoadMore, refresh, activeSources, setFilters, resetFilters,
  toggleVisibleSource, showAllSources, toggleCreator, clearCreators, clearRecent, isAnySourceLoading
} from '../search.js';
import { suggestTags } from '../api.js';
import { haptic } from '../lib/haptics.js';
import { compact } from '../lib/format.js';
import { openViewer } from './viewer.js';

const label = (opts, v) => (opts.find(o => o[0] === v) || [, ''])[1];

function SearchField() {
  const [text, setText] = useState(state.search.query);
  const [focused, setFocused] = useState(false);
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
      <input ref=${input} type="search" value=${text} placeholder="Rechercher sur toutes les sources"
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

function FilterBar() {
  const f = state.filters;
  const durOK = f.media === 'all' || f.media === 'video';
  const chip = (icon, text, active, onClick, disabled = false) => html`<button type="button"
    class=${cx('chip', active && 'active')} disabled=${disabled} onClick=${() => { haptic(); onClick(); }}>
    <${Icon} name=${icon} size=${14} /><span>${text}</span><${Icon} name="chevronDown" size=${12} stroke=${2.6} />
  </button>`;
  const pick = (title, options, k) => () => openSheet('options', { title, options, value: f[k], key: k, onPick: v => setFilters({ [k]: v }) });
  const isDefault = JSON.stringify({ ...f, sources: [...f.sources].sort() }) ===
    JSON.stringify({ ...state.defaultFilters, sources: [...state.defaultFilters.sources].sort() });
  return html`<div class="chips scroll-x">
    ${chip('layers', label(MEDIA_OPTIONS, f.media), f.media !== 'all', pick('Type de média', MEDIA_OPTIONS, 'media'))}
    ${chip('timer', durOK ? label(DUR_OPTIONS, f.dur) : 'Toutes durées', durOK && f.dur !== 'any', pick('Durée', DUR_OPTIONS, 'dur'), !durOK)}
    ${chip('sparkles', label(HD_OPTIONS, f.hd), f.hd !== 'any', pick('Qualité', HD_OPTIONS, 'hd'))}
    ${chip('sort', label(SORT_OPTIONS, f.sort), f.sort !== 'relevance', pick('Trier par', SORT_OPTIONS, 'sort'))}
    ${chip('sliders', `Sources ${f.sources.length}/${SOURCE_ORDER.length}`, f.sources.length !== SOURCE_ORDER.length, () => openSheet('sources'))}
    ${!isDefault && html`<button type="button" class="chip round" aria-label="Réinitialiser les filtres"
      onClick=${() => { haptic(); resetFilters(); }}><${Icon} name="refresh" size=${15} /></button>`}
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
      return html`<button type="button" key=${src} class=${cx('chip small src', on && 'selected', dim && 'dim')}
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

function CreatorChips() {
  const S = state.search;
  if (!S.creators.length) return null;
  const selected = S.selectedCreators;
  const byKey = new Map(S.creators.map(c => [c.key, c]));
  return html`<div class="chips scroll-x creators">
    <button type="button" class=${cx('chip small', selected.length && 'active')} onClick=${() => { haptic(); openSheet('creators'); }}>
      <${Icon} name="users" size=${13} /><span>${selected.length ? `Créateurs · ${selected.length}` : `Créateurs (${S.creators.length})`}</span>
      <${Icon} name="chevronDown" size=${11} stroke=${2.6} />
    </button>
    ${selected.length
      ? html`${selected.map(k => html`<button type="button" key=${k} class="chip small filled" onClick=${() => { haptic(); toggleCreator(k); }}>
          <span>${byKey.get(k)?.name || k}</span><${Icon} name="x" size=${11} stroke=${3} /></button>`)}
        <button type="button" class="chip small ghost" onClick=${() => { haptic(); clearCreators(); }}>Effacer</button>`
      : S.creators.slice(0, 10).map(c => html`<button type="button" key=${c.key} class="chip small ghost"
          onClick=${() => { haptic(); toggleCreator(c.key); }}><span>${c.name}</span><em>${c.count}</em></button>`)}
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
  return html`<div class="welcome">
    <${InstallCard} />
    <div class="hero">
      <h1>Une recherche,<br /><span>toutes les sources.</span></h1>
      <p>${SOURCE_ORDER.map(s => SOURCES[s].name).join(' · ')}</p>
    </div>
    ${state.recent.length ? html`<section class="chip-section">
      <header><h3>Récentes</h3><button type="button" class="text-btn" onClick=${() => { haptic(); clearRecent(); }}>Effacer</button></header>
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

  if (S.notice) {
    return html`<${EmptyState} icon="shield" title="Recherche refusée" text=${S.notice} />`;
  }
  if (!S.results.length && (S.loading || loadingAny)) return html`<${SkeletonGrid} count=${8} />`;
  if (!S.results.length) {
    const errors = activeSources().filter(s => S.per[s]?.state === 'error');
    const allFailed = errors.length && errors.length === activeSources().filter(s => S.per[s]).length;
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
      : html`<div class="list-end muted">${S.results.length} résultat${S.results.length > 1 ? 's' : ''} · fin</div>`;
  return html`<${Grid} items=${S.results} onOpen=${onOpen} onLongPress=${onLong} footer=${footer} onEndReached=${onEnd} />`;
}

export function SearchTab() {
  const S = state.search;
  const { pull, busy } = usePullToRefresh(refresh, Boolean(S.query));
  const tags = activeSources().map(s => S.per[s]?.tags).find(Boolean);
  return html`<div class="tab tab-search">
    <header class="topbar">
      <${SearchField} />
      <${FilterBar} />
      ${S.query && html`<${SourceChips} />`}
      ${S.query && html`<${CreatorChips} />`}
    </header>
    <div class="ptr" style=${`height:${pull}px`}>
      ${(pull > 0 || busy) && html`<span class=${cx('ptr-icon', (pull > 70 || busy) && 'ready', busy && 'spin')}><${Icon} name="refresh" size=${20} /></span>`}
    </div>
    <main class="content">
      ${S.query ? html`
        ${tags && tags.length && tags.join(' ') !== S.query.toLowerCase().replace(/\s+/g, '_') ? html`<p class="resolved">Rule34 : tag${tags.length > 1 ? 's' : ''} <b>${tags.join(', ')}</b></p>` : null}
        <${Results} />` : html`<${Welcome} />`}
    </main>
  </div>`;
}
