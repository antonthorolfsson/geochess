'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { isFresh } from '@/lib/ceremony';
import { useMediaQuery } from '@/lib/use-media-query';

/** Whether the player asked for less motion: animations then hold still or skip to their end. */
export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/**
 * Slides a list's rows to their new places when their order changes, so a player overtaking
 * another is seen to. Rows carry `data-key`; `order` is their keys in order. The list should be
 * positioned, since rows are measured from it.
 */
export function useReorderSlide(list: RefObject<HTMLElement | null>, order: string): void {
  const places = useRef<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const rows = [...el.children].filter((row): row is HTMLElement => row instanceof HTMLElement && !!row.dataset.key);
    const now = new Map(rows.map((row) => [row.dataset.key!, row.offsetTop]));
    const before = places.current;
    places.current = now;
    if (!before || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const row of rows) {
      const was = before.get(row.dataset.key!);
      const is = now.get(row.dataset.key!)!;
      if (was === undefined || was === is) continue;
      row.animate([{ transform: `translateY(${was - is}px)` }, { transform: 'none' }], {
        duration: 500,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      });
    }
  }, [list, order]);
}

/**
 * Whether what `key` names was just won (`markFresh`) when this first drew it, so a stamp or a
 * token makes its entrance once, not every time it's drawn.
 */
export function useFresh(key: string | null): boolean {
  const [fresh] = useState(() => key !== null && isFresh(key));
  return fresh;
}

/** How long each point takes as a total counts up or down. */
const STEP_MS = 170;
/** How long a change stays marked: the step's pop, then the "+2" floating away. */
const CHANGE_MS = 1500;

/**
 * Victory points that count to a new total a point at a time, each step popping, with the change
 * floating off beside them (`delta`): "+2" in amber, "−1" in grease red. With reduced motion the
 * total just changes.
 */
export function PointsCounter({
  value,
  delta = true,
  className = '',
}: {
  value: number;
  /** Whether the change floats off to the left of the total; off where something else shows it. */
  delta?: boolean;
  className?: string;
}) {
  const still = useReducedMotion();
  const [shown, setShown] = useState(value);
  const [last, setLast] = useState(value);
  const [change, setChange] = useState<{ delta: number; nonce: number } | null>(null);
  // A new total: note the change while drawing it, rather than a frame later.
  if (value !== last) {
    setLast(value);
    setChange({ delta: value - last, nonce: (change?.nonce ?? 0) + 1 });
  }
  useEffect(() => {
    if (shown === value || still) return;
    const timer = setTimeout(() => setShown((s) => s + Math.sign(value - s)), STEP_MS);
    return () => clearTimeout(timer);
  }, [shown, value, still]);
  const nonce = change?.nonce;
  useEffect(() => {
    if (nonce === undefined) return;
    const timer = setTimeout(() => setChange(null), CHANGE_MS + STEP_MS * 3);
    return () => clearTimeout(timer);
  }, [nonce]);
  const display = still ? value : shown;
  const gain = (change?.delta ?? 0) > 0;
  return (
    <span className={`relative inline-block tabular-nums ${className}`}>
      <span
        // A new element for every step, so each one pops.
        key={`n${display}`}
        className={`inline-block ${change ? `points-pop ${gain ? 'text-amber' : 'text-[#ef7b72]'}` : ''}`}
      >
        {display}
      </span>
      {change && delta && (
        <span
          key={`d${change.nonce}`}
          aria-hidden="true"
          className={`delta-rise pointer-events-none absolute top-1/2 right-full z-10 mr-1.5 text-sm font-bold whitespace-nowrap ${
            gain ? 'text-amber' : 'text-[#ef7b72]'
          }`}
        >
          {gain ? `+${change.delta}` : `−${-change.delta}`}
        </span>
      )}
    </span>
  );
}

/**
 * "Scored", stamped on a mission card like on a briefing document; coming down hard when `fresh`.
 * Small sits in a card's header, large across the card of an award ceremony.
 */
export function ScoredStamp({
  fresh = false,
  size = 'sm',
  className = '',
}: {
  fresh?: boolean;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  return (
    <span className={`stamp ${size === 'lg' ? 'stamp-lg' : 'stamp-sm'} ${fresh ? 'stamp-slam' : ''} ${className}`}>
      Scored
    </span>
  );
}
