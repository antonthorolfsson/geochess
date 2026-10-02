'use client';

import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type RefObject } from 'react';

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

/**
 * A labelled password field with a button that shows what was typed, for phone keyboards. The
 * button sits outside the label so it stays out of the field's name.
 */
export function PasswordInput({
  label,
  hint,
  value,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type' | 'value' | 'onChange'> & {
  label: string;
  /** A line under the field, read out with it. */
  hint?: string;
  value: string;
  onChange(value: string): void;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="label block">
        {label}
      </label>
      <div className="relative">
        <input
          {...props}
          id={id}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="input pr-18"
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 min-w-14 px-3 text-sm font-bold tracking-wider text-muted uppercase hover:text-paper"
          aria-label={shown ? 'Hide password' : 'Show password'}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-faint">
          {hint}
        </p>
      )}
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
      title={`Game value ${value}`}
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-[3px] border border-line-strong px-1 text-sm font-bold tabular-nums ${className}`}
    >
      {value}
    </span>
  );
}

export interface SegmentTab<T extends string> {
  id: T;
  label: string;
  /** A count beside the label, e.g. unread messages. */
  badge?: number;
  /** Shows the count in signal amber: something needs the player. */
  alert?: boolean;
}

/** A row of tabs across the top of a panel, the current one underlined in amber. */
export function SegmentTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: SegmentTab<T>[];
  value: T;
  onChange(id: T): void;
  label: string;
}) {
  return (
    <nav className="flex shrink-0 border-b border-line" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-current={value === t.id ? 'page' : undefined}
          className={`relative flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 px-1.5 text-[0.78rem] font-bold tracking-[0.1em] uppercase ${
            value === t.id ? 'text-paper' : 'text-faint hover:text-muted'
          }`}
        >
          <span className="truncate">{t.label}</span>
          {t.badge ? (
            <span
              className={`min-w-5 shrink-0 rounded-full px-1.5 text-center text-[0.7rem] leading-5 tracking-normal tabular-nums ${
                t.alert ? 'bg-amber text-gunmetal' : 'bg-raised text-paper'
              }`}
            >
              {t.badge}
            </span>
          ) : null}
          {value === t.id && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-amber" aria-hidden="true" />}
        </button>
      ))}
    </nav>
  );
}

const glow = (alpha: number): Keyframe => ({
  boxShadow: `0 0 0 3px rgb(227 169 43 / ${alpha}), 0 0 22px 4px rgb(227 169 43 / ${alpha / 2})`,
});

/**
 * Each time `nonce` changes, brings the element into view, gives it focus (so the keyboard carries
 * on from there) and lights it up in signal amber: where a call to action sent the player. With
 * reduced motion the light holds still instead of pulsing.
 */
export function useSpotlight(ref: RefObject<HTMLElement | null>, nonce: number | null | undefined) {
  useEffect(() => {
    const el = ref.current;
    if (!nonce || !el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
    el.focus({ preventScroll: true });
    const light = el.animate(still ? [glow(1), glow(1)] : [glow(1), glow(0.2), glow(1), glow(0.2), glow(1), glow(0)], {
      duration: 2400,
      easing: 'ease-in-out',
    });
    return () => light.cancel();
  }, [ref, nonce]);
}

/** Wraps what a call to action points at; see `useSpotlight`. */
export function Spotlight({
  nonce,
  label,
  children,
}: {
  nonce: number | null | undefined;
  /** What it is, for screen readers when it takes focus. */
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useSpotlight(ref, nonce);
  return (
    <div ref={ref} tabIndex={-1} role="group" aria-label={label} className="rounded-[3px]">
      {children}
    </div>
  );
}
