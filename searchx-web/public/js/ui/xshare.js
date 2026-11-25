import { html, useState, useEffect } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Sheet, Spinner } from './common.js';
import { closeSheet, toast } from '../state.js';
import { haptic } from '../lib/haptics.js';
import { inboxAddUrl, pullInbox } from '../lib/inbox.js';

function CopyField({ value }) {
  return html`<div class="copy-field">
    <code>${value}</code>
    <button type="button" class="btn small" onClick=${async () => {
      haptic();
      try { await navigator.clipboard.writeText(value); toast('Adresse copiée'); } catch { toast('Copie impossible : sélectionne le texte.'); }
    }}><${Icon} name="copy" size=${15} /> Copier</button>
  </div>`;
}

/**
 * "Partager → SearchX" from the X app. iOS does not let web apps appear in the share sheet, so a
 * Shortcut named SearchX does it: it sends what X shared to this phone's mailbox on the server, and
 * the app follows the account when it opens.
 */
export function XShareSheet() {
  const url = inboxAddUrl(); // creates this phone's mailbox the first time
  const [got, setGot] = useState([]);
  // While these steps are open, a share made now shows up here within a few seconds.
  useEffect(() => {
    const t = setInterval(async () => {
      const users = await pullInbox();
      if (users.length) setGot(g => [...g, ...users]);
    }, 3000);
    return () => clearInterval(t);
  }, []);
  return html`<${Sheet} title="Partager depuis X" onClose=${closeSheet} tall>
    <p class="sheet-text">Sur un profil dans l’app X : <b>Partager → SearchX</b>, et le compte arrive tout seul dans tes comptes suivis.
      iOS ne laisse pas une app web apparaître dans ce menu : un petit <b>raccourci</b> nommé SearchX s’en charge (à créer une fois, 2 minutes).</p>
    <ol class="steps step-cards">
      <li>Ouvre l’app <b>Raccourcis</b> et touche <b>+</b> pour créer un raccourci.</li>
      <li>Touche le nom en haut (⌄) → <b>Renommer</b> : <b>SearchX</b>. Toujours dans ce menu, ouvre <b>Détails</b> (ou ⓘ)
        et active <b>« Afficher dans la feuille de partage »</b>, puis <b>OK</b>.</li>
      <li>Touche <b>Ajouter une action</b>, cherche <b>« Obtenir le contenu de l’URL »</b> et touche-la.</li>
      <li>Touche le champ bleu de l’adresse, efface-le et colle cette adresse :
        <${CopyField} value=${url} />
        puis, juste derrière, touche <b>« Entrée du raccourci »</b> dans la barre au-dessus du clavier.</li>
      <li>Facultatif : ajoute l’action <b>« Afficher la notification »</b> avec <b>« Contenu de l’URL »</b> : tu verras « ✓ @… ajouté à SearchX ».</li>
    </ol>
    <p class="sheet-text">Ensuite, dans X : ouvre un profil → <b>⋯</b> → <b>Partager</b> (ou <b>Partager via…</b>) → <b>SearchX</b> dans la rangée du bas.
      Partager un post marche aussi : son auteur est ajouté. Reviens dans SearchX : le compte est dans la liste.</p>
    ${got.length
      ? html`<p class="ok-line"><${Icon} name="check" size=${16} /> Reçu : ${got.map(u => `@${u}`).join(', ')}. C’est prêt !</p>`
      : html`<div class="music-wait"><${Spinner} size=${20} /><p>Pour tester : garde cette page ouverte, partage un profil depuis X, puis reviens ici.</p></div>`}
    <p class="sheet-hint">Cette adresse est propre à ce téléphone : elle permet seulement d’ajouter des comptes à ta liste. Ne la partage pas.</p>
  <//>`;
}

/** Entry in the "Comptes X" sheet. */
export function XShareEntry({ onOpen }) {
  return html`<button type="button" class="xshare-entry" onClick=${() => { haptic(); onOpen(); }}>
    <span class="row-icon" style="background:#1d9bf0"><${Icon} name="share" size=${17} /></span>
    <span class="xshare-text"><b>Partager depuis l’app X</b><small>Profil X → Partager → SearchX : ajouté tout seul</small></span>
    <${Icon} name="chevronRight" size=${18} />
  </button>`;
}
