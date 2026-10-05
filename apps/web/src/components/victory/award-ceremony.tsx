'use client';

import { TITLES, missionName, type TitleKind } from '@empire/rules';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { CampaignModel } from '@/lib/campaign';
import {
  awardKey,
  ceremoniesFrom,
  ceremonyLabel,
  ceremonySummary,
  markFresh,
  moveText,
  rankByPoints,
  standingsOf,
  titleKey,
  type Ceremony,
  type MissionCeremony,
  type Standings,
  type TitlesCeremony,
} from '@/lib/ceremony';
import { useServerMessages } from '@/lib/realtime';
import { findMission, requirementText } from '@/lib/victory';
import { PlayerName } from '../campaign/player-name';
import { EmpireSwatch } from '../hatch';
import { PointsBadge } from './mission-card';
import { PointsCounter, ScoredStamp, useReducedMotion } from './score-effects';
import { TitleToken } from './title-tokens';

/** Ceremonies waiting beyond this many give way, oldest first: the standings have their result. */
const MAX_WAITING = 4;
/** How long a scored mission's stamp, or a won title's token, makes an entrance elsewhere. */
const FRESH_AWARD_MS = 3 * 60_000;
const FRESH_TITLE_MS = 20_000;

// The timeline, in milliseconds from the card's appearance.
/** The first title leaves its holder. */
const LIFT_AT = 700;
/** Between titles that move in the same change. */
const STAGGER = 450;
const FLIGHT_MS = 1100;
/** The stamp comes down once the mission card has been dealt. */
const STAMP_AT = 850;
/** The points leave the mission card for the player's row. */
const CHIP_AT = 1400;
const CHIP_MS = 800;
/** The result stays this long before the card goes. */
const READ_MS = 2600;
/** With reduced motion, how long the result shows. */
const STILL_MS = 4500;
const LEAVE_MS = 240;

/** A token in a leaderboard row, beside a title's name, and the flying coin (drawn large to stay sharp). */
const TOKEN = 18;
const EMBLEM = 30;
const COIN = 44;

/**
 * Award ceremonies, for everyone in the campaign: whenever points move, a card over the map room
 * plays it out. A title's token is tossed from its old holder's row to the new holder's (or from
 * the table, or back to it); a scored mission's card is dealt, stamped, and its points thrown into
 * the player's row. Totals count up or down and the rows re-sort. One at a time; they wait while the
 * viewer is in a live game, or away from the page.
 */
export function AwardCeremonies({ model, hold }: { model: CampaignModel; hold: boolean }) {
  const [queue, setQueue] = useCeremonies(model);
  const visible = useSyncExternalStore(
    (onChange) => {
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
    () => document.visibilityState === 'visible',
    () => true,
  );
  const [playing, setPlaying] = useState<Ceremony | null>(null);
  useEffect(() => {
    if (playing || hold || !visible || queue.length === 0) return;
    setPlaying(queue[0]!);
    setQueue((q) => q.slice(1));
  }, [playing, hold, visible, queue, setQueue]);
  const done = useCallback(() => setPlaying(null), []);
  if (!playing) return null;
  return <CeremonyCard key={playing.id} model={model} ceremony={playing} onDone={done} />;
}

/** The ceremonies waiting to play, from the events the server pushes. */
function useCeremonies(model: CampaignModel): [Ceremony[], Dispatch<SetStateAction<Ceremony[]>>] {
  const [queue, setQueue] = useState<Ceremony[]>([]);
  const modelRef = useRef(model);
  useEffect(() => {
    modelRef.current = model;
  });
  // The standings the next change starts from: the campaign view's, unless events have come in
  // that the view doesn't have yet (two changes in quick succession).
  const known = useRef<{ eventId: number; standings: Standings } | null>(null);
  const latest = model.campaign.events.at(-1)?.id ?? 0;
  useEffect(() => {
    if (!known.current || latest >= known.current.eventId) {
      known.current = { eventId: latest, standings: standingsOf(model) };
    }
  }, [model, latest]);
  useServerMessages((message) => {
    const current = modelRef.current;
    if (message.type !== 'campaign.events' || message.campaignId !== current.campaign.id) return;
    if (!current.campaign.victory) return;
    const { ceremonies, end } = ceremoniesFrom(
      message.events,
      known.current?.standings ?? standingsOf(current),
      (userId, key) => findMission(current, userId, key)?.mission.spec ?? null,
    );
    const last = message.events.at(-1);
    if (last) known.current = { eventId: last.id, standings: end };
    if (ceremonies.length === 0) return;
    for (const c of ceremonies) {
      if (c.kind === 'mission') markFresh(awardKey(current.campaign.id, c.userId, c.missionKey), FRESH_AWARD_MS);
      else for (const m of c.moves) if (m.to) markFresh(titleKey(m.title, m.to), FRESH_TITLE_MS);
    }
    setQueue((q) => [...q, ...ceremonies].slice(-MAX_WAITING));
  });
  return [queue, setQueue];
}

type Flash = { tone: 'gain' | 'loss'; nonce: number };

function CeremonyCard({ model, ceremony, onDone }: { model: CampaignModel; ceremony: Ceremony; onDone(): void }) {
  const still = useReducedMotion();
  const me = model.me.userId;
  const victory = model.campaign.victory;
  const nameOf = (id: string) => model.membersById.get(id)?.name ?? 'A player';
  const players = Object.keys(ceremony.before.points).filter((id) => model.membersById.has(id));
  const kinds = victory?.titles.map((t) => t.kind) ?? [];

  // What the leaderboard shows, from the standings before the ceremony to those after it.
  const [shown, setShown] = useState<Standings>(() => (still ? ceremony.after : ceremony.before));
  const [order, setOrder] = useState(() => rankByPoints((still ? ceremony.after : ceremony.before).points, nameOf));
  const [startOrder] = useState(order);
  /** Titles in the air, on nobody's row. */
  const [aloft, setAloft] = useState<ReadonlySet<TitleKind>>(new Set());
  /** Titles that have landed, which settle into their row. */
  const [landed, setLanded] = useState<ReadonlySet<TitleKind>>(new Set());
  const [flashes, setFlashes] = useState<Record<string, Flash>>({});
  const [stamped, setStamped] = useState(still);
  const [leaving, setLeaving] = useState(false);

  const layer = useRef<HTMLDivElement>(null);
  /** Where things fly from and to: a row's token slots and points, a title's emblem, the card's points. */
  const anchors = useRef(new Map<string, HTMLElement>());
  const anchor = (key: string) => (el: HTMLElement | null) => {
    if (el) anchors.current.set(key, el);
  };

  // The ceremony's timeline. It plays once: each ceremony has a card of its own.
  useEffect(() => {
    const timers: number[] = [];
    const flights: Animation[] = [];
    let on = true;
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => on && fn(), ms));
    const point = (key: string) => {
      const el = anchors.current.get(key);
      return el && layer.current ? centerOf(el, layer.current) : null;
    };
    const flash = (userId: string, tone: Flash['tone']) =>
      setFlashes((f) => ({ ...f, [userId]: { tone, nonce: (f[userId]?.nonce ?? 0) + 1 } }));
    const rank = () => setOrder(rankByPoints(ceremony.after.points, nameOf));

    if ((ceremony.after.points[me] ?? 0) > (ceremony.before.points[me] ?? 0)) navigator.vibrate?.(120);
    if (still) {
      at(STILL_MS, () => setLeaving(true));
    } else if (ceremony.kind === 'titles') {
      ceremony.moves.forEach((move, i) =>
        at(LIFT_AT + i * STAGGER, () => {
          const emblem = `emblem:${move.title}`;
          const from = point(move.from ? `slot:${move.from}:${move.title}` : emblem);
          const to = point(move.to ? `slot:${move.to}:${move.title}` : emblem);
          const land = () => {
            if (!on) return;
            setAloft((a) => without(a, move.title));
            setLanded((l) => new Set(l).add(move.title));
            setShown((s) => ({
              points: { ...s.points, ...move.after },
              holders: { ...s.holders, [move.title]: move.to },
            }));
            if (move.from) flash(move.from, 'loss');
            if (move.to) flash(move.to, 'gain');
            if (move.to && to && layer.current) sparkle(layer.current, to);
          };
          if (!from || !to || !layer.current) return land();
          setAloft((a) => new Set(a).add(move.title));
          const coin = coinFor(layer.current, move.title);
          const flight = toss(coin, from, to, {
            duration: FLIGHT_MS,
            scale: [(move.from ? TOKEN : EMBLEM) / COIN, (move.to ? TOKEN : EMBLEM) / COIN],
            grow: 0.55,
            spin: 720,
            fade: move.to === null,
          });
          flights.push(flight);
          flight.finished.then(
            () => {
              coin.remove();
              land();
            },
            () => coin.remove(),
          );
        }),
      );
      const lastLanding = LIFT_AT + (ceremony.moves.length - 1) * STAGGER + FLIGHT_MS;
      at(lastLanding + 300, rank);
      at(lastLanding + READ_MS, () => setLeaving(true));
    } else {
      const { userId } = ceremony;
      at(STAMP_AT, () => setStamped(true));
      at(CHIP_AT, () => {
        const from = point('badge');
        const to = point(`points:${userId}`);
        const land = () => {
          if (!on) return;
          setShown(ceremony.after);
          flash(userId, 'gain');
          if (to && layer.current) sparkle(layer.current, to);
        };
        if (!from || !to || !layer.current) return land();
        const chip = chipFor(layer.current, `+${ceremony.points}`);
        const flight = toss(chip, from, to, { duration: CHIP_MS, scale: [1, 0.7], grow: 0.45, spin: 0, fade: true });
        flights.push(flight);
        flight.finished.then(
          () => {
            chip.remove();
            land();
          },
          () => chip.remove(),
        );
      });
      at(CHIP_AT + CHIP_MS + 300, rank);
      at(CHIP_AT + CHIP_MS + READ_MS, () => setLeaving(true));
    }
    return () => {
      on = false;
      timers.forEach(clearTimeout);
      flights.forEach((f) => f.cancel());
    };
    // Once per card: the ceremony and the viewer don't change while it plays.
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(onDone, still ? 0 : LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, onDone, still]);

  const rowH = players.length > 5 ? 28 : 34;
  const version = victory?.version ?? 1;
  return (
    <section
      role="status"
      onClick={() => setLeaving(true)}
      className={`pointer-events-auto relative w-[min(24rem,calc(100vw-1.5rem))] cursor-pointer rounded-[4px] border border-amber/55 bg-panel/95 shadow-[0_14px_44px_rgb(0_0_0/0.55)] backdrop-blur ${
        leaving ? 'ceremony-out' : 'ceremony-in'
      }`}
    >
      <p className="sr-only">{ceremonySummary(ceremony, nameOf, me, version)}</p>
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute top-0 right-0 z-20 flex size-11 items-center justify-center text-muted hover:text-paper"
        onClick={(e) => {
          e.stopPropagation();
          setLeaving(true);
        }}
      >
        ✕
      </button>
      <div aria-hidden="true">
        <h2 className="label flex min-h-11 items-center pr-11 pl-3 text-amber">{ceremonyLabel(ceremony)}</h2>
        {ceremony.kind === 'titles' ? (
          <TitleMoves model={model} ceremony={ceremony} anchor={anchor} />
        ) : (
          <ScoredCard model={model} ceremony={ceremony} stamped={stamped} still={still} anchor={anchor} />
        )}
        <ol className="relative mx-3 mb-3 border-t border-line" style={{ height: players.length * rowH }}>
          {players.map((userId) => {
            const member = model.membersById.get(userId)!;
            const flash = flashes[userId];
            const delta = (ceremony.after.points[userId] ?? 0) - (ceremony.before.points[userId] ?? 0);
            return (
              <li
                key={userId}
                // Opaque, and a player moving up passes over the rest, so rows don't print through each other.
                className="absolute inset-x-0 flex items-center gap-2 border-b border-line bg-panel px-2 transition-[top] duration-500 ease-out"
                style={{
                  top: Math.max(0, order.indexOf(userId)) * rowH,
                  height: rowH,
                  zIndex: order.indexOf(userId) < startOrder.indexOf(userId) ? 2 : 1,
                }}
              >
                {flash && (
                  <span
                    key={flash.nonce}
                    className={`absolute inset-0 ${flash.tone === 'gain' ? 'flash-gain' : 'flash-loss'}`}
                  />
                )}
                {still && delta !== 0 && (
                  <span className={`absolute inset-0 ${delta > 0 ? 'bg-amber/10' : 'bg-grease/15'}`} />
                )}
                <EmpireSwatch color={member.color} size={14} className="relative shrink-0" />
                <span className="relative min-w-0 flex-1 truncate font-stencil tracking-wide">{member.name}</span>
                {userId === me && (
                  <span className="relative shrink-0 text-xs font-bold tracking-widest text-muted uppercase">you</span>
                )}
                <span className="relative flex shrink-0 gap-1">
                  {kinds.map((kind) => (
                    <span
                      key={kind}
                      ref={anchor(`slot:${userId}:${kind}`)}
                      className="flex items-center justify-center"
                      style={{ width: TOKEN, height: TOKEN }}
                    >
                      {shown.holders[kind] === userId && !aloft.has(kind) && (
                        <span className={`inline-flex ${landed.has(kind) ? 'token-land' : ''}`}>
                          <TitleToken kind={kind} size={TOKEN} label={false} />
                        </span>
                      )}
                    </span>
                  ))}
                </span>
                {still && delta !== 0 && (
                  <span className={`relative text-sm font-bold ${delta > 0 ? 'text-amber' : 'text-[#ef7b72]'}`}>
                    {delta > 0 ? `+${delta}` : `−${-delta}`}
                  </span>
                )}
                <span className="relative w-8 shrink-0 text-right text-lg font-bold">
                  <span ref={anchor(`points:${userId}`)} className="inline-block">
                    <PointsCounter value={shown.points[userId] ?? 0} />
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <div ref={layer} aria-hidden="true" className="pointer-events-none absolute inset-0 z-10" />
    </section>
  );
}

type AnchorRef = (key: string) => (el: HTMLElement | null) => void;

/** The titles moving, one line each under its emblem: where a coin comes from the table, or goes back to it. */
function TitleMoves({
  model,
  ceremony,
  anchor,
}: {
  model: CampaignModel;
  ceremony: TitlesCeremony;
  anchor: AnchorRef;
}) {
  const nameOf = (id: string) => model.membersById.get(id)?.name ?? 'A player';
  return (
    <ul className="space-y-2 px-3 pb-3">
      {ceremony.moves.map((m) => (
        <li key={m.title} className="flex items-center gap-2.5">
          <span ref={anchor(`emblem:${m.title}`)} className="inline-flex shrink-0">
            <TitleToken kind={m.title} size={EMBLEM} label={false} />
          </span>
          <span className="min-w-0">
            <span className="block font-stencil text-lg leading-tight tracking-wide">{TITLES[m.title].name}</span>
            <span className="block text-sm text-muted">{moveText(m, nameOf, model.me.userId)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The mission scored, as a card dealt onto the table and stamped. */
function ScoredCard({
  model,
  ceremony,
  stamped,
  still,
  anchor,
}: {
  model: CampaignModel;
  ceremony: MissionCeremony;
  stamped: boolean;
  still: boolean;
  anchor: AnchorRef;
}) {
  const version = model.campaign.rules.victory.version;
  const name = ceremony.spec ? missionName(ceremony.spec) : missionName({ kind: ceremony.missionKind }, version);
  return (
    <div className="px-3 pb-3">
      <article
        className={`relative rounded-[3px] border border-line-strong bg-gunmetal/80 p-3 shadow-lg ${
          stamped && !still ? 'card-thud' : 'card-deal'
        }`}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <PlayerName
              member={model.membersById.get(ceremony.userId)}
              you={ceremony.userId === model.me.userId}
              size="sm"
              showTitles={false}
            />
            <h3 className="mt-1 font-stencil text-xl leading-tight tracking-wide">{name}</h3>
            <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
              {ceremony.scope === 'secret' ? 'Secret mission' : 'Public mission'}
            </p>
          </div>
          <span ref={anchor('badge')} className="inline-flex">
            <PointsBadge points={ceremony.points} />
          </span>
        </div>
        {ceremony.spec && (
          <p className="mt-2 line-clamp-3 pr-6 text-[0.9rem] leading-snug text-paper/85">
            {requirementText(model, ceremony.spec)}
          </p>
        )}
        {/* Across the corner under the points, clear of the requirement below. */}
        {stamped && <ScoredStamp size="lg" fresh={!still} className="absolute top-11 right-3" />}
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Things thrown across the card. Each is drawn on the card's top layer, centred on its top-left
// corner, and moved with transforms from there.

interface Point {
  x: number;
  y: number;
}

function centerOf(el: Element, box: Element): Point {
  const a = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  return { x: a.left + a.width / 2 - b.left, y: a.top + a.height / 2 - b.top };
}

const without = <T,>(set: ReadonlySet<T>, item: T) => {
  const next = new Set(set);
  next.delete(item);
  return next;
};

/** A title's coin, drawn large and scaled down, so it stays sharp at the top of its arc. */
function coinFor(layer: HTMLElement, kind: TitleKind): HTMLElement {
  const img = document.createElement('img');
  img.src = `/titles/${kind}.webp`;
  img.alt = '';
  img.width = img.height = COIN;
  img.className = 'absolute top-0 left-0 max-w-none';
  img.style.margin = `${-COIN / 2}px 0 0 ${-COIN / 2}px`;
  layer.append(img);
  return img;
}

/** The points a mission scores, as an amber chip like its badge. */
function chipFor(layer: HTMLElement, text: string): HTMLElement {
  const chip = document.createElement('span');
  chip.textContent = text;
  chip.className =
    'absolute top-0 left-0 rounded-[3px] bg-amber px-1.5 text-lg font-bold whitespace-nowrap text-gunmetal tabular-nums shadow-lg';
  layer.append(chip);
  chip.style.margin = `${-chip.offsetHeight / 2}px 0 0 ${-chip.offsetWidth / 2}px`;
  return chip;
}

/**
 * Throws `el` from one point to another along an arc, growing towards the top of it, its shadow
 * dropping away; with `spin`, turning over like a tossed coin. A throw up or down a column of the
 * leaderboard swings out over the names on its way.
 */
function toss(
  el: HTMLElement,
  from: Point,
  to: Point,
  o: { duration: number; scale: [number, number]; grow: number; spin: number; fade: boolean },
): Animation {
  const reach = Math.hypot(to.x - from.x, to.y - from.y);
  const across = Math.min(1, Math.abs(to.x - from.x) / 120);
  const control = {
    x: (from.x + to.x) / 2 - Math.min(80, reach * 0.4) * (1 - across),
    y: Math.min(from.y, to.y) - Math.max(44, reach * 0.55),
  };
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x;
    const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y;
    const lift = Math.sin(Math.PI * t);
    const scale = o.scale[0] + (o.scale[1] - o.scale[0]) * t + o.grow * lift;
    frames.push({
      offset: t,
      transform: `translate(${x}px, ${y}px) perspective(500px) rotateY(${o.spin * t}deg) scale(${scale})`,
      filter: `drop-shadow(0 ${2 + 10 * lift}px ${2 + 5 * lift}px rgb(0 0 0 / 0.45))`,
      opacity: o.fade ? Math.min(1, (1 - t) * 5) : 1,
    });
  }
  return el.animate(frames, { duration: o.duration, easing: 'cubic-bezier(0.45, 0.05, 0.4, 1)', fill: 'forwards' });
}

/** A ring and a burst of sparks where something lands. */
function sparkle(layer: HTMLElement, at: Point): void {
  const parts: [HTMLElement, Keyframe[], number][] = [];
  const ring = document.createElement('span');
  ring.className = 'absolute top-0 left-0 -mt-4 -ml-4 size-8 rounded-full border-2 border-amber';
  parts.push([
    ring,
    [
      { transform: `translate(${at.x}px, ${at.y}px) scale(0.4)`, opacity: 1 },
      { transform: `translate(${at.x}px, ${at.y}px) scale(1.9)`, opacity: 0 },
    ],
    600,
  ]);
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + 0.25;
    const reach = 18 + (i % 3) * 7;
    const spark = document.createElement('span');
    spark.className = `absolute top-0 left-0 -mt-0.5 -ml-0.5 size-1 rounded-full ${i % 2 ? 'bg-paper' : 'bg-amber'}`;
    parts.push([
      spark,
      [
        { transform: `translate(${at.x}px, ${at.y}px)`, opacity: 1 },
        {
          transform: `translate(${at.x + reach * Math.cos(angle)}px, ${at.y + reach * Math.sin(angle)}px) scale(0.4)`,
          opacity: 0,
        },
      ],
      520 + (i % 3) * 80,
    ]);
  }
  for (const [el, frames, duration] of parts) {
    layer.append(el);
    el.animate(frames, { duration, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)', fill: 'forwards' }).finished.then(
      () => el.remove(),
      () => el.remove(),
    );
  }
}
