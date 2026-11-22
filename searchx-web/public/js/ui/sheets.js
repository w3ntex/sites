import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Sheet, Switch, SourceBadge, Thumb, cx } from './common.js';
import { state, closeSheet, openSheet, toast, notify, updateSettings } from '../state.js';
import { SOURCES, SOURCE_ORDER, MEDIA_OPTIONS, DUR_OPTIONS, HD_OPTIONS, SORT_OPTIONS, LAYOUTS, siteSearchUrl } from '../config.js';
import { setFilters, resetFilters, toggleCreator, clearCreators, showOnlyCreator, retrySource, runSearch, disableSources } from '../search.js';
import { toggleFavorite, isFavorite, addToPlaylist, createPlaylist } from '../library.js';
import { downloadUrl } from '../api.js';
import { haptic } from '../lib/haptics.js';

/** Single-choice list (filters, lock delay…). */
function OptionsSheet({ title, options, value, onPick }) {
  return html`<${Sheet} title=${title} onClose=${closeSheet}>${close => html`
    <div class="options">
      ${options.map(([v, label]) => html`<button type="button" key=${String(v)} class=${cx('option', v === value && 'on')}
        onClick=${() => { haptic(); onPick(v); close(); }}>
        <span>${label}</span>${v === value && html`<${Icon} name="check" size=${20} />`}
      </button>`)}
    </div>`}<//>`;
}

function SourcesSheet() {
  const f = state.filters;
  const toggle = src => {
    const sources = f.sources.includes(src) ? f.sources.filter(s => s !== src) : [...f.sources, src];
    setFilters({ sources: SOURCE_ORDER.filter(s => sources.includes(s)) });
  };
  return html`<${Sheet} title="Sources" onClose=${closeSheet}>
    <div class="options">
      ${SOURCE_ORDER.map(src => html`<div class="option static" key=${src}>
        <${SourceBadge} src=${src} />
        <span class="grow">${SOURCES[src].name}</span>
        <${Switch} checked=${f.sources.includes(src)} onChange=${() => toggle(src)} label=${SOURCES[src].name} />
      </div>`)}
    </div>
    <div class="sheet-buttons">
      <button type="button" class="btn ghost" onClick=${() => setFilters({ sources: SOURCE_ORDER.slice() })}>Tout activer</button>
      <button type="button" class="btn ghost" onClick=${() => setFilters({ sources: [] })}>Tout désactiver</button>
    </div>
  <//>`;
}

function CreatorsSheet() {
  const [q, setQ] = useState('');
  const S = state.search;
  const list = q.trim() ? S.creators.filter(c => c.key.includes(q.trim().toLowerCase())) : S.creators;
  return html`<${Sheet} title=${`Créateurs (${S.creators.length})`} onClose=${closeSheet} tall
    actions=${S.selectedCreators.length ? html`<button type="button" class="text-btn" onClick=${() => clearCreators()}>Tout afficher</button>` : null}>
    ${close => html`
    <div class="sheet-search">
      <${Icon} name="search" size=${16} />
      <input type="search" placeholder="Chercher un créateur" value=${q} onInput=${e => setQ(e.currentTarget.value)}
        autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" />
    </div>
    <div class="creator-list">
      ${list.map(c => {
        const on = S.selectedCreators.includes(c.key);
        return html`<div class=${cx('creator-row', on && 'on')} key=${c.key}>
          <button type="button" class="creator-main" onClick=${() => { haptic(); toggleCreator(c.key); }}>
            <span class="avatar"><${Thumb} src=${c.thumb} /></span>
            <span class="creator-text">
              <span class="creator-name">${c.name}</span>
              <span class="creator-sub">${c.sources.map(s => html`<${SourceBadge} src=${s} small key=${s} />`)}
                ${c.count} résultat${c.count > 1 ? 's' : ''}</span>
            </span>
            <span class=${cx('check', on && 'on')}>${on && html`<${Icon} name="check" size=${14} stroke=${3} />`}</span>
          </button>
          <button type="button" class="icon-btn subtle" aria-label="Rechercher ce créateur"
            onClick=${() => { close(); runSearch(c.name.replace(/^[@]|^u\//, '')); }}>
            <${Icon} name="search" size=${18} />
          </button>
        </div>`;
      })}
      ${!list.length && html`<p class="muted center pad">Aucun créateur trouvé.</p>`}
    </div>
    <p class="sheet-hint">Touche un créateur pour filtrer (plusieurs possibles). La loupe lance une nouvelle recherche sur son nom.</p>
    `}
  <//>`;
}

function ItemActionsSheet({ item }) {
  const fav = isFavorite(item.id);
  const dl = downloadUrl(item);
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ url: item.url });
      else { await navigator.clipboard.writeText(item.url); toast('Lien copié'); }
    } catch { /* cancelled */ }
  };
  return html`<${Sheet} title=${null} onClose=${closeSheet}>${close => html`
    <div class="action-head">
      <div class="action-thumb"><${Thumb} src=${item.thumb} fallback=${item.thumb2} /></div>
      <div class="action-title">
        <strong>${item.title}</strong>
        <span>${SOURCES[item.src]?.name || item.src}${item.by?.[0] ? ` · ${item.by[0]}` : ''}</span>
      </div>
    </div>
    <div class="actions">
      <button type="button" class="action" onClick=${() => { toggleFavorite(item); close(); }}>
        <${Icon} name=${fav ? 'heartFill' : 'heart'} /><span>${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}</span>
      </button>
      <button type="button" class="action" onClick=${() => openSheet('playlist', { item })}>
        <${Icon} name="listPlus" /><span>Ajouter à une playlist…</span>
      </button>
      ${(item.by || []).slice(0, 3).map(name => html`<button type="button" class="action" key=${name}
        onClick=${() => { showOnlyCreator(name); state.viewer = null; state.tab = 'search'; close(); }}>
        <${Icon} name="user" /><span>Seulement ${name}</span>
      </button>`)}
      ${dl && html`<a class="action" href=${dl} download onClick=${() => { toast('Téléchargement…'); close(); }}>
        <${Icon} name="download" /><span>Télécharger le fichier</span>
      </a>`}
      <button type="button" class="action" onClick=${() => { share(); close(); }}>
        <${Icon} name="share" /><span>Partager le lien</span>
      </button>
      <a class="action" href=${item.url} target="_blank" rel="noopener noreferrer" onClick=${() => close()}>
        <${Icon} name="external" /><span>Ouvrir sur ${SOURCES[item.src]?.name || 'le site'}</span>
      </a>
    </div>`}<//>`;
}

function PlaylistSheet({ item }) {
  const [name, setName] = useState('');
  const create = close => {
    const p = createPlaylist(name);
    addToPlaylist(p.id, item);
    close();
  };
  return html`<${Sheet} title="Ajouter à une playlist" onClose=${closeSheet}>${close => html`
    <form class="inline-form" onSubmit=${e => { e.preventDefault(); if (name.trim()) create(close); }}>
      <input type="text" placeholder="Nouvelle playlist" value=${name} onInput=${e => setName(e.currentTarget.value)} maxlength="60" />
      <button type="submit" class="btn small" disabled=${!name.trim()}>Créer</button>
    </form>
    <div class="options">
      ${state.playlists.map(p => {
        const has = p.items.some(i => i.id === item.id);
        return html`<button type="button" key=${p.id} class=${cx('option', has && 'on')} onClick=${() => { if (addToPlaylist(p.id, item)) close(); }}>
          <span class="pl-cover"><${Thumb} src=${p.items[0]?.thumb} /></span>
          <span class="grow">${p.name}<small>${p.items.length} élément${p.items.length > 1 ? 's' : ''}</small></span>
          ${has && html`<${Icon} name="check" size=${20} />`}
        </button>`;
      })}
      ${!state.playlists.length && html`<p class="muted center pad">Pas encore de playlist : crée la première ci-dessus.</p>`}
    </div>`}<//>`;
}

function ConfirmSheet({ title, text, confirm = 'Confirmer', danger = true, onConfirm }) {
  return html`<${Sheet} title=${title} onClose=${closeSheet}>${close => html`
    ${text && html`<p class="sheet-text">${text}</p>`}
    <div class="sheet-buttons col">
      <button type="button" class=${cx('btn', danger && 'danger')} onClick=${() => { haptic(); onConfirm(); close(); }}>${confirm}</button>
      <button type="button" class="btn ghost" onClick=${close}>Annuler</button>
    </div>`}<//>`;
}

function PromptSheet({ title, value = '', placeholder = '', confirm = 'OK', onSubmit }) {
  const [v, setV] = useState(value);
  const input = useRef(null);
  useEffect(() => { setTimeout(() => input.current?.focus(), 250); }, []);
  return html`<${Sheet} title=${title} onClose=${closeSheet}>${close => html`
    <form class="inline-form" onSubmit=${e => { e.preventDefault(); if (v.trim()) { onSubmit(v.trim()); close(); } }}>
      <input ref=${input} type="text" value=${v} placeholder=${placeholder} maxlength="60" onInput=${e => setV(e.currentTarget.value)} />
      <button type="submit" class="btn small" disabled=${!v.trim()}>${confirm}</button>
    </form>`}<//>`;
}

function SourceErrorSheet({ src }) {
  const per = state.search.per[src];
  return html`<${Sheet} title=${`${SOURCES[src]?.name} : erreur`} onClose=${closeSheet}>${close => html`
    <div class="error-box"><${Icon} name="warn" size=${20} /><p>${per?.error || 'Erreur inconnue.'}</p></div>
    ${(per?.phone || per?.debug) && html`<div class="debug-box">
      ${per?.phone && html`<p><b>Depuis le téléphone :</b> ${per.phone}</p>`}
      ${per?.debug && html`<p><b>Détail serveur :</b> ${per.debug}</p>`}
    </div>`}
    ${src === 'rule34' && /clé|API/i.test(per?.error || '') && html`<p class="sheet-text">Ajoute ta clé dans Réglages → Sources → Identifiants Rule34.</p>`}
    <div class="sheet-buttons col">
      <button type="button" class="btn" onClick=${() => { retrySource(src); close(); }}>Réessayer</button>
      ${state.search.query && html`<a class="btn ghost" href=${siteSearchUrl(src, state.search.query)} target="_blank" rel="noopener noreferrer"
        onClick=${() => haptic()}><${Icon} name="external" size=${16} /> Chercher « ${state.search.query} » sur ${SOURCES[src]?.name}</a>`}
      <button type="button" class="btn ghost" onClick=${() => { disableSources([src]); toast(`${SOURCES[src].name} désactivé`); close(); }}>Désactiver ${SOURCES[src]?.name}</button>
      ${src === 'rule34' && html`<button type="button" class="btn ghost" onClick=${() => { state.tab = 'settings'; close(); notify(); }}>Ouvrir les réglages</button>`}
    </div>`}<//>`;
}

function FiltersSheet({ target = 'current' }) {
  const isDefault = target === 'default';
  const f = isDefault ? state.defaultFilters : state.filters;
  const set = patch => {
    if (isDefault) {
      state.defaultFilters = { ...state.defaultFilters, ...patch };
      try { localStorage.setItem('sx.defaultFilters', JSON.stringify(state.defaultFilters)); } catch { /* ignore */ }
      notify();
    } else setFilters(patch);
  };
  const pick = (label, icon, options, k, disabled = false) => html`<div class=${cx('pick', disabled && 'disabled')}>
    <span class="pick-label"><${Icon} name=${icon} size=${15} />${label}</span>
    <div class="pick-opts">${options.map(([v, l]) => html`<button type="button" key=${v} class=${cx('pill', f[k] === v && 'on')} disabled=${disabled}
      onClick=${() => { haptic(); set({ [k]: v }); }}>${l}</button>`)}</div>
  </div>`;
  const toggleSource = src => {
    const sources = f.sources.includes(src) ? f.sources.filter(x => x !== src) : [...f.sources, src];
    set({ sources: SOURCE_ORDER.filter(x => sources.includes(x)) });
  };
  const durOK = f.media === 'all' || f.media === 'video';
  return html`<${Sheet} title=${isDefault ? 'Filtres par défaut' : 'Filtres'} onClose=${closeSheet} tall
    actions=${!isDefault ? html`<button type="button" class="text-btn" onClick=${() => { haptic(); resetFilters(); }}>Réinitialiser</button>` : null}>
    ${pick('Type', 'layers', MEDIA_OPTIONS, 'media')}
    ${pick('Durée', 'timer', DUR_OPTIONS, 'dur', !durOK)}
    ${pick('Qualité', 'sparkles', HD_OPTIONS, 'hd')}
    ${pick('Trier par', 'sort', SORT_OPTIONS, 'sort')}
    <div class="pick">
      <span class="pick-label"><${Icon} name="sliders" size=${15} />Sources (${f.sources.length}/${SOURCE_ORDER.length})</span>
      <div class="pick-opts">${SOURCE_ORDER.map(src => html`<button type="button" key=${src}
        class=${cx('pill src-pill', f.sources.includes(src) && 'on')} style=${`--c:${SOURCES[src].color}`}
        onClick=${() => { haptic(); toggleSource(src); }}><i class="dotc"></i>${SOURCES[src].name}</button>`)}</div>
    </div>
    ${!isDefault && html`<div class="pick">
      <span class="pick-label"><${Icon} name="list" size=${15} />Affichage</span>
      <div class="pick-opts">${LAYOUTS.map(([v, l]) => html`<button type="button" key=${v} class=${cx('pill', state.settings.layout === v && 'on')}
        onClick=${() => { haptic(); updateSettings({ layout: v }); }}>${l}</button>`)}
        <button type="button" class=${cx('pill', state.settings.previews && 'on')} onClick=${() => { haptic(); updateSettings({ previews: !state.settings.previews }); }}>
          Aperçus animés</button></div>
    </div>`}
    <p class="sheet-hint">${isDefault ? 'Appliqués au démarrage et quand tu réinitialises les filtres.'
      : "Durée, qualité, tri et sources s'appliquent tout de suite aux résultats déjà chargés. Changer le type relance la recherche."}</p>
  <//>`;
}

export function SheetHost() {
  const s = state.sheet;
  if (!s) return null;
  switch (s.type) {
    case 'options': return html`<${OptionsSheet} key=${s.key || s.title} ...${s} />`;
    case 'sources': return html`<${SourcesSheet} />`;
    case 'creators': return html`<${CreatorsSheet} />`;
    case 'item': return html`<${ItemActionsSheet} key=${s.item.id} item=${s.item} />`;
    case 'playlist': return html`<${PlaylistSheet} key=${`pl-${s.item.id}`} item=${s.item} />`;
    case 'confirm': return html`<${ConfirmSheet} ...${s} />`;
    case 'prompt': return html`<${PromptSheet} key=${s.title} ...${s} />`;
    case 'sourceError': return html`<${SourceErrorSheet} src=${s.src} />`;
    case 'filters': return html`<${FiltersSheet} target=${s.target} />`;
    default: return s.render ? s.render() : null;
  }
}
