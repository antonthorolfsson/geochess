'use client';

import { empireColor, type VictoryResultView } from '@empire/rules';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignModel } from '@/lib/campaign';
import { finaleSeen, finaleText, markFinaleSeen } from '@/lib/results';
import { PlayerName } from '../campaign/player-name';
import { particleField, type ParticleField } from './particles';
import { PointsCounter, usePageVisible, useReducedMotion } from './score-effects';

// The timeline, in milliseconds from the moment the ending starts. The stamp's landing (the jolt,
// the ink, the ticker tape) and the points counting up follow their animations' ends instead, so
// they keep in step with what's on screen however the browser paces it.
const EMBLEM_AT = 250;
const LABEL_AT = 450;
const STAMP_AT = 950;
const WHO_AT = 1700;
const LINE_AT = 2200;
const PLACE_AT = 2500;
const BUTTON_AT = 2900;
/** Then the results, if nobody has moved on before. */
const AUTO_MS = 8200;
/** With reduced motion, how long the ending holds still before the results. */
const STILL_MS = 6000;
const LEAVE_MS = 450;

/** Paper strips in signal amber, map-room white and gold, with the winners' own colors. */
const TAPE = ['#e3a92b', '#e4e2d8', '#f2cf73'];

/**
 * When the campaign's ending plays for the player: once it's over, the first time they're here
 * since (remembered in this browser), as soon as `ready` (no award ceremony left to play, no live
 * game, the page in front of them); and again whenever they ask.
 */
export function useFinale(model: CampaignModel, ready: boolean) {
  const { campaign } = model;
  const me = model.me.userId;
  const result = campaign.status === 'finished' ? (campaign.victory?.result ?? null) : null;
  const seen = finaleSeen(campaign.id, me);
  const [phase, setPhase] = useState<'idle' | 'playing' | 'leaving'>('idle');
  /** Each showing of the ending, so one asked for while another goes starts afresh. */
  const [play, setPlay] = useState(0);
  const start = useCallback(() => {
    setPhase('playing');
    setPlay((n) => n + 1);
  }, []);
  useEffect(() => {
    if (result && !seen && ready && phase === 'idle') start();
  }, [result, seen, ready, phase, start]);
  const campaignId = campaign.id;
  return {
    /** The result being played out, while the ending is on screen. */
    showing: phase === 'idle' ? null : result,
    play,
    /** The ending covers the room (rather than going). */
    playing: phase === 'playing',
    /** Still to play for the first time: the results wait for it. */
    pending: result !== null && !seen,
    replay: start,
    leave: useCallback(() => {
      markFinaleSeen(campaignId, me);
      setPhase('leaving');
    }, [campaignId, me]),
    done: useCallback(() => setPhase('idle'), []),
  };
}

/**
 * The end of the campaign, for one player: "Victory" stamped in signal amber over a sunburst and a
 * storm of ticker tape, or "Defeat" in grease red as the map room's colors drain away and ash
 * falls. Then the winners, their points, and where the player finished. It moves on to the
 * results by itself, or at a tap, a key or "See the results". Rendered over everything else, which
 * the campaign screen makes inert meanwhile.
 */
export function Finale({
  model,
  result,
  onLeave,
  onDone,
}: {
  model: CampaignModel;
  result: VictoryResultView;
  /** The ending starts to go: the results can come in behind it. */
  onLeave(): void;
  /** The ending is gone. */
  onDone(): void;
}) {
  const still = useReducedMotion();
  const me = model.me.userId;
  const nameOf = (id: string) => model.membersById.get(id)?.name ?? 'A player';
  const text = finaleText(result, me, nameOf);
  const victory = text.outcome === 'victory';
  const pointsOf = (id: string) => result.standings.find((s) => s.userId === id)?.points ?? 0;

  const [landed, setLanded] = useState(still);
  const [counting, setCounting] = useState(still);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stamp = useRef<HTMLHeadingElement>(null);
  const field = useRef<ParticleField | null>(null);
  /** Each part comes in at its time; with reduced motion, all at once. */
  const at = (ms: number): CSSProperties => ({ animationDelay: `${still ? 0 : ms}ms` });

  const left = useRef(false);
  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    setLeaving(true);
    onLeave();
  }, [onLeave]);
  // The latest `leave`, for the timer that moves on by itself.
  const leaveRef = useRef(leave);
  useEffect(() => {
    leaveRef.current = leave;
  });

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    const particles = !still && canvas.current ? particleField(canvas.current) : null;
    field.current = particles;
    if (particles && !victory) particles.ashfall(22, AUTO_MS);
    return () => {
      particles?.stop();
      field.current = null;
    };
    // Once: the ending plays from start to finish whatever happens to the campaign meanwhile.
  }, []);

  // It moves on by itself after a while on screen: time with the page hidden doesn't count.
  const visible = usePageVisible();
  const remaining = useRef(still ? STILL_MS : AUTO_MS);
  useEffect(() => {
    if (!visible || leaving) return;
    const started = performance.now();
    const timer = setTimeout(() => leaveRef.current(), Math.max(0, remaining.current));
    return () => {
      clearTimeout(timer);
      remaining.current -= performance.now() - started;
    };
  }, [visible, leaving]);

  /** The stamp hits the table: it jolts, the ink spreads, and for a victory the ticker tape flies. */
  const land = () => {
    setLanded(true);
    navigator.vibrate?.(victory ? [70, 50, 150] : [260]);
    const particles = field.current;
    const box = stamp.current?.getBoundingClientRect();
    if (!particles || !box) return;
    particles.inkBurst(box.left + box.width / 2, box.top + box.height / 2, victory ? '#e3a92b' : '#e2483c', 34);
    if (victory) {
      const colors = [...TAPE, ...result.winners.map((id) => empireColor(model.membersById.get(id)?.color ?? 0).hex)];
      particles.cannons(colors, 110);
      particles.tapeRain(colors, 26, 4200);
    }
  };

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(onDone, still ? 0 : LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, onDone, still]);

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={text.stamp}
      tabIndex={-1}
      className={`finale ${victory ? 'finale-victory' : 'finale-defeat'} ${leaving ? 'finale-out' : ''}`}
      onClick={leave}
      onKeyDown={(e) => {
        if (e.key === 'Escape') leave();
      }}
    >
      <div className="finale-veil" aria-hidden="true" />
      {victory && <div className="finale-rays" aria-hidden="true" />}
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" />

      <div
        className={`relative flex h-full flex-col items-center justify-center gap-3 overflow-y-auto px-4 py-16 text-center ${
          landed && !still ? 'finale-shake' : ''
        }`}
      >
        {victory && (
          <span className="finale-emblem relative mb-1 inline-flex" style={at(EMBLEM_AT)} aria-hidden="true">
            <img
              src="/icons/emblem.png"
              alt=""
              width={96}
              height={96}
              className="size-[clamp(4.5rem,14vh,6.5rem)] object-contain drop-shadow-[0_6px_18px_rgb(0_0_0/0.6)]"
            />
            {!still && <span className="finale-glint" style={at(EMBLEM_AT + 900)} />}
          </span>
        )}
        <p className="label finale-up text-paper/80" style={at(LABEL_AT)}>
          {text.label}
        </p>

        <div className="relative my-2 sm:my-4">
          <span className="finale-glow" aria-hidden="true" />
          <h2
            ref={stamp}
            className={`stamp stamp-xl relative ${victory ? '' : 'stamp-red'} ${
              still ? '' : landed ? 'finale-thud' : 'finale-stamp'
            }`}
            // The delay is the slam's: the thud comes the moment it lands.
            style={landed ? undefined : at(STAMP_AT)}
            onAnimationEnd={(e) => {
              if (e.animationName === 'finale-slam') land();
            }}
          >
            {text.stamp}
          </h2>
          {landed && !still && (
            <span className={`finale-ring ${victory ? 'text-amber' : 'text-[#e2483c]'}`} aria-hidden="true" />
          )}
        </div>

        <ul
          className="finale-up flex flex-wrap justify-center gap-x-8 gap-y-2"
          style={at(WHO_AT)}
          // Their points count up once their names are in.
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) setCounting(true);
          }}
        >
          {text.subjects.map((id) => (
            <li key={id} className="flex items-center gap-3">
              <PlayerName member={model.membersById.get(id)} you={id === me} size="lg" />
              <span className={`text-3xl font-bold ${victory ? 'text-amber' : 'text-paper'}`}>
                <PointsCounter value={counting ? pointsOf(id) : 0} delta={false} />
                <span className="ml-1 text-base font-semibold tracking-widest text-muted uppercase">VP</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="finale-up max-w-xl text-lg text-paper/90" style={at(LINE_AT)}>
          {text.line}
        </p>
        {text.place && (
          <p className="finale-up max-w-xl text-[0.95rem] text-muted" style={at(PLACE_AT)}>
            {text.place}
          </p>
        )}
        <div className="finale-up mt-4" style={at(BUTTON_AT)}>
          <button
            type="button"
            className={`btn ${victory ? 'btn-amber' : 'btn-primary'}`}
            onClick={(e) => {
              e.stopPropagation();
              leave();
            }}
          >
            See the results
          </button>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-ghost btn-sm absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 border-paper/25 bg-gunmetal/40"
        onClick={(e) => {
          e.stopPropagation();
          leave();
        }}
      >
        Skip
      </button>
      <p className="sr-only" aria-live="assertive">
        {text.summary}
      </p>
    </div>,
    document.body,
  );
}
