import { html, useState, useEffect, useRef, useCallback } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Spinner, cx, EmptyState, Thumb } from './common.js';
import { Grid, SkeletonGrid, Strip } from './grid.js';
import { state, notify, emptySearch, openSheet, lockEnabled, lockNow, updateSettings, switchTab } from '../state.js';
import {
  SOURCES, POPULAR, MEDIA_OPTIONS, SORT_OPTIONS, LAYOUTS, MODES, HENTAI_CATEGORIES, PORN_CATEGORIES,
  siteSearchUrl, modeOf, redgifsSitePage
} from '../config.js';
import {
  runSearch, loadMore, canLoadMore, refresh, activeSources, setFilters, resetFilters, activeFilterCount,
  clearCreators, clearRecent, setTab, retrySource, disableSources, isFollowing, toggleFollow, updateFollow, rerunSearch, recentList
} from '../search.js';
import { itemMode } from '../modes.js';
import { suggestTags, REFUSED_MESSAGE } from '../api.js';
import { haptic } from '../lib/haptics.js';
import { compact } from '../lib/format.js';
import { applyTheme } from '../lib/theme.js';
import { openViewer } from './viewer.js';
import { Petals, isNeon } from './theme.js';
import { RelaySheet } from './relay.js';
import { MORE_RESULTS_SOURCES } from '../shared/apis.js';
import { enableSource } from '../search.js';

/** Porn mode with few results: offer precise video sites as extra tabs (never mixed). */
function MoreResults() {
  const S = state.search;
  if (modeOf(state.settings) !== 'porn' || !S.query || S.loading || /^@/.test(S.query)) return null;
  const total = activeSources().reduce((n, s) => n + (S.per[s]?.embed ? 80 : (S.per[s]?.items.length || 0)), 0);
  const offer = MORE_RESULTS_SOURCES.filter(s => !state.filters.sources.includes(s));
  if (total >= 60 || !offer.length) return null;
  return html`<div class="more-results">
    <p><b>Peu de résultats ?</b> Ajoute des sites vidéo à la recherche précise, chacun dans son onglet :</p>
    <div class="chips wrap">${offer.map(s => html`<button type="button" key=${s} class="chip" style=${`--c:${SOURCES[s].color}`}
      onClick=${() => { haptic(); enableSource(s, true); }}><${Icon} name="plus" size=${13} />${SOURCES[s].name}</button>`)}</div>
  </div>`;
}

const label = (opts, v) => (opts.find(o => o[0] === v) || [, ''])[1];
const LAYOUT_ICON = { grid2: 'layers', grid3: 'grip', list: 'list' };

export function switchMode(mode) {
  if (modeOf(state.settings) === mode) return;
  haptic();
  updateSettings({ mode });
  applyTheme(mode);
  // Same words in the other mode's sites; an @X account only makes sense in porn mode.
  const q = state.search.query;
  if (q && !state.search.notice && !/^@\w+$/.test(q)) rerunSearch();
  else { state.search = emptySearch(); notify(); }
}

function SearchField({ focused, setFocused }) {
  const [text, setText] = useState(state.search.query);
  const [tags, setTags] = useState([]);
  const input = useRef(null);
  const hentai = modeOf(state.settings) === 'hentai';

  useEffect(() => { setText(state.search.query); }, [state.search.query]);

  // Rule34 tag suggestions, debounced (like the site's search box).
  useEffect(() => {
    const q = text.trim();
    if (!focused || q.length < 2 || !hentai || !activeSources().includes('rule34') || q.startsWith('@')) { setTags([]); return; }
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
  const recent = recentList().filter(r => !q || r.toLowerCase().includes(q)).slice(0, q ? 4 : 8);
  const pool = hentai ? HENTAI_CATEGORIES.map(c => c.q) : [...PORN_CATEGORIES.map(c => c.q), ...POPULAR];
  const popular = q ? [...new Set(pool)].filter(p => p.startsWith(q) && !recent.some(r => r.toLowerCase() === p)).slice(0, 4) : [];
  const follows = !hentai && q.startsWith('@')
    ? state.xFollows.filter(f => `@${f.user.toLowerCase()}`.startsWith(q)).slice(0, 5) : [];
  const showPanel = focused && (recent.length || popular.length || tags.length || follows.length);

  return html`<div class="search-wrap">
    <form class=${cx('search-field', focused && 'focused')} onSubmit=${e => { e.preventDefault(); submit(); }} role="search">
      <${Icon} name="search" size=${18} />
      <input ref=${input} type="search" value=${text} placeholder=${hentai ? 'Rechercher du hentai' : 'Rechercher, ou @compte X'}
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
      ${follows.map(f => html`<button type="button" class="sug" key=${`f-${f.user}`} onClick=${() => submit(`@${f.user}`)}>
        <${Icon} name="at" size=${16} /><span>@${f.user}</span><em>Compte suivi</em></button>`)}
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
    ${S.creators.length > 1 ? html`<button type="button" class=${cx('chip small', S.selectedCreators.length && 'active')}
      onClick=${() => { haptic(); openSheet('creators'); }}>
      <${Icon} name="users" size=${13} /><span>${S.selectedCreators.length || S.creators.length}</span>
    </button>` : null}
  </div>`;
}

/** One tab per site: results are shown one site at a time, never mixed. */
function SourceTabs() {
  const S = state.search;
  const srcs = activeSources().filter(s => S.per[s]);
  if (!srcs.length) return null;
  return html`<div class="stabs" role="tablist" aria-label="Sites">
    ${srcs.map(src => {
      const p = S.per[src];
      const on = S.tab === src;
      return html`<button type="button" key=${src} role="tab" aria-selected=${on ? 'true' : 'false'}
        class=${cx('stab', on && 'on', p.state === 'error' && 'err', p.state === 'done' && !p.items.length && 'empty')}
        style=${`--c:${SOURCES[src].color}`} onClick=${() => { haptic(); setTab(src); }}>
        <span>${SOURCES[src].name}</span>
        ${p.state === 'loading' ? html`<${Spinner} size=${11} />`
          : p.state === 'error' ? html`<${Icon} name="warn" size=${13} class="warn" />`
          : p.embed ? html`<${Icon} name="external" size=${12} />`
          : html`<em>${p.items.length}${p.more ? '+' : ''}</em>`}
      </button>`;
    })}
  </div>`;
}

function ResultsToolbar() {
  const S = state.search;
  const f = state.filters;
  const per = S.per[S.tab];
  const cycleLayout = () => {
    const i = LAYOUTS.findIndex(l => l[0] === state.settings.layout);
    haptic();
    updateSettings({ layout: LAYOUTS[(i + 1) % LAYOUTS.length][0] });
  };
  const tags = per?.tags;
  const showTags = tags && tags.length && tags.join(' ') !== (S.sent || S.query).toLowerCase().replace(/\s+/g, '_');
  const translated = S.sent && S.sent !== S.query.trim().toLowerCase() ? S.sent : null;
  if (!per || per.embed || per.state === 'error' || (!S.results.length && per.state !== 'done')) return null;
  const notes = [
    translated && `cherché en anglais : « ${translated} »`,
    showTags && `tags : ${tags.join(', ').replace(/_/g, ' ')}`,
    per.hidden > 0 && `${per.hidden} hors sujet masqué${per.hidden > 1 ? 's' : ''}`
  ].filter(Boolean);
  return html`<div class="results-bar">
    <span class="rb-count">${S.results.length ? `${S.results.length} résultat${S.results.length > 1 ? 's' : ''} · ${SOURCES[S.tab].name}` : ''}
      ${notes.length ? html`<small>${notes.join(' · ')}</small>` : null}</span>
    <button type="button" class="rb-btn" onClick=${() => { haptic(); openSheet('options', { title: 'Trier par', key: 'sort', options: SORT_OPTIONS, value: f.sort, onPick: v => setFilters({ sort: v }) }); }}>
      <${Icon} name="sort" size=${14} />${label(SORT_OPTIONS, f.sort)}
    </button>
    <button type="button" class="rb-btn icon" aria-label="Changer l'affichage" onClick=${cycleLayout}>
      <${Icon} name=${LAYOUT_ICON[state.settings.layout] || 'layers'} size=${16} />
    </button>
  </div>`;
}

/** X account header (for "@name" searches). */
function XProfile({ profile, query }) {
  const user = profile?.user || query.replace(/^@/, '');
  const following = isFollowing(user);
  useEffect(() => { updateFollow(profile); }, [profile?.user, profile?.avatar]);
  return html`<div class="xprofile">
    <span class="xavatar">${profile?.avatar ? html`<${Thumb} src=${profile.avatar} />` : html`<${Icon} name="user" size=${22} />`}</span>
    <span class="xprofile-text"><strong>${profile?.name || user}</strong><small>@${user} · photos et vidéos récentes</small></span>
    <button type="button" class=${cx('btn small', following && 'ghost')} onClick=${() => {
      haptic();
      toggleFollow({ user, name: profile?.name, avatar: profile?.avatar });
    }}><${Icon} name=${following ? 'userCheck' : 'userPlus'} size=${15} />${following ? 'Suivi' : 'Suivre'}</button>
  </div>`;
}

/** Shown on the X tab for word searches: X hides most adult posts there. */
function XHint() {
  const follows = state.xFollows.slice(0, 12);
  return html`<div class="xhint">
    <p><${Icon} name="info" size=${15} /> Sur X, la recherche par mots ne renvoie qu'une poignée de posts adultes (X les cache sans compte).
      Pour du volume : un compte précis (<b>@nom</b>), ou l'onglet RedGIFs.</p>
    ${follows.length ? html`<div class="chips scroll-x">${follows.map(f => html`<button type="button" key=${f.user} class="chip small"
      onClick=${() => { haptic(); runSearch(`@${f.user}`); }}><${Icon} name="at" size=${12} />${f.user}</button>`)}</div>` : null}
  </div>`;
}

/** RedGIFs' own search, loaded by the phone inside the app (no relay needed, no server limit). */
function RedgifsEmbed({ per }) {
  const S = state.search;
  const mode = modeOf(state.settings);
  const src = redgifsSitePage(S.sent || S.query, { mode, media: state.filters.media });
  const relay = state.settings.rgRelay;
  return html`<div class="rg-embed">
    <div class="rg-embed-bar">
      <span><${Icon} name="info" size=${14} /> ${per.relayError ? 'Relais indisponible : résultats' : 'Résultats'} de redgifs.com, chargés par ton iPhone.
        Touche « Enter » la première fois.</span>
      <button type="button" class="text-btn" onClick=${() => { haptic(); openSheet('custom', { render: () => html`<${RelaySheet} />` }); }}>
        ${relay ? 'Relais' : 'Grille SearchX'}</button>
    </div>
    <iframe key=${src} src=${src} title="RedGIFs" referrerpolicy="no-referrer"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen=${true}
      sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"></iframe>
  </div>`;
}

function TabError({ src, per }) {
  const S = state.search;
  const [open, setOpen] = useState(false);
  const mode = modeOf(state.settings);
  return html`<div class="tab-error">
    <div class="empty-icon"><${Icon} name="warn" size=${30} stroke=${1.7} /></div>
    <h3>${SOURCES[src].name} ne répond pas</h3>
    <p>${per.error}</p>
    ${src === 'rule34' && /clé|API/i.test(per.error || '') && html`<p class="muted">Ajoute ta clé dans Réglages → Sources → Identifiants Rule34.</p>`}
    <div class="sheet-buttons col">
      ${src === 'redgifs' && (per.hint === 'relay' || /Cloudflare|429|relais/i.test(per.error || '')) && html`<button type="button" class="btn"
        onClick=${() => { haptic(); openSheet('custom', { render: () => html`<${RelaySheet} />` }); }}>
        <${Icon} name="zap" size=${16} /> ${state.settings.rgRelay ? 'Vérifier le relais RedGIFs' : 'Activer le relais RedGIFs (3 min)'}</button>`}
      <button type="button" class="btn" onClick=${() => { haptic(); retrySource(src); }}><${Icon} name="refresh" size=${16} /> Réessayer</button>
      <a class="btn ghost" href=${siteSearchUrl(src, S.query, { mode })} target="_blank" rel="noopener noreferrer" onClick=${() => haptic()}>
        <${Icon} name="external" size=${16} /> Ouvrir « ${S.query} » sur ${SOURCES[src].name}</a>
    </div>
    ${(per.debug || per.phone) ? html`<button type="button" class="text-btn muted-btn" onClick=${() => setOpen(!open)}>${open ? 'Masquer' : 'Voir'} le détail</button>` : null}
    ${open && html`<div class="debug-box">
      ${per.phone && html`<p><b>Depuis le téléphone :</b> ${per.phone}</p>`}
      ${per.debug && html`<p><b>Détail serveur :</b> ${per.debug}</p>`}
    </div>`}
    <button type="button" class="text-btn muted-btn" onClick=${() => { haptic(); disableSources([src]); }}>Ne plus utiliser ${SOURCES[src].name}</button>
  </div>`;
}

function Results() {
  const S = state.search;
  const onOpen = useCallback(item => { haptic(); openViewer(state.search.results, item.id); }, []);
  const onLong = useCallback(item => openSheet('item', { item }), []);
  const onEnd = useCallback(() => loadMore(), []);

  if (S.notice) return html`<${EmptyState} icon="shield" title="Recherche refusée" text=${S.notice} />`;
  if (S.redirect === 'hentai') {
    return html`<${EmptyState} icon="sakura" title="Ça, c'est du hentai"
      text=${`Le mode porno ne montre jamais de hentai. « ${S.query} » se cherche en mode hentai, sur les sites hentai.`}>
      <button type="button" class="btn small" onClick=${() => { const q = S.query; switchMode('hentai'); runSearch(q); }}>
        <${Icon} name="sakura" size=${16} /> Chercher en mode hentai</button>
    <//>`;
  }
  const src = S.tab;
  const per = S.per[src];
  if (!per) return html`<${EmptyState} icon="sliders" title="Aucune source" text="Active au moins une source dans Réglages." />`;
  const isX = src === 'x';
  const account = isX && /^@\w{1,15}$/.test(S.query);
  const head = isX ? (account ? html`<${XProfile} profile=${per.profile} query=${S.query} />` : html`<${XHint} />`) : null;

  if (per.embed && per.state === 'done') return html`<${RedgifsEmbed} per=${per} />`;
  if (per.state === 'error' && per.error === REFUSED_MESSAGE) {
    return html`${head}<${EmptyState} icon="shield" title=${`Refusé sur ${SOURCES[src].name}`}
      text=${`${SOURCES[src].name} n'est pas vérifié comme les sites pro : les mots qui peuvent viser des mineurs y sont refusés. Les autres onglets restent disponibles.`} />`;
  }
  if (per.state === 'error') return html`${head}<${TabError} src=${src} per=${per} /><${MoreResults} />`;
  if (!S.results.length && per.state === 'loading') return html`${head}<${SkeletonGrid} count=${8} />`;
  if (!S.results.length) {
    const others = activeSources().filter(s => s !== src && S.per[s]?.items.length);
    const filtered = per.items.length > 0;
    return html`${head}<${MoreResults} /><${EmptyState} icon="search" title=${filtered ? 'Rien avec ces filtres' : `Rien sur ${SOURCES[src].name}`}
      kaomoji="(´・ω・\`)"
      text=${filtered ? 'Élargis la durée ou la qualité.' : `Aucun résultat pour « ${S.query} » sur ${SOURCES[src].name}.`}>
      ${filtered ? html`<button type="button" class="btn ghost small" onClick=${() => { resetFilters(); clearCreators(); }}>Réinitialiser les filtres</button>` : null}
      ${others.length ? html`<div class="other-tabs">${others.map(s => html`<button type="button" key=${s} class="chip"
        style=${`--c:${SOURCES[s].color}`} onClick=${() => { haptic(); setTab(s); }}><i class="dotc"></i>${SOURCES[s].name} <em>${S.per[s].items.length}</em></button>`)}</div>` : null}
    <//>`;
  }
  const footer = S.loadingMore
    ? html`<div class="list-end"><${Spinner} /></div>`
    : canLoadMore()
      ? html`<div class="list-end"><button type="button" class="btn ghost small" onClick=${() => { haptic(); loadMore(); }}>Charger plus</button></div>`
      : html`<div class="list-end muted">Fin des résultats ${SOURCES[src].name}</div>`;
  return html`${head}<${Grid} items=${S.results} onOpen=${onOpen} onLongPress=${onLong} footer=${html`${footer}<${MoreResults} />`} onEndReached=${onEnd} />`;
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

function ModeSwitch() {
  const mode = modeOf(state.settings);
  return html`<div class="mode-switch" role="tablist" aria-label="Mode">
    ${Object.entries(MODES).map(([k, m]) => html`<button type="button" key=${k} role="tab" aria-selected=${mode === k ? 'true' : 'false'}
      class=${cx('mode-btn', `m-${k}`, mode === k && 'on')} onClick=${() => switchMode(k)}>
      <${Icon} name=${m.icon} size=${16} /><span>${m.label}</span></button>`)}
  </div>`;
}

function XFollowsStrip() {
  const follows = state.xFollows;
  return html`<section class="strip">
    <header><h3>Comptes X</h3>${follows.length ? html`<button type="button" class="text-btn"
      onClick=${() => { haptic(); openSheet('xaccounts'); }}>Gérer</button>` : null}</header>
    ${follows.length ? html`<div class="xfollows">
      ${follows.map(f => html`<button type="button" key=${f.user} class="xfollow" onClick=${() => { haptic(); runSearch(`@${f.user}`); }}>
        <span class="xavatar">${f.avatar ? html`<${Thumb} src=${f.avatar} />` : html`<${Icon} name="user" size=${22} />`}</span>
        <span>${f.name || f.user}</span>
      </button>`)}
      <button type="button" class="xfollow add" onClick=${() => { haptic(); openSheet('xaccounts'); }}>
        <span class="xavatar"><${Icon} name="plus" size=${22} /></span><span>Ajouter</span></button>
    </div>`
    : html`<button type="button" class="xempty" onClick=${() => { haptic(); openSheet('xaccounts'); }}>
        <${Icon} name="at" size=${22} />
        <span><b>Suis des comptes X</b><small>Leurs photos et vidéos en un geste. Tu peux aussi taper @nom dans la recherche.</small></span>
        <${Icon} name="chevronRight" size=${18} />
      </button>`}
  </section>`;
}

function Categories({ hentai }) {
  const list = hentai ? HENTAI_CATEGORIES : PORN_CATEGORIES;
  return html`<section class="chip-section">
    <header><h3 data-jp=${hentai ? 'ジャンル' : null}>Catégories</h3></header>
    <div class="cat-grid">${list.map(c => html`<button type="button" key=${c.q} class="cat"
      onClick=${() => { haptic(); runSearch(c.q); }}>${hentai
        ? html`<b lang="ja">${c.jp}</b><span>${c.fr}</span>`
        : html`<b>${c.fr}</b><span>${c.q}</span>`}</button>`)}</div>
  </section>`;
}

function Welcome() {
  const mode = modeOf(state.settings);
  const hentai = mode === 'hentai';
  const seen = new Set();
  // Each mode keeps to its own content, here too.
  const resume = state.history.map(h => h.item).filter(it => itemMode(it) === mode && !seen.has(it.id) && seen.add(it.id)).slice(0, 14);
  const favs = state.favorites.filter(it => itemMode(it) === mode).slice(0, 14);
  const recent = recentList();
  const names = activeSources().map(s => SOURCES[s].name);
  return html`<div class="welcome">
    <${InstallCard} />
    <div class="hero">
      ${isNeon() && html`<${Petals} count=${7} />`}
      ${hentai
        ? html`<div class="hero-kicker" lang="ja">変態サーチ<span>18禁</span></div>
          <h1>Tout le hentai,<br /><span>en une recherche.</span></h1>`
        : html`<div class="hero-kicker">SearchX<span>18+</span></div>
          <h1>Le meilleur du X,<br /><span>sans le bazar.</span></h1>`}
      <p>${names.join(' · ') || 'Aucune source activée'}</p>
      <${ModeSwitch} />
    </div>
    ${!hentai && activeSources().includes('x') ? html`<${XFollowsStrip} />` : null}
    <${Strip} title="Reprendre" jp=${hentai ? '続きを見る' : null} items=${resume} onOpen=${it => { haptic(); openViewer(resume, it.id); }}
      action=${html`<button type="button" class="text-btn" onClick=${() => { haptic(); switchTab('history'); }}>Historique</button>`} />
    <${Strip} title="Favoris" jp=${hentai ? 'お気に入り' : null} items=${favs} onOpen=${it => { haptic(); openViewer(favs, it.id); }}
      action=${html`<button type="button" class="text-btn" onClick=${() => { haptic(); state.libSegment = 'favorites'; switchTab('library'); }}>Tout voir</button>`} />
    ${recent.length ? html`<section class="chip-section">
      <header><h3 data-jp=${hentai ? '最近の検索' : null}>Recherches récentes</h3><button type="button" class="text-btn" onClick=${() => { haptic(); clearRecent(); }}>Effacer</button></header>
      <div class="chips wrap">${recent.slice(0, 14).map(r => html`<button type="button" key=${r} class="chip pillish"
        onClick=${() => { haptic(); runSearch(r); }}>${r}</button>`)}</div>
    </section>` : null}
    <${Categories} hentai=${hentai} />
  </div>`;
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
      ${S.query && !S.notice && !S.redirect && html`<${SourceTabs} />`}
    </header>
    <div class="ptr" style=${`height:${pull}px`}>
      ${(pull > 0 || busy) && html`<span class=${cx('ptr-icon', (pull > 70 || busy) && 'ready', busy && 'spin')}><${Icon} name="refresh" size=${20} /></span>`}
    </div>
    <main class="content">
      ${S.query ? html`${!S.notice && !S.redirect && html`<${ResultsToolbar} />`}<${Results} />` : html`<${Welcome} />`}
    </main>
    ${S.query && html`<${ScrollTop} />`}
  </div>`;
}
