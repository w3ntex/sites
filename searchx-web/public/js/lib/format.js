const compactFmt = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dayYearFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export function duration(sec) {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

export function compact(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return compactFmt.format(n);
}

export function time(ts) {
  return timeFmt.format(new Date(ts));
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  const label = d.getFullYear() === today.getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function watched(sec) {
  if (!sec || sec < 1) return '';
  if (sec < 60) return `${Math.round(sec)} s`;
  return `${Math.round(sec / 60)} min`;
}

export function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}
