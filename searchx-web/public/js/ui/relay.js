import { html, useState } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Sheet } from './common.js';
import { state, updateSettings, closeSheet, toast } from '../state.js';
import { testRelay } from '../api.js';
import { relayBase } from '../shared/apis.js';
import { retrySource } from '../search.js';
import { haptic } from '../lib/haptics.js';

/** Réglages → Relais RedGIFs: why, how to set it up from the iPhone, and a live test. */
export function RelaySheet() {
  const current = state.settings.rgRelay;
  const [url, setUrl] = useState(current || '');
  const [check, setCheck] = useState(null); // { state: 'loading' | 'ok' | 'error', msg }
  const save = async () => {
    const base = relayBase(url);
    if (!base) { setCheck({ state: 'error', msg: 'Adresse invalide. Exemple : sites-xxxx.vercel.app' }); return; }
    haptic();
    setCheck({ state: 'loading', msg: 'Test du relais…' });
    try {
      const n = await testRelay(base);
      updateSettings({ rgRelay: base });
      setCheck({ state: 'ok', msg: `Relais actif : ${n} résultats pour « blonde ». RedGIFs passe maintenant par lui.` });
      if (state.search.per.redgifs) retrySource('redgifs');
    } catch (e) {
      const protectedUrl = /401|403|Authentication|login/i.test(e.message || '');
      setCheck({ state: 'error', msg: protectedUrl
        ? "Cette adresse est protégée par Vercel : prends l'adresse courte affichée sous « Domains » (elle finit par .vercel.app)."
        : `Le relais ne répond pas : ${e.message}` });
    }
  };
  return html`<${Sheet} title="Relais RedGIFs" onClose=${closeSheet} tall>${close => html`
    <p class="sheet-text">Sans relais, l'onglet RedGIFs affiche le site redgifs.com dans l'app (ça marche déjà).
      Avec le relais, les résultats RedGIFs arrivent dans la grille SearchX (favoris, historique, filtres, lecteur plein écran).
      Le relais est un petit service <b>gratuit chez Vercel</b>, déjà prêt dans ton dépôt GitHub :</p>
    <ol class="steps">
      <li>Ouvre <a href="https://vercel.com/new" target="_blank" rel="noopener noreferrer">vercel.com/new</a> et choisis <b>Continue with GitHub</b>.</li>
      <li>À côté du dépôt <b>sites</b>, touche <b>Import</b> (autorise Vercel à voir le dépôt si on te le demande).</li>
      <li>Ne change rien et touche <b>Deploy</b>. Attends l'écran « Congratulations ».</li>
      <li>Ouvre le projet : sous <b>Domains</b>, copie l'adresse la plus courte (du type <b>sites-xxxx.vercel.app</b>) et colle-la ici.</li>
    </ol>
    <label class="field-label">Adresse du relais</label>
    <input class="field" type="url" inputmode="url" placeholder="sites-xxxx.vercel.app" value=${url}
      onInput=${e => setUrl(e.currentTarget.value.trim())} autocapitalize="off" autocorrect="off" spellcheck="false" />
    ${check && html`<p class=${check.state === 'ok' ? 'ok-line' : check.state === 'error' ? 'bad relay-msg' : 'muted relay-msg'}>
      ${check.state === 'ok' && html`<${Icon} name="check" size=${16} />`}${check.msg}</p>`}
    <div class="sheet-buttons col">
      <button type="button" class="btn" disabled=${!url || check?.state === 'loading'} onClick=${save}>Enregistrer et tester</button>
      ${current && html`<button type="button" class="btn ghost danger-text" onClick=${() => { updateSettings({ rgRelay: '' }); toast('Relais retiré'); close(); }}>Retirer le relais</button>`}
    </div>
    <p class="sheet-hint">Le relais transmet seulement tes recherches RedGIFs (rien n'est enregistré). Le compte Vercel gratuit suffit largement.</p>
  `}<//>`;
}
