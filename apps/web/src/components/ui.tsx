'use client';

import type { ReactNode } from 'react';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <span
        className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-amber"
        aria-hidden="true"
      />
      <span className="text-sm">{label}…</span>
    </span>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'amber'; children: ReactNode }) {
  const styles = {
    info: 'border-line-strong bg-raised/60 text-paper',
    error: 'border-grease/60 bg-grease/10 text-[#f19a92]',
    amber: 'border-amber/60 bg-amber/10 text-amber',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-[3px] border px-3 py-2 text-[0.95rem] ${styles}`}
    >
      {children}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <span className="flex-1">
        <span className="block font-semibold">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full border border-line-strong bg-gunmetal transition-colors peer-checked:border-amber peer-checked:bg-amber/25 peer-focus-visible:outline-2 peer-focus-visible:outline-amber after:absolute after:top-0.5 after:left-0.5 after:size-4.5 after:rounded-full after:bg-muted after:transition-transform peer-checked:after:translate-x-5 peer-checked:after:bg-amber"
      />
    </label>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
      {note && <div className="text-xs text-faint">{note}</div>}
    </div>
  );
}

/** The value of a country as a small stamped figure. */
export function ValueBadge({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span
      title={`Game value ${value} of 10`}
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-[3px] border border-line-strong px-1 text-sm font-bold tabular-nums ${className}`}
    >
      {value}
    </span>
  );
}
