import { html, useState, useCallback } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Segmented, EmptyState, Thumb, SwipeRow, SortableList, SourceBadge, cx } from './common.js';
import { Grid } from './grid.js';
import { openViewer } from './viewer.js';
import { state, notify, openSheet } from '../state.js';
import {
  createPlaylist, deletePlaylist, renamePlaylist, removeFromPlaylist, movePlaylistItem, movePlaylist, playlistById,
  favoritesOf, playlistsOf
} from '../library.js';
import { haptic } from '../lib/haptics.js';
import { duration } from '../lib/format.js';
import { SOURCES, MODES, modeOf } from '../config.js';
import { switchMode } from './search-tab.js';

/** "12 favoris en mode hentai" — the other mode's content stays hidden here. */
function OtherMode({ count, what }) {
  const other = modeOf(state.settings) === 'hentai' ? 'porn' : 'hentai';
  if (!count) return null;
  return html`<button type="button" class="other-mode" onClick=${() => switchMode(other)}>
    <${Icon} name=${MODES[other].icon} size=${14} />${count} ${what} en mode ${MODES[other].label.toLowerCase()} · Changer de mode
  </button>`;
}

const FAV_SORTS = [['recent', 'Récents'], ['old', 'Anciens'], ['source', 'Par source'], ['title', 'A → Z']];

function matchText(it, q) {
  if (!q) return true;
  const hay = `${it.title} ${(it.by || []).join(' ')} ${SOURCES[it.src]?.name || ''} ${(it.tags || []).join(' ')}`.toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

export function FilterField({ value, onInput, placeholder }) {
  return html`<div class="filter-field">
    <${Icon} name="search" size=${16} />
    <input type="search" value=${value} placeholder=${placeholder} onInput=${e => onInput(e.currentTarget.value)}
      autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" />
    ${value && html`<button type="button" class="clear" aria-label="Effacer" onClick=${() => onInput('')}><${Icon} name="x" size=${12} stroke=${3} /></button>`}
  </div>`;
}

function Favorites() {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');
  const query = q.trim().toLowerCase();
  const mine = favoritesOf();
  let list = mine.filter(it => matchText(it, query));
  if (sort === 'old') list = list.slice().reverse();
  if (sort === 'source') list = list.slice().sort((a, b) => a.src.localeCompare(b.src));
  if (sort === 'title') list = list.slice().sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  const onOpen = item => { haptic(); openViewer(list, item.id); };
  const onLong = useCallback(item => openSheet('item', { item }), []);
  const others = state.favorites.length - mine.length;
  if (!mine.length) {
    return html`<${EmptyState} icon="heart" title="Aucun favori"
      text="Appuie longuement sur un résultat (ou touche ♥ dans le lecteur) pour l'ajouter ici.">
      <${OtherMode} count=${others} what=${`favori${others > 1 ? 's' : ''}`} />
    <//>`;
  }
  return html`<div>
    <div class="list-tools">
      <${FilterField} value=${q} onInput=${setQ} placeholder="Chercher dans les favoris" />
      <button type="button" class="rb-btn" onClick=${() => { haptic(); openSheet('options', { title: 'Trier les favoris', key: 'favsort', options: FAV_SORTS, value: sort, onPick: setSort }); }}>
        <${Icon} name="sort" size=${14} />${FAV_SORTS.find(s => s[0] === sort)[1]}</button>
    </div>
    ${list.length ? html`<${Grid} items=${list} onOpen=${onOpen} onLongPress=${onLong}
      footer=${html`<div class="list-end muted">${list.length} favori${list.length > 1 ? 's' : ''}</div><${OtherMode} count=${others} what=${`favori${others > 1 ? 's' : ''}`} />`} />`
      : html`<p class="muted center pad">Aucun favori ne correspond.</p>`}
  </div>`;
}

function newPlaylist() {
  openSheet('prompt', {
    title: 'Nouvelle playlist', placeholder: 'Nom de la playlist', confirm: 'Créer',
    onSubmit: name => { createPlaylist(name); haptic(); }
  });
}

function Playlists() {
  const [edit, setEdit] = useState(false);
  const lists = playlistsOf();
  const others = state.playlists.length - lists.length;
  return html`<div class="pl-page">
    <div class="pl-toolbar">
      <button type="button" class="btn small" onClick=${() => { haptic(); newPlaylist(); }}><${Icon} name="plus" size=${16} /> Nouvelle playlist</button>
      ${lists.length > 1 && html`<button type="button" class="text-btn" onClick=${() => { haptic(); setEdit(!edit); }}>${edit ? 'OK' : 'Réorganiser'}</button>`}
    </div>
    ${!lists.length ? html`<${EmptyState} icon="list" title="Aucune playlist"
        text="Crée une playlist, puis ajoute des vidéos depuis le menu d'un résultat (appui long).">
        <${OtherMode} count=${others} what=${`playlist${others > 1 ? 's' : ''}`} />
      <//>`
      : edit ? html`<div class="list-card"><${SortableList} items=${lists} keyOf=${p => p.id} onMove=${movePlaylist}
          renderItem=${(p, i, handle) => html`<div class="list-row">
            <span class="pl-cover"><${Thumb} src=${p.items[0]?.thumb} /></span>
            <span class="list-text"><strong>${p.name}</strong><small>${p.items.length} élément${p.items.length > 1 ? 's' : ''}</small></span>
            <span class="handle" ...${handle}><${Icon} name="grip" size=${20} /></span>
          </div>`} /></div>`
      : html`<div class="list-card">${lists.map(p => html`<${SwipeRow} key=${p.id} onDelete=${() => confirmDeletePlaylist(p)}>
          <button type="button" class="list-row tappable" onClick=${() => { haptic(); state.playlistId = p.id; notify(); }}>
            <span class="pl-cover"><${Thumb} src=${p.items[0]?.thumb} /></span>
            <span class="list-text"><strong>${p.name}</strong><small>${p.items.length} élément${p.items.length > 1 ? 's' : ''}</small></span>
            <${Icon} name="chevronRight" size=${18} class="row-chevron" />
          </button>
        <//>`)}</div>`}
  </div>`;
}

function confirmDeletePlaylist(p) {
  openSheet('confirm', {
    title: `Supprimer « ${p.name} » ?`, text: 'Les vidéos restent dans tes favoris et ton historique.',
    confirm: 'Supprimer la playlist', onConfirm: () => deletePlaylist(p.id)
  });
}

function PlaylistDetail({ playlist }) {
  const [edit, setEdit] = useState(false);
  const items = playlist.items;
  const back = () => { haptic(); state.playlistId = null; notify(); };
  const play = (id = items[0]?.id) => { if (!id) return; haptic(); openViewer(items, id); };
  const menu = () => openSheet('options', {
    title: playlist.name, key: `pl-${playlist.id}`, value: null,
    options: [['rename', 'Renommer'], ['delete', 'Supprimer la playlist']],
    onPick: v => {
      if (v === 'rename') setTimeout(() => openSheet('prompt', { title: 'Renommer', value: playlist.name, confirm: 'Enregistrer', onSubmit: n => renamePlaylist(playlist.id, n) }), 240);
      if (v === 'delete') setTimeout(() => confirmDeletePlaylist(playlist), 240);
    }
  });
  const row = (it, handle) => html`<div class="list-row media-row">
    <span class="mr-thumb"><${Thumb} src=${it.thumb} fallback=${it.thumb2} />
      <em>${it.type === 'video' ? duration(it.dur) : it.type === 'gif' ? 'GIF' : 'IMG'}</em></span>
    <span class="list-text"><strong class="two">${it.title}</strong>
      <small><${SourceBadge} src=${it.src} small /> ${it.by?.[0] || SOURCES[it.src]?.name || ''}</small></span>
    ${handle ? html`<span class="handle" ...${handle}><${Icon} name="grip" size=${20} /></span>` : null}
  </div>`;
  return html`<div class="pl-detail">
    <div class="subnav">
      <button type="button" class="back-btn" onClick=${back}><${Icon} name="chevronLeft" size=${22} /><span>Playlists</span></button>
      <div class="subnav-right">
        ${items.length > 1 && html`<button type="button" class="text-btn" onClick=${() => { haptic(); setEdit(!edit); }}>${edit ? 'OK' : 'Réorganiser'}</button>`}
        <button type="button" class="icon-btn subtle" aria-label="Options" onClick=${() => { haptic(); menu(); }}><${Icon} name="more" size=${20} /></button>
      </div>
    </div>
    <div class="pl-hero">
      <div class="pl-hero-cover"><${Thumb} src=${items[0]?.thumb} /></div>
      <div>
        <h2>${playlist.name}</h2>
        <p class="muted">${items.length} élément${items.length > 1 ? 's' : ''}</p>
        ${items.length ? html`<button type="button" class="btn small" onClick=${() => play()}><${Icon} name="play" size=${15} /> Lire</button>` : null}
      </div>
    </div>
    ${!items.length ? html`<${EmptyState} icon="listPlus" title="Playlist vide" text="Ajoute des vidéos depuis le menu d'un résultat (appui long)." />`
      : edit ? html`<div class="list-card"><${SortableList} items=${items} keyOf=${i => i.id}
          onMove=${(from, to) => movePlaylistItem(playlist.id, from, to)} renderItem=${(it, i, handle) => row(it, handle)} /></div>`
      : html`<div class="list-card">${items.map(it => html`<${SwipeRow} key=${it.id} label="Retirer" onDelete=${() => removeFromPlaylist(playlist.id, it.id)}>
          <button type="button" class="list-btn" onClick=${() => play(it.id)}>${row(it, null)}</button>
        <//>`)}</div>`}
  </div>`;
}

export function LibraryTab() {
  const playlist = state.playlistId ? playlistById(state.playlistId) : null;
  if (playlist) return html`<div class="tab"><header class="topbar plain"></header><main class="content"><${PlaylistDetail} playlist=${playlist} /></main></div>`;
  const seg = state.libSegment;
  return html`<div class="tab">
    <header class="topbar plain">
      <h1 class="page-title" data-jp=${seg === 'favorites' ? 'お気に入り' : 'プレイリスト'}>${seg === 'favorites' ? 'Favoris' : 'Playlists'}</h1>
      <${Segmented} value=${seg} onChange=${v => { state.libSegment = v; notify(); }}
        options=${[['favorites', `Favoris${favoritesOf().length ? ` (${favoritesOf().length})` : ''}`], ['playlists', `Playlists${playlistsOf().length ? ` (${playlistsOf().length})` : ''}`]]} />
    </header>
    <main class=${cx('content', seg === 'favorites' && 'pad-top')}>${seg === 'favorites' ? html`<${Favorites} />` : html`<${Playlists} />`}</main>
  </div>`;
}
