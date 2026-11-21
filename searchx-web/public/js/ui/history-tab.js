import { html } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { EmptyState, Thumb, SwipeRow, SourceBadge } from './common.js';
import { openViewer } from './viewer.js';
import { state, openSheet } from '../state.js';
import { deleteHistory, clearHistory } from '../library.js';
import { haptic } from '../lib/haptics.js';
import { dayKey, dayLabel, time, duration, watched } from '../lib/format.js';
import { SOURCES } from '../config.js';

export function HistoryTab() {
  const entries = state.history;
  const groups = [];
  let current = null;
  for (const e of entries) {
    const k = dayKey(e.at);
    if (!current || current.key !== k) { current = { key: k, label: dayLabel(e.at), entries: [] }; groups.push(current); }
    current.entries.push(e);
  }
  const confirmClear = () => openSheet('confirm', {
    title: "Effacer tout l'historique ?",
    text: `${entries.length} élément${entries.length > 1 ? 's' : ''} seront supprimés. C'est définitif.`,
    confirm: "Effacer l'historique",
    onConfirm: () => clearHistory()
  });
  return html`<div class="tab">
    <header class="topbar plain">
      <div class="title-row">
        <h1 class="page-title">Historique</h1>
        ${entries.length ? html`<button type="button" class="text-btn danger" onClick=${() => { haptic(); confirmClear(); }}>Effacer</button>` : null}
      </div>
    </header>
    <main class="content">
      ${!entries.length ? html`<${EmptyState} icon="history" title="Historique vide" text="Tout ce que tu ouvres apparaîtra ici, classé par jour." />`
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
