'use client';

import { TITLES, empireColor, missionName, type CampaignStats, type VictoryResultView } from '@empire/rules';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { formatInt } from '@/lib/format';
import { useCampaignStats } from '@/lib/queries';
import {
  breakdownOf,
  campaignTotals,
  finaleText,
  honorsOf,
  placesOf,
  placeText,
  type HonorKey,
  type PointsBreakdown,
  type ResultStanding,
} from '@/lib/results';
import { countryName } from '@/lib/wars';
import { BotTag, PlayerName } from '../campaign/player-name';
import { useCampaignRoom, useCompareHref, useEmpireHref } from '../campaign/room-context';
import { Section } from '../empire/empire-screen';
import { HistoryChart } from '../empire/history-chart';
import { EmpireSwatch, HATCH_TILE, HatchTile, patternRotation, svgId } from '../hatch';
import { Notice, Spinner } from '../ui';
import { MissionCard } from './mission-card';
import { PointsCounter, ScoredStamp, useReducedMotion } from './score-effects';
import { TitleToken, TitleTokens, useTitlesOf } from './title-tokens';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Titles in the points bars: gold struck with darker lines, like the coins. */
const TITLE_FILL = 'repeating-linear-gradient(-45deg, #e3a92b 0 2.5px, #8f6a19 2.5px 5px)';

/**
 * A finished campaign's results, over the map room: who won and how, the podium, every player's
 * points and where they came from, the race round by round, honors, and the campaign in numbers.
 * Anyone who hasn't seen the campaign end sees its ending first (`Finale`), and the results come in
 * behind it as it goes.
 */
export function ResultsScreen() {
  const { model, finale } = useCampaignRoom();
  const stats = useCampaignStats(model.campaign.id);
  const result = model.campaign.status === 'finished' ? (model.campaign.victory?.result ?? null) : null;
  if (!result) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <Notice>The results are here once the campaign is won.</Notice>
        <Link href={`/c/${model.campaign.id}`} className="btn btn-ghost">
          Back to the map
        </Link>
      </div>
    );
  }
  if (finale.pending) return null;
  return <Results model={model} result={result} stats={stats.data} statsError={stats.error} onReplay={finale.replay} />;
}

function Results({
  model,
  result,
  stats,
  statsError,
  onReplay,
}: {
  model: CampaignModel;
  result: VictoryResultView;
  stats: CampaignStats | undefined;
  statsError: unknown;
  onReplay(): void;
}) {
  const still = useReducedMotion();
  const places = placesOf(result);
  const pending = (
    <div className="py-4">
      {statsError ? <Notice tone="error">{errorMessage(statsError)}</Notice> : <Spinner label="Reading the records" />}
    </div>
  );
  return (
    <article className="mx-auto max-w-6xl space-y-8 px-4 pt-5 pb-12 lg:px-8">
      <ResultsHeader model={model} result={result} onReplay={onReplay} />
      <Podium model={model} result={result} places={places} />
      <Section
        title="Final standings"
        note="Victory points, and where they came from. Pick a player for their missions."
      >
        <FinalStandings model={model} result={result} places={places} />
      </Section>
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        <Section title="The race" note="At the end of each round">
          {stats ? (
            <HistoryChart model={model} history={stats.history} userId={null} initialMeasure="points" draw={!still} />
          ) : (
            pending
          )}
        </Section>
        <Section title="Honors" note="The campaign’s records, and who set them">
          {stats ? <Honors model={model} stats={stats} /> : pending}
        </Section>
      </div>
      <Section title="The campaign in numbers">
        {stats ? <Numbers stats={stats} rounds={result.round} /> : pending}
      </Section>
    </article>
  );
}

/** Turns true `ms` after it's first drawn (at once with reduced motion), to start what waits for an entrance. */
function useAfter(ms: number): boolean {
  const still = useReducedMotion();
  const [due, setDue] = useState(false);
  useEffect(() => {
    if (still) return;
    const timer = setTimeout(() => setDue(true), ms);
    return () => clearTimeout(timer);
  }, [ms, still]);
  return due || still;
}

/** An entrance's delay, none with reduced motion. */
function useDelay(): (ms: number) => CSSProperties {
  const still = useReducedMotion();
  return (ms) => ({ animationDelay: `${still ? 0 : ms}ms` });
}

// ---------------------------------------------------------------------------------------------
// Who won

function ResultsHeader({
  model,
  result,
  onReplay,
}: {
  model: CampaignModel;
  result: VictoryResultView;
  onReplay(): void;
}) {
  const { campaign } = model;
  const compareHref = useCompareHref(campaign.id);
  const still = useReducedMotion();
  const text = finaleText(result, model.me.userId, (id) => model.membersById.get(id)?.name ?? 'A former player');
  // The link that opened the page is out of reach under it, so focus starts on the heading.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  return (
    <header className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="label">{text.label}</div>
          <h1
            ref={heading}
            tabIndex={-1}
            className="font-stencil text-[2rem] leading-tight tracking-wide focus:outline-none"
          >
            {campaign.name}
          </h1>
          <p className="max-w-3xl text-[0.95rem] text-paper/90">
            <strong className="font-bold text-paper">{text.who}</strong> {text.line}
            {text.place && ` ${text.place}`}
          </p>
        </div>
        <span
          className={`stamp stamp-hd mt-3 mr-1 ${text.outcome === 'defeat' ? 'stamp-red' : ''} ${still ? '' : 'stamp-slam'}`}
          style={{ animationDelay: '200ms' }}
          aria-hidden="true"
        >
          {text.stamp}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReplay}>
          Watch the ending again
        </button>
        <Link href={compareHref} className="btn btn-ghost btn-sm">
          Compare empires
        </Link>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------------------------
// The podium

const PODIUM_HEIGHT: Record<number, number> = { 1: 132, 2: 96, 3: 70 };
/** Third place rises first, then second, then the winner. */
const PODIUM_DELAY: Record<number, number> = { 1: 520, 2: 260, 3: 0 };

function Podium({
  model,
  result,
  places,
}: {
  model: CampaignModel;
  result: VictoryResultView;
  places: ReadonlyMap<string, number>;
}) {
  const top = result.standings.slice(0, 3);
  // The winner in the middle, second on their left and third on their right.
  const arranged = top.length === 3 ? [top[1]!, top[0]!, top[2]!] : top.length === 2 ? [top[1]!, top[0]!] : top;
  return (
    <div
      role="list"
      aria-label="The podium"
      className={`mx-auto grid items-end gap-2 border-b-2 border-line-strong sm:gap-5 ${
        arranged.length === 3 ? 'max-w-2xl grid-cols-3' : 'max-w-md grid-cols-2'
      }`}
    >
      {arranged.map((s) => (
        <PodiumPlace
          key={s.userId}
          model={model}
          standing={s}
          place={places.get(s.userId) ?? 3}
          text={placeText(result, places, s.userId)}
        />
      ))}
    </div>
  );
}

function PodiumPlace({
  model,
  standing,
  place,
  text,
}: {
  model: CampaignModel;
  standing: ResultStanding;
  place: number;
  text: string;
}) {
  const step = Math.min(place, 3);
  const at = PODIUM_DELAY[step]!;
  const delay = useDelay();
  const counting = useAfter(at + 650);
  const member = model.membersById.get(standing.userId);
  const titles = useTitlesOf(standing.userId);
  const you = standing.userId === model.me.userId;
  return (
    <div role="listitem" className="flex min-w-0 flex-col items-center gap-2">
      <div className="rise-in flex max-w-full min-w-0 flex-col items-center text-center" style={delay(at + 450)}>
        {place === 1 && (
          <img
            src="/icons/emblem.png"
            alt=""
            width={44}
            height={44}
            className="medal-pin mb-1 size-11 object-contain drop-shadow-[0_3px_8px_rgb(0_0_0/0.5)]"
            style={delay(at + 700)}
          />
        )}
        {/* The name gets its own line, which a narrow column would give up to the tags. */}
        <span className="flex max-w-full min-w-0 items-center gap-1.5">
          <EmpireSwatch color={member?.color ?? 0} size={16} className="shrink-0" />
          <span className="truncate font-stencil text-[0.95rem] tracking-wide">
            {member?.name ?? 'A former player'}
          </span>
        </span>
        {(you || member?.bot || titles.length > 0) && (
          <span className="flex flex-wrap items-center justify-center gap-x-1.5">
            {you && <span className="text-xs font-bold tracking-widest text-muted uppercase">you</span>}
            {member?.bot && <BotTag level={member.bot.level} standIn={member.bot.standIn} />}
            <TitleTokens titles={titles} size={16} holder={standing.userId} />
          </span>
        )}
        <span className="text-2xl font-bold text-amber">
          <PointsCounter value={counting ? standing.points : 0} delta={false} />
          <span className="ml-1 text-xs font-semibold tracking-widest text-muted uppercase">VP</span>
        </span>
      </div>
      <div
        className="podium-rise relative w-full overflow-hidden rounded-t-[3px] shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]"
        style={{ height: PODIUM_HEIGHT[step], ...delay(at) }}
      >
        <HatchFill color={member?.color ?? 0} />
        <span className="absolute inset-x-0 top-2.5 mx-auto flex size-10 items-center justify-center rounded-full bg-gunmetal/85 font-stencil text-2xl">
          <span aria-hidden="true">{place}</span>
          <span className="sr-only">{text}</span>
        </span>
      </div>
    </div>
  );
}

/** An empire's color and hatching filling a box, lit from above. */
function HatchFill({ color }: { color: number }) {
  const c = empireColor(color);
  const id = svgId(useId());
  const tile = HATCH_TILE * 1.6;
  return (
    <svg className="absolute inset-0 size-full" aria-hidden="true">
      <defs>
        <pattern
          id={id}
          width={tile}
          height={tile}
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${patternRotation(c.pattern)})`}
        >
          <HatchTile pattern={c.pattern} size={tile} />
        </pattern>
        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={0.14} />
          <stop offset="1" stopColor="#000" stopOpacity={0.3} />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill={c.hex} />
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      <rect width="100%" height="100%" fill={`url(#${id}-light)`} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// The standings

function FinalStandings({
  model,
  result,
  places,
}: {
  model: CampaignModel;
  result: VictoryResultView;
  places: ReadonlyMap<string, number>;
}) {
  const victory = model.campaign.victory!;
  const delay = useDelay();
  const [open, setOpen] = useState<string | null>(null);
  const breakdowns = new Map(result.standings.map((s) => [s.userId, breakdownOf(s, victory.titlePoints)]));
  const scale = Math.max(victory.pointsToWin, ...result.standings.map((s) => s.points), 1);
  const goal = (victory.pointsToWin / scale) * 100;
  const any = (key: keyof PointsBreakdown) => [...breakdowns.values()].some((b) => b[key] > 0);
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted" aria-label="Key">
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[2px] bg-amber" aria-hidden="true" />
          Public missions
        </li>
        {any('secret') && (
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-4 rounded-[2px] bg-paper" aria-hidden="true" />
            Secret mission
          </li>
        )}
        {(any('titles') || victory.titles.length > 0) && (
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-4 rounded-[2px]" style={{ background: TITLE_FILL }} aria-hidden="true" />
            Titles held at the end
          </li>
        )}
        <li className="flex items-center gap-1.5">
          <span className="h-4 border-l-2 border-dashed border-amber" aria-hidden="true" />
          {victory.pointsToWin} to win
        </li>
      </ul>
      <ol className="divide-y divide-line rounded-[3px] border border-line">
        {result.standings.map((s, i) => {
          const b = breakdowns.get(s.userId)!;
          const member = model.membersById.get(s.userId);
          const name = member?.name ?? 'A former player';
          const expanded = open === s.userId;
          const parts = [
            b.public && `${b.public} from public missions`,
            b.secret && `${b.secret} from their secret mission`,
            b.titles && `${b.titles} from titles`,
          ].filter(Boolean);
          return (
            <li
              key={s.userId}
              className={`rise-in ${s.userId === model.me.userId ? 'bg-raised/35' : ''}`}
              style={delay(250 + i * 110)}
            >
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${name}, ${placeText(result, places, s.userId)}: ${plural(s.points, 'victory point')}${
                  parts.length ? ` (${parts.join(', ')})` : ''
                }. ${expanded ? 'Hide' : 'Show'} their missions.`}
                onClick={() => setOpen(expanded ? null : s.userId)}
                className="grid w-full grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-left hover:bg-raised/60 sm:grid-cols-[1.75rem_minmax(0,13rem)_minmax(0,1fr)_auto]"
              >
                <span className="font-stencil text-xl text-muted">{places.get(s.userId)}</span>
                <span className="min-w-0">
                  <PlayerName member={member} you={s.userId === model.me.userId} size="sm" />
                  <span className="block text-xs text-muted">
                    {plural(s.countries, 'country', 'countries')} · value {s.value}
                    {result.winners.includes(s.userId) && ' · winner'}
                  </span>
                </span>
                <PointsBar
                  breakdown={b}
                  points={s.points}
                  scale={scale}
                  goal={goal}
                  style={delay(450 + i * 110)}
                  className="col-start-2 col-end-4 row-start-2 sm:col-start-3 sm:col-end-4 sm:row-start-1"
                />
                <span className="col-start-3 row-start-1 flex items-center gap-2 sm:col-start-4">
                  <span className="text-xl font-bold tabular-nums">
                    {s.points}
                    <span className="ml-1 text-xs font-semibold tracking-widest text-muted uppercase">VP</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
                  >
                    ▾
                  </span>
                </span>
              </button>
              {expanded && <StandingDetails model={model} standing={s} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A player's points as a bar to the points to win: public missions, the secret, titles. */
function PointsBar({
  breakdown,
  points,
  scale,
  goal,
  style,
  className,
}: {
  breakdown: PointsBreakdown;
  points: number;
  scale: number;
  /** Where the points to win are, in percent of the bar. */
  goal: number;
  style: CSSProperties;
  className: string;
}) {
  const { public: pub, secret, titles } = breakdown;
  // Points from earlier results that don't break down (none should) fill in as public ones.
  const rest = Math.max(0, points - pub - secret - titles);
  return (
    <span className={`relative block h-3.5 rounded-[2px] bg-line ${className}`} aria-hidden="true">
      <span
        className="bar-grow absolute inset-y-0 left-0 flex overflow-hidden rounded-[2px]"
        style={{ width: `${(points / scale) * 100}%`, ...style }}
      >
        <span className="h-full bg-amber" style={{ flexGrow: pub + rest }} />
        <span className="h-full bg-paper" style={{ flexGrow: secret }} />
        <span className="h-full" style={{ flexGrow: titles, background: TITLE_FILL }} />
      </span>
      <span className="absolute -inset-y-1 border-l-2 border-dashed border-amber/80" style={{ left: `${goal}%` }} />
    </span>
  );
}

/** What a player scored, the titles they ended with, and their secret mission, revealed now. */
function StandingDetails({ model, standing }: { model: CampaignModel; standing: ResultStanding }) {
  const { showCountry } = useCampaignRoom();
  const empireHref = useEmpireHref(model.campaign.id);
  const victory = model.campaign.victory!;
  const awards = [...standing.awards].sort((a, b) => a.round - b.round);
  const titles = standing.titles ?? [];
  return (
    <div className="grid gap-5 border-t border-line px-3 py-4 sm:pl-[3.25rem] md:grid-cols-2">
      <div className="space-y-4">
        <div>
          <h3 className="label mb-1.5">Missions scored</h3>
          {awards.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="space-y-1 text-[0.95rem]">
              {awards.map((a) => (
                <li key={a.missionKey} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1">
                    {missionName({ kind: a.kind }, victory.version)}
                    {a.missionKey === 'secret' && <span className="text-muted"> · secret</span>}
                  </span>
                  <span className="font-semibold text-amber tabular-nums">+{a.points}</span>
                  <span className="w-[4.5rem] text-right text-sm text-muted tabular-nums">round {a.round}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {titles.length > 0 && (
          <div>
            <h3 className="label mb-1.5">Titles held at the end</h3>
            <ul className="space-y-1 text-[0.95rem]">
              {titles.map((kind) => (
                <li key={kind} className="flex items-center gap-2">
                  <TitleToken kind={kind} size={20} label={false} />
                  <span className="min-w-0 flex-1">{TITLES[kind].name}</span>
                  <span className="font-semibold text-amber tabular-nums">+{victory.titlePoints}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Link href={empireHref(standing.userId)} className="btn btn-ghost btn-sm">
          Full statistics
        </Link>
      </div>
      <div>
        <h3 className="label mb-1.5">Secret mission</h3>
        {standing.secret ? (
          <MissionCard
            model={model}
            mission={standing.secret.mission}
            stamp={standing.secret.completed && <ScoredStamp />}
            onSelectCountry={showCountry}
          >
            <p className={`text-sm font-semibold ${standing.secret.completed ? 'text-amber' : 'text-muted'}`}>
              {standing.secret.completed ? 'Completed and scored.' : 'Not completed.'}
            </p>
          </MissionCard>
        ) : (
          <p className="text-sm text-muted">Played without a secret mission.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Honors

function Honors({ model, stats }: { model: CampaignModel; stats: CampaignStats }) {
  const delay = useDelay();
  const honors = honorsOf({
    stats,
    idx: model.idx,
    members: model.campaign.members,
    nameOf: (id) => model.membersById.get(id)?.name ?? 'a former player',
    countryName: (id) => countryName(model, id),
  });
  if (honors.length === 0) {
    return <p className="text-[0.95rem] text-muted">No records were set: nobody fought a war or played a game.</p>;
  }
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {honors.map((h, i) => (
        <li
          key={h.key}
          className="rise-in flex items-start gap-3 rounded-[3px] border border-line bg-panel/50 p-3"
          style={delay(350 + i * 100)}
        >
          <span className="medal-pin shrink-0" style={delay(500 + i * 100)}>
            <Medal kind={h.key} color={model.membersById.get(h.holders[0]!)?.color ?? 0} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-stencil text-lg leading-tight tracking-wide">{h.name}</div>
            <div className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">{h.what}</div>
            <ul className="mt-1.5">
              {h.holders.map((id) => (
                <li key={id} className="min-w-0">
                  <PlayerName member={model.membersById.get(id)} you={id === model.me.userId} size="sm" />
                </li>
              ))}
            </ul>
            <div className="text-sm text-paper/85">{h.figure}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Each honor's mark, drawn in a 16-unit box. */
const MARKS: Record<HonorKey, ReactNode> = {
  // A flag planted.
  conqueror: <path d="M4 15V1.5M4 2.2h8.5l-2.2 3 2.2 3H4" />,
  // Crossed swords.
  warlord: <path d="M2.5 2.5l9 9M9.6 12.4l2.8-2.8M11.5 11.5l2 2M13.5 2.5l-9 9M3.6 9.6l2.8 2.8M4.5 11.5l-2 2" />,
  // A shield.
  bulwark: <path d="M8 1.6l5.4 2v4.3c0 3.4-2.3 5.6-5.4 6.6-3.1-1-5.4-3.2-5.4-6.6V3.6zM8 4.6v6.8" />,
  // A crown.
  spoils: <path d="M2.2 12.6h11.6M2.6 12.6L1.8 5.2l3.4 2.6L8 3.2l2.8 4.6 3.4-2.6-.8 7.4" />,
  // A king.
  grandmaster: (
    <path d="M8 1.2v3.2M6.6 2.6h2.8M5.4 8.2c-.8-.6-1.1-1.3-.9-2.1.3-1.1 1.5-1.5 3.5-.8 2-.7 3.2-.3 3.5.8.2.8-.1 1.5-.9 2.1M5.4 8.2h5.2M5.9 8.2L5 13h6l-.9-4.8M3.8 14.8h8.4" />
  ),
  // A lightning strike.
  swift: <path d="M9.4 1.2L3.2 9h4.3l-1.3 5.8 6.6-8.2H8.4z" fill="currentColor" stroke="none" />,
  // An hourglass.
  marathon: (
    <path d="M3.5 1.5h9M3.5 14.5h9M4.6 1.5c0 3.6 6.8 4.2 6.8 6.5s-6.8 2.9-6.8 6.5M11.4 1.5c0 3.6-6.8 4.2-6.8 6.5s6.8 2.9 6.8 6.5" />
  ),
  // A war arrow, in grease pencil.
  warmonger: <path d="M2.2 13.6c2.6-4.2 6.2-7.4 11.2-10.4m0 0l-4.6.2m4.6-.2l-1.6 4.3" />,
  // An olive branch.
  diplomat: (
    <>
      <path d="M2.5 14C5.5 10.8 8.6 7 12.8 2.2" />
      <path
        d="M5.6 10.6c-1.9.1-3.1-.8-3.6-2.3 1.9-.1 3.1.8 3.6 2.3zM6 10.4c.2-1.9 1.3-3 2.8-3.4 0 1.9-1.1 3-2.8 3.4zM8.6 7.4c-1.8.3-3.1-.4-3.8-1.8 1.8-.3 3.1.4 3.8 1.8zM9 7.2c0-1.9 1-3.1 2.4-3.7.2 1.9-.8 3.1-2.4 3.7z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  // A broken chain.
  oathbreaker: (
    <>
      <rect x="0.9" y="6" width="6.4" height="4.4" rx="2.2" transform="rotate(-28 4.1 8.2)" />
      <rect x="8.7" y="5.6" width="6.4" height="4.4" rx="2.2" transform="rotate(-28 11.9 7.8)" />
      <path d="M7.4 2.8l.5 1.7M9.8 3.4l-.9 1.3M6.2 12.6l.9-1.3M8.6 13.2l-.5-1.7" />
    </>
  ),
};

/** A medal on a ribbon in the holder's color and hatching, the honor's mark struck on it. */
function Medal({ kind, color }: { kind: HonorKey; color: number }) {
  const c = empireColor(color);
  const id = svgId(useId());
  return (
    <svg width={44} height={58} viewBox="0 0 44 58" aria-hidden="true">
      <defs>
        <pattern
          id={`${id}-hatch`}
          width={5}
          height={5}
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${patternRotation(c.pattern)})`}
        >
          <HatchTile pattern={c.pattern} size={5} />
        </pattern>
        <radialGradient id={`${id}-gold`} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fbe7a6" />
          <stop offset="0.45" stopColor="#e3a92b" />
          <stop offset="1" stopColor="#94661a" />
        </radialGradient>
      </defs>
      <path d="M8 0h28l-7 25H15z" fill={c.hex} />
      <path d="M8 0h28l-7 25H15z" fill={`url(#${id}-hatch)`} />
      <path d="M19.6 0h4.8l-.9 25h-3z" fill="#e4e2d8" opacity={0.85} />
      <path d="M8 0h28l-7 25H15z" fill="none" stroke="rgb(0 0 0 / 0.35)" />
      <circle cx={22} cy={39} r={15.5} fill={`url(#${id}-gold)`} stroke="#6b4a10" strokeWidth={1.2} />
      <circle cx={22} cy={39} r={12} fill="none" stroke="rgb(107 74 16 / 0.55)" />
      <g
        transform="translate(14 31)"
        fill="none"
        stroke="#4a3308"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        color="#4a3308"
      >
        {MARKS[kind]}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// The campaign in numbers

function Numbers({ stats, rounds }: { stats: CampaignStats; rounds: number }) {
  const delay = useDelay();
  const totals = campaignTotals(stats, rounds);
  const tiles: [label: string, value: number][] = [
    ['Rounds', totals.rounds],
    ['Wars declared', totals.wars],
    ['Countries changed hands', totals.countries],
    ['Games played', totals.battles],
    ['Checkmates', totals.checkmates],
    ['Moves', totals.moves],
    ['Accords signed', totals.accordsSigned],
    ['Accords broken', totals.accordsBroken],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
      {tiles.map(([label, value], i) => (
        <div key={label} className="rise-in border-l-2 border-amber/50 pl-3" style={delay(300 + i * 80)}>
          <dt className="label">{label}</dt>
          <dd className="text-3xl font-bold tabular-nums">
            <CountUp value={value} delay={500 + i * 80} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A figure counting up to its value as it comes in. */
function CountUp({ value, delay }: { value: number; delay: number }) {
  const still = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (still) return;
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / 900));
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, delay, still]);
  return <>{formatInt(still ? value : shown)}</>;
}
