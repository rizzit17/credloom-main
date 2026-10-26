"use client";
import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Loader2, AlertTriangle, Inbox } from 'lucide-react';
import { shortAddr, scoreBand } from '@/lib/format';

export const cx = (...c) => c.filter(Boolean).join(' ');

export function Card({ title, subtitle, action, children, className, pad = true }) {
  return (
    <section className={cx('min-w-0 rounded-2xl border border-zinc-800 bg-zinc-950/80', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            {title && <h2 className="text-base font-semibold text-white">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-zinc-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone = 'default' }) {
  const tones = { default: 'text-white', good: 'text-emerald-300', bad: 'text-red-300', warn: 'text-amber-300', info: 'text-blue-300' };
  return (
    <div className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-400">
        <span>{label}</span>
        {Icon && <Icon className="h-4 w-4 text-zinc-500" aria-hidden />}
      </div>
      <div className={cx('mt-2 text-2xl font-semibold tabular-nums', tones[tone])}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function Badge({ children, className }) {
  return <span className={cx('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', className || 'border-zinc-700 text-zinc-300')}>{children}</span>;
}

const BTN = {
  primary: 'bg-white text-black hover:bg-zinc-200',
  secondary: 'border border-zinc-700 text-white hover:bg-zinc-900',
  danger: 'bg-red-500/90 text-white hover:bg-red-500',
  ghost: 'text-zinc-300 hover:text-white hover:bg-zinc-900',
};
export function Btn({ variant = 'primary', loading, className, children, href, size = 'md', ...p }) {
  const cls = cx(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5 text-sm',
    BTN[variant], className
  );
  if (href) return <Link href={href} className={cls} {...p}>{children}</Link>;
  return (
    <button className={cls} disabled={loading || p.disabled} {...p}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-zinc-400" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> <span>{label}…</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex-1">{error.message || String(error)}</div>
      {onRetry && <button onClick={onRetry} className="underline">Retry</button>}
    </div>
  );
}

export function Empty({ title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Inbox className="h-8 w-8 text-zinc-600" aria-hidden />
      <p className="font-medium text-zinc-300">{title}</p>
      {hint && <p className="max-w-sm text-sm text-zinc-500">{hint}</p>}
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-zinc-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Address({ value, className, chars = 6 }) {
  const [done, setDone] = useState(false);
  if (!value) return <span className="text-zinc-500">—</span>;
  return (
    <button
      type="button"
      title={`${value} (click to copy)`}
      onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className={cx('inline-flex items-center gap-1.5 font-mono text-xs text-zinc-300 hover:text-white', className)}
    >
      {shortAddr(value, chars)} {done ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 opacity-50" />}
    </button>
  );
}

export function TxLink({ hash, className }) {
  if (!hash) return <span className="text-zinc-500">—</span>;
  return (
    <Link href={`/explorer/tx/${hash}`} className={cx('font-mono text-xs text-blue-300 hover:underline', className)} title={hash}>
      {hash.slice(0, 10)}…{hash.slice(-6)}
    </Link>
  );
}

export function ProgressBar({ value, tone = 'bg-blue-400', label }) {
  const v = Math.min(Math.max(value, 0), 100);
  return (
    <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
      <div className={cx('h-full rounded-full transition-all duration-700', tone)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-200">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-300" role="alert">{error}</span>}
    </label>
  );
}
export const inputCls = 'w-full rounded-lg border border-zinc-700 bg-black px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400';

// ------------------------------------------------------------------ charts
export function ScoreGauge({ score = 0, size = 220 }) {
  const band = scoreBand(score);
  const r = 88, c = Math.PI * r; // half circle
  const frac = Math.min(Math.max(score / 1000, 0), 1);
  return (
    <div className="relative mx-auto" style={{ width: size, height: size / 1.7 }} role="img" aria-label={`Credit score ${score} out of 1000, ${band.label}`}>
      <svg viewBox="0 0 220 125" className="w-full">
        <path d="M22 110 A88 88 0 0 1 198 110" fill="none" stroke="#27272a" strokeWidth="16" strokeLinecap="round" />
        <path d="M22 110 A88 88 0 0 1 198 110" fill="none" stroke={band.color} strokeWidth="16" strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`} style={{ transition: 'stroke-dasharray 1s ease' }} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-4xl font-bold tabular-nums" style={{ color: band.color }}>{score}</div>
        <div className="text-xs uppercase tracking-wider text-zinc-400">{band.label} · of 1000</div>
      </div>
    </div>
  );
}

export function LineChart({ points, height = 140, color = '#60a5fa', xLabel, yFormat = (v) => v, marker }) {
  if (!points || points.length < 2) return <div className="py-8 text-center text-sm text-zinc-500">Not enough data yet</div>;
  const W = 400, H = height, pad = 24;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (x) => pad + ((x - minX) / (maxX - minX || 1)) * (W - pad * 2);
  const sy = (y) => H - pad - ((y - minY) / (maxY - minY || 1)) * (H - pad * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={xLabel || 'chart'}>
      <path d={`${d} L${sx(maxX)} ${H - pad} L${sx(minX)} ${H - pad} Z`} fill={color} opacity="0.1" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      {marker != null && marker >= minX && marker <= maxX && <line x1={sx(marker)} x2={sx(marker)} y1={pad / 2} y2={H - pad} stroke="#a1a1aa" strokeDasharray="4 3" />}
      {points.length <= 14 && points.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="3" fill={color} />)}
      <text x={pad} y={H - 6} className="fill-zinc-500" fontSize="10">{xLabel ? `${xLabel}: ${minX}` : minX}</text>
      <text x={W - pad} y={H - 6} textAnchor="end" className="fill-zinc-500" fontSize="10">{maxX}</text>
      <text x={4} y={pad - 8} className="fill-zinc-400" fontSize="10">{yFormat(maxY)}</text>
      <text x={4} y={H - pad} className="fill-zinc-400" fontSize="10">{yFormat(minY)}</text>
    </svg>
  );
}

export function BarList({ items, format = (v) => v, color = 'bg-blue-400' }) {
  const max = Math.max(...items.map((i) => i.value), 0.0001);
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex justify-between text-sm"><span className="text-zinc-300">{i.label}</span><span className="tabular-nums text-zinc-400">{format(i.value)}</span></div>
          <ProgressBar value={(i.value / max) * 100} tone={i.color || color} label={i.label} />
        </li>
      ))}
    </ul>
  );
}

export function Table({ columns, rows, empty, onRow }) {
  if (!rows?.length) return empty || <Empty title="Nothing here yet" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            {columns.map((c) => <th key={c.key} scope="col" className={cx('px-3 py-2 font-medium', c.right && 'text-right')}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} onClick={onRow ? () => onRow(r) : undefined} className={cx('border-b border-zinc-900 text-zinc-200', onRow && 'cursor-pointer hover:bg-zinc-900/60')}>
              {columns.map((c) => <td key={c.key} className={cx('px-3 py-3', c.right && 'text-right tabular-nums')}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
