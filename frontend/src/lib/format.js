export const shortAddr = (a, n = 6) => (a ? `${a.slice(0, n)}…${a.slice(-4)}` : '—');
export const shortHash = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—');

export function eth(v, digits = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0 ETH';
  return `${n.toLocaleString(undefined, { maximumFractionDigits: digits })} ETH`;
}

export const pct = (bps) => `${(Number(bps) / 100).toFixed(2)}%`;

/** Accepts unix seconds, ISO strings (with or without Z) and SQLite "YYYY-MM-DD HH:MM:SS" (UTC). */
export function toDate(ts) {
  if (ts == null || ts === '') return null;
  if (typeof ts === 'number') return new Date(ts * 1000);
  let s = String(ts).trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function when(ts) {
  const d = toDate(ts);
  return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function ago(ts) {
  const dt = toDate(ts);
  if (!dt) return '—';
  const s = Math.max(Math.floor((Date.now() - dt.getTime()) / 1000), 0);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function duration(seconds) {
  const s = Math.max(Math.floor(seconds), 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const scoreBand = (s) =>
  s >= 750 ? { label: 'Excellent', color: '#34d399' }
  : s >= 650 ? { label: 'Good', color: '#60a5fa' }
  : s >= 550 ? { label: 'Fair', color: '#fbbf24' }
  : { label: 'Poor', color: '#f87171' };

export const stateStyle = {
  active: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  FUNDED: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  repaid: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  REPAID: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  defaulted: 'bg-red-500/10 text-red-300 border-red-500/30',
  DEFAULTED: 'bg-red-500/10 text-red-300 border-red-500/30',
};
