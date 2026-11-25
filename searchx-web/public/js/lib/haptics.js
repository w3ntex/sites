import { state } from '../state.js';

// iOS Safari has no Vibration API, but toggling a native <input type="checkbox" switch> (iOS 18+)
// plays the system haptic. Must be called from a user gesture.
let label = null;

export function haptic() {
  if (!state.settings.haptics) return;
  try {
    if (!label) {
      label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-200px;top:-200px;width:1px;height:1px;opacity:0;pointer-events:none;';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
    }
    label.click();
  } catch { /* ignore */ }
  try { navigator.vibrate?.(8); } catch { /* ignore */ }
}
