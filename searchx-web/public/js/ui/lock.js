import { html, useState } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Sheet, cx } from './common.js';
import { state, notify, updateSettings, closeSheet, toast } from '../state.js';
import { hashPin, newSalt, verifyBiometrics } from '../lib/lock.js';
import { haptic } from '../lib/haptics.js';

export function PinPad({ value, length = 4, error = false, onDigit, onDelete, extraKey = null }) {
  return html`<div class="pinpad-wrap">
    <div class=${cx('pin-dots', error && 'shake')}>
      ${Array.from({ length }, (_, i) => html`<span key=${i} class=${cx(i < value.length && 'on')}></span>`)}
    </div>
    <div class="pinpad">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => html`<button type="button" key=${d} onClick=${() => onDigit(d)}>${d}</button>`)}
      ${extraKey || html`<span></span>`}
      <button type="button" onClick=${() => onDigit('0')}>0</button>
      <button type="button" class="pin-del" aria-label="Effacer" onClick=${onDelete}><${Icon} name="chevronLeft" size=${26} /></button>
    </div>
  </div>`;
}

export function LockScreen() {
  const s = state.settings;
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const unlock = () => { state.locked = false; notify(); };
  const check = async p => {
    if (await hashPin(p, s.pinSalt) === s.pinHash) { haptic(); unlock(); return; }
    haptic();
    setError(true);
    setTimeout(() => { setError(false); setPin(''); }, 480);
  };
  const digit = d => {
    if (pin.length >= 4 || error) return;
    haptic();
    const p = pin + d;
    setPin(p);
    if (p.length === 4) check(p);
  };
  const bio = async () => {
    haptic();
    try { if (await verifyBiometrics(s.bioId)) unlock(); } catch { toast('Face ID annulé : utilise ton code.'); }
  };
  return html`<div class="lock-screen">
    <div class="lock-top">
      <div class="lock-icon"><${Icon} name="lock" size=${26} /></div>
      <h2>SearchX est verrouillé</h2>
      <p class="muted">Entre ton code${s.bioId ? ' ou utilise Face ID' : ''}</p>
    </div>
    <${PinPad} value=${pin} error=${error} onDigit=${digit} onDelete=${() => { haptic(); setPin(pin.slice(0, -1)); }}
      extraKey=${s.bioId ? html`<button type="button" class="pin-bio" aria-label="Face ID" onClick=${bio}><${Icon} name="faceid" size=${30} /></button>` : null} />
  </div>`;
}

export function PinSetupSheet() {
  const [step, setStep] = useState('new');
  const [first, setFirst] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const digit = async (d, close) => {
    if (pin.length >= 4 || error) return;
    haptic();
    const p = pin + d;
    setPin(p);
    if (p.length < 4) return;
    if (step === 'new') {
      setTimeout(() => { setFirst(p); setPin(''); setStep('confirm'); }, 180);
      return;
    }
    if (p !== first) {
      setError(true);
      setTimeout(() => { setError(false); setPin(''); setFirst(''); setStep('new'); toast('Les codes ne correspondent pas.'); }, 480);
      return;
    }
    const salt = newSalt();
    updateSettings({ pinSalt: salt, pinHash: await hashPin(p, salt) });
    toast('Code activé');
    close();
  };
  return html`<${Sheet} title=${step === 'new' ? 'Choisis un code à 4 chiffres' : 'Confirme le code'} onClose=${closeSheet}>
    ${close => html`<${PinPad} value=${pin} error=${error} onDigit=${d => digit(d, close)} onDelete=${() => setPin(pin.slice(0, -1))} />`}
  <//>`;
}
