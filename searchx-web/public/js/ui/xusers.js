import { html, useState, useEffect } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Thumb, cx } from './common.js';
import { searchXUsers } from '../api.js';

/**
 * X accounts matching what is typed, as you type (Nitter's account search through the server,
 * debounced). → { q, users, loading, error }
 */
export function useXUserSuggestions(text, enabled = true) {
  const [st, setSt] = useState({ q: '', users: [], loading: false, error: '' });
  useEffect(() => {
    const q = String(text || '').trim().replace(/^@/, '');
    if (!enabled || q.length < 2 || q.length > 50) { setSt({ q, users: [], loading: false, error: '' }); return; }
    const ctrl = new AbortController();
    setSt(s => ({ ...s, q, loading: true, error: '' }));
    const t = setTimeout(() => {
      searchXUsers(q, ctrl.signal)
        .then(users => { if (!ctrl.signal.aborted) setSt({ q, users, loading: false, error: '' }); })
        .catch(e => { if (!ctrl.signal.aborted) setSt({ q, users: [], loading: false, error: e?.message || 'Recherche impossible.' }); });
    }, 320);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [text, enabled]);
  return st;
}

export function XAvatar({ u, size = 'small' }) {
  return html`<span class=${cx('xavatar', size)}>${u.avatar ? html`<${Thumb} src=${u.avatar} />` : html`<${Icon} name="user" size=${16} />`}</span>`;
}

/** One account: picture, name (certified, private), @name and the start of the bio. */
export function XUserRow({ u, onPick, action = null, compact = false }) {
  return html`<div class=${cx('xuser', compact && 'compact')}>
    <button type="button" class="xuser-main" onClick=${() => onPick(u)}>
      <${XAvatar} u=${u} />
      <span class="xuser-text">
        <b><span>${u.name || u.user}</span>${u.verified ? html`<${Icon} name="verified" size=${14} class="xverified" />` : null}${u.locked ? html`<${Icon} name="lock" size=${12} class="xlocked" />` : null}</b>
        <small>@${u.user}${!compact && u.bio ? html`<em> · ${u.bio}</em>` : null}</small>
      </span>
    </button>
    ${action}
  </div>`;
}
