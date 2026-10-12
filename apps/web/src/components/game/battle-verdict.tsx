'use client';

import { empireColor } from '@empire/rules';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CampaignModel } from '@/lib/campaign';
import type { Verdict } from '@/lib/verdict';
import { PlayerName } from '../campaign/player-name';
import { HATCH_INK, HatchTile, patternRotation, svgId } from '../hatch';
import { particleField, type ParticleField } from '../victory/particles';
import { usePageVisible, useReducedMotion } from '../victory/score-effects';

/** How long the verdict stays over the board (time with the page hidden doesn't count), and its exit. */
const HOLD_MS = 4600;
const STILL_MS = 4000;
const LEAVE_MS = 350;
const STAMP_INK = { won: '#e3a92b', lost: '#e2483c', drawn: '#e4e2d8' } as const;

/**
 * A game's ending, played over its board as it happens: the board dims and the winner's color, as
 * their empire wears it on the map, sweeps across it from their side; then the verdict comes in,
 * "Victory" or "Defeat" stamped for the two players (with a puff of ink as it lands), the winner
 * named for anyone else, how it ended and what it means for the war. It goes by itself after a few
 * seconds, or at a tap, leaving the final position to look at.
 */
export function BattleVerdict({
  model,
  verdict,
  label,
  from,
  onDone,
}: {
  model: CampaignModel;
  verdict: Verdict;
  /** What the battle was for: "Battle for Libya". */
  label: string;
  /** The board's edge on the winner's side, which their color sweeps in from. */
  from: 'top' | 'bottom';
  onDone(): void;
}) {
  const still = useReducedMotion();
  const winner = verdict.winnerId ? model.membersById.get(verdict.winnerId) : undefined;
  const color = winner ? empireColor(winner.color) : null;
  const pattern = svgId(useId());
  const [leaving, setLeaving] = useState(false);
  const [landed, setLanded] = useState(still);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stamp = useRef<HTMLSpanElement>(null);
  const field = useRef<ParticleField | null>(null);

  useEffect(() => {
    const particles = !still && canvas.current ? particleField(canvas.current) : null;
    field.current = particles;
    return () => {
      particles?.stop();
      field.current = null;
    };
    // Once: the verdict plays out as it began.
  }, []);

  const leave = useCallback(() => setLeaving(true), []);
  // It goes by itself after a while on screen: time with the page hidden doesn't count.
  const visible = usePageVisible();
  const remaining = useRef(still ? STILL_MS : HOLD_MS);
  useEffect(() => {
    if (!visible || leaving) return;
    const started = performance.now();
    const timer = setTimeout(leave, Math.max(0, remaining.current));
    return () => {
      clearTimeout(timer);
      remaining.current -= performance.now() - started;
    };
  }, [visible, leaving, leave]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(onDone, still ? 0 : LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, onDone, still]);

  /** The stamp hits the board: the ink spreads, and the player feels it. */
  const land = () => {
    setLanded(true);
    if (verdict.mine === 'won') navigator.vibrate?.([60, 40, 120]);
    else if (verdict.mine === 'lost') navigator.vibrate?.(220);
    const box = stamp.current?.getBoundingClientRect();
    const area = canvas.current?.getBoundingClientRect();
    if (!field.current || !box || !area || !verdict.mine) return;
    field.current.inkBurst(
      box.left - area.left + box.width / 2,
      box.top - area.top + box.height / 2,
      STAMP_INK[verdict.mine],
      22,
    );
  };

  const tone = verdict.mine === 'lost' ? 'stamp-red' : verdict.mine === 'drawn' ? 'stamp-quiet' : '';
  return (
    <div
      className={`verdict absolute inset-0 z-10 overflow-hidden rounded-[2px] ${leaving ? 'verdict-out' : ''}`}
      onClick={leave}
    >
      <div className="verdict-veil absolute inset-0" aria-hidden="true" />
      {color && (
        // The winner's color and hatching, as on the map, sweeping over the board from their side.
        <svg className={`verdict-wash verdict-from-${from} absolute inset-0 size-full`} aria-hidden="true">
          <defs>
            <pattern
              id={pattern}
              width={9}
              height={9}
              patternUnits="userSpaceOnUse"
              patternTransform={`rotate(${patternRotation(color.pattern)})`}
            >
              <HatchTile pattern={color.pattern} size={9} ink={HATCH_INK} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={color.hex} />
          <rect width="100%" height="100%" fill={`url(#${pattern})`} />
        </svg>
      )}
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" />

      <div className="relative flex h-full items-center justify-center p-3">
        <div className="verdict-card flex max-w-full flex-col items-center gap-2 rounded-[3px] border border-line-strong bg-gunmetal/92 px-5 py-4 text-center shadow-2xl">
          {color && (
            <span
              className="verdict-band -mx-5 -mt-4 mb-1 h-1.5 self-stretch rounded-t-[3px]"
              style={{ background: color.hex }}
              aria-hidden="true"
            />
          )}
          <p className="label">{label}</p>
          {verdict.stamp ? (
            <div className="relative">
              <span
                ref={stamp}
                className={`stamp stamp-lg ${tone} ${still ? '' : landed ? 'verdict-thud' : 'verdict-stamp'}`}
                onAnimationEnd={(e) => {
                  if (e.animationName === 'stamp-slam') land();
                }}
              >
                {verdict.stamp}
              </span>
              {landed && !still && (
                <span
                  className="verdict-ring"
                  style={{ color: STAMP_INK[verdict.mine ?? 'drawn'] }}
                  aria-hidden="true"
                />
              )}
            </div>
          ) : winner ? (
            <p className="verdict-up flex max-w-full items-center gap-2 font-stencil text-2xl tracking-wide">
              <PlayerName member={winner} size="lg" showTitles={false} />
              <span className="shrink-0">wins</span>
            </p>
          ) : (
            <p className="verdict-up font-stencil text-3xl tracking-[0.12em] uppercase">Draw</p>
          )}
          <p
            className="verdict-up max-w-[22rem] text-[0.95rem] leading-snug text-paper/90"
            style={{ animationDelay: '750ms' }}
          >
            {verdict.how}
            {verdict.spoils && (
              <>
                {verdict.how && <span className="text-muted"> · </span>}
                <strong className="font-semibold text-paper">{verdict.spoils}</strong>
              </>
            )}
          </p>
        </div>
      </div>
      <p className="sr-only" aria-live="assertive">
        {verdict.summary}
      </p>
    </div>
  );
}
