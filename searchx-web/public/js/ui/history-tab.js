import { html, useState } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { EmptyState, Thumb, SwipeRow, SourceBadge } from './common.js';
import { openViewer } from './viewer.js';
import { state, openSheet } from '../state.js';
import { deleteHistory, clearHistory, clearHistorySince } from '../library.js';
import { FilterField } from './library-tab.js';
import { haptic } from '../lib/haptics.js';
import { dayKey, dayLabel, time, duration, watched } from '../lib/format.js';
import { SOURCES } from '../config.js';

const CLEAR_OPTIONS = [['hour', 'La dernière heure'], ['day', "Aujourd'hui"], ['all', "Tout l'historique"]];

export function HistoryTab() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const entries = query
    ? state.history.filter(e => `${e.item.title} ${(e.item.by || []).join(' ')} ${SOURCES[e.item.src]?.name || ''}`.toLowerCase().includes(query))
    : state.history;
  const groups = [];
  let current = null;
  for (const e of entries) {
    const k = dayKey(e.at);
    if (!current || current.key !== k) { current = { key: k, label: dayLabel(e.at), entries: [] }; groups.push(current); }
    current.entries.push(e);
  }
  const confirmClear = () => openSheet('options', {
    title: 'Effacer…', key: 'clearhist', value: null, options: CLEAR_OPTIONS,
    onPick: v => {
      if (v === 'all') setTimeout(() => openSheet('confirm', {
        title: "Effacer tout l'historique ?", text: `${state.history.length} élément${state.history.length > 1 ? 's' : ''} seront supprimés. C'est définitif.`,
        confirm: "Effacer l'historique", onConfirm: () => clearHistory()
      }), 240);
      else {
        const since = v === 'hour' ? Date.now() - 3600 * 1000 : new Date().setHours(0, 0, 0, 0);
        clearHistorySince(since);
      }
    }
  });
  return html`<div class="tab">
    <header class="topbar plain">
      <div class="title-row">
        <h1 class="page-title" data-jp="履歴">Historique</h1>
        ${state.history.length ? html`<button type="button" class="text-btn danger" onClick=${() => { haptic(); confirmClear(); }}>Effacer</button>` : null}
      </div>
      ${state.history.length ? html`<${FilterField} value=${q} onInput=${setQ} placeholder="Chercher dans l'historique" />` : null}
    </header>
    <main class="content">
      ${!entries.length ? html`<${EmptyState} icon="history" title=${query ? 'Aucun résultat' : 'Historique vide'}
          text=${query ? "Rien dans l'historique ne correspond." : 'Tout ce que tu ouvres apparaîtra ici, classé par jour.'} />`
        : groups.map(g => html`<section class="day" key=${g.key}>
          <h3 class="day-title">${g.label}</h3>
          <div class="list-card">
            ${g.entries.map(e => html`<${SwipeRow} key=${e.hid} onDelete=${() => deleteHistory(e.hid)}>
              <button type="button" class="list-btn" onClick=${() => { haptic(); openViewer(g.entries.map(x => x.item), e.item.id); }}>
                <div class="list-row media-row">
                  <span class="mr-thumb"><${Thumb} src=${e.item.thumb} fallback=${e.item.thumb2} />
                    <em>${e.item.type === 'video' ? duration(e.item.dur) : e.item.type === 'gif' ? 'GIF' : 'IMG'}</em></span>
                  <span class="list-text"><strong class="two">${e.item.title}</strong>
                    <small><${SourceBadge} src=${e.item.src} small /> ${SOURCES[e.item.src]?.name || ''} · ${time(e.at)}${e.watched ? ` · ${watched(e.watched)}` : ''}</small></span>
                </div>
              </button>
            <//>`)}
          </div>
        </section>`)}
      ${entries.length ? html`<p class="list-end muted"><${Icon} name="hand" size=${14} /> Glisse une ligne vers la gauche pour la supprimer.</p>` : null}
    </main>
  </div>`;
}
