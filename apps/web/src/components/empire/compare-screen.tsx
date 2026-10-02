'use client';

import {
  empireColor,
  REPUTATION_START,
  type CampaignStats,
  type EmpireRecordView,
  type MemberView,
} from '@empire/rules';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import {
  amountOf,
  chessResults,
  leaderOf,
  resultsPlayed,
  score,
  shareRow,
  warResults,
  type Leader,
  type Measure,
  type Results,
} from '@/lib/compare';
import { formatShare } from '@/lib/empire';
import { formatAreaCompact, formatCount, formatInt, formatUsd } from '@/lib/format';
import { useCampaignStats } from '@/lib/queries';
import { useElementWidth } from '@/lib/use-element-width';
import { PlayerName } from '../campaign/player-name';
import { useCampaignRoom, useEmpireHref } from '../campaign/room-context';
import { EmpireSwatch, HATCH_TILE, HatchTile, patternRotation, svgId } from '../hatch';
import { Notice, Spinner } from '../ui';
import { Section } from './empire-screen';
import { HistoryChart } from './history-chart';

const formatPlain = (n: number | null) => (n === null ? '—' : formatInt(n));

/** The measures empires are split by, as on the empire page's real-world totals. */
const SHARES: { measure: Measure; label: string; format(n: number | null): string }[] = [
  { measure: 'value', label: 'Game value', format: formatPlain },
  { measure: 'countries', label: 'Countries', format: formatPlain },
  { measure: 'population', label: 'Population', format: formatCount },
  { measure: 'gdpNominalUsd', label: 'GDP', format: formatUsd },
  { measure: 'gdpPppUsd', label: 'GDP (PPP)', format: formatUsd },
  { measure: 'areaKm2', label: 'Area', format: formatAreaCompact },
  { measure: 'militarySpendingUsd', label: 'Military spending', format: formatUsd },
  { measure: 'armedForces', label: 'Armed forces', format: formatCount },
];

/** Unclaimed land, as on the map. */
const UNCLAIMED = '#4b5320';
/** Draws and losses are the same for every empire: a quiet fill, and an outline. */
const DRAWN_INK = 'rgb(228 226 216 / 0.45)';
const LOST_INK = 'rgb(228 226 216 / 0.4)';
const GAP = 2;

const percent = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every empire side by side: who leads, the race, shares of the world, wars, chess and diplomacy. */
export function CompareScreen() {
  const { model } = useCampaignRoom();
  const stats = useCampaignStats(model.campaign.id);
  const { status, victory } = model.campaign;
  const showPoints = victory !== null && (status === 'active' || status === 'finished');
  const pointsOf = new Map(victory?.players.map((p) => [p.userId, p.points]) ?? []);
  const valueOf = (userId: string) => amountOf(model.idx, model.holdingsByUser.get(userId) ?? [], 'value') ?? 0;
  // The standings' order, kept the same in every chart so an empire is always in the same place.
  const order = [...model.campaign.members].sort(
    (a, b) =>
      (showPoints ? (pointsOf.get(b.userId) ?? 0) - (pointsOf.get(a.userId) ?? 0) : 0) ||
      valueOf(b.userId) - valueOf(a.userId) ||
      a.name.localeCompare(b.name),
  );

  const pending = (
    <div className="py-4">
      {stats.error ? (
        <Notice tone="error">{errorMessage(stats.error)}</Notice>
      ) : (
        <Spinner label="Reading the records" />
      )}
    </div>
  );

  return (
    <article className="mx-auto max-w-6xl space-y-6 px-4 pt-5 pb-10 lg:px-8">
      <CompareHeader model={model} order={order} />
      {status === 'lobby' ? (
        <p className="text-[0.95rem] text-muted">Empires take shape in the draft. Come back once it’s over.</p>
      ) : (
        <>
          <Leaders model={model} order={order} stats={stats.data} pointsOf={showPoints ? pointsOf : null} />
          <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
            <Section title="The race" note="Every empire at the end of each round">
              {stats.data ? <HistoryChart model={model} history={stats.data.history} userId={null} /> : pending}
            </Section>
            <Section title="Shares of the world" note="Each empire’s part of the whole map’s total">
              <ShareBars model={model} order={order} />
            </Section>
            <Section title="Wars" note="Won, drawn and lost, attacking and defending">
              {stats.data ? <WarBars model={model} order={order} stats={stats.data} /> : pending}
            </Section>
            <Section title="Chess" note="Finished games, and the score from them">
              {stats.data ? <ChessBars model={model} order={order} stats={stats.data} /> : pending}
            </Section>
            <Section title="Diplomacy" note="Reputation, which starts at 100, and accords">
              {stats.data ? <ReputationBars model={model} order={order} stats={stats.data} /> : pending}
            </Section>
          </div>
          <Section title="By the numbers">
            <NumbersTable model={model} order={order} stats={stats.data} pointsOf={showPoints ? pointsOf : null} />
          </Section>
        </>
      )}
      <p className="border-t border-line pt-4 text-xs text-faint">
        Country data: World Bank World Development Indicators (CC BY 4.0) and Natural Earth. Shares count every country
        on the map, claimed or not, that has the figure.
      </p>
    </article>
  );
}

function CompareHeader({ model, order }: { model: CampaignModel; order: MemberView[] }) {
  const { campaign } = model;
  const empireHref = useEmpireHref(campaign.id);
  // The link that opened the page is now out of reach under it, so focus starts on the heading.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const when =
    campaign.status === 'active'
      ? `Round ${campaign.round}`
      : campaign.status === 'finished'
        ? 'Final'
        : campaign.status === 'lobby'
          ? 'Lobby'
          : 'After the draft';
  return (
    <header className="space-y-3">
      <div>
        <div className="label">
          {plural(order.length, 'empire')} · {when}
        </div>
        <h1
          ref={heading}
          tabIndex={-1}
          className="font-stencil text-[2rem] leading-tight tracking-wide focus:outline-none"
        >
          Compare empires
        </h1>
      </div>
      {campaign.status !== 'lobby' && (
        <nav aria-label="Empire pages" className="flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">Empire pages</span>
          {order.map((m) => (
            <Link
              key={m.userId}
              href={empireHref(m.userId)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[3px] border border-line-strong px-2 text-[0.95rem] hover:bg-raised"
            >
              <EmpireSwatch color={m.color} size={12} />
              {m.userId === model.me.userId ? 'You' : m.name}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------------------------
// Leaders

function Leaders({
  model,
  order,
  stats,
  pointsOf,
}: {
  model: CampaignModel;
  order: MemberView[];
  stats: CampaignStats | undefined;
  pointsOf: ReadonlyMap<string, number> | null;
}) {
  const recordOf = (userId: string) => stats?.empires.find((e) => e.userId === userId);
  const byMeasure = (measure: Measure) =>
    leaderOf(
      order.map((m) => ({
        userId: m.userId,
        amount: amountOf(model.idx, model.holdingsByUser.get(m.userId) ?? [], measure),
      })),
    );
  const tiles: { label: string; leader: Leader | null; text(n: number): string }[] = [
    ...(pointsOf
      ? [
          {
            label: 'Victory points',
            leader: leaderOf(order.map((m) => ({ userId: m.userId, amount: pointsOf.get(m.userId) ?? 0 }))),
            text: (n: number) => `${n} VP`,
          },
        ]
      : []),
    { label: 'Most valuable', leader: byMeasure('value'), text: (n) => `Value ${n}` },
    { label: 'Most people', leader: byMeasure('population'), text: formatCount },
    { label: 'Largest economy', leader: byMeasure('gdpNominalUsd'), text: formatUsd },
    { label: 'Most land', leader: byMeasure('areaKm2'), text: formatAreaCompact },
    { label: 'Biggest military', leader: byMeasure('militarySpendingUsd'), text: formatUsd },
    ...(stats
      ? [
          {
            label: 'Most wars won',
            leader: leaderOf(
              order.map((m) => {
                const record = recordOf(m.userId);
                return { userId: m.userId, amount: record ? warResults(record.wars).won : null };
              }),
            ),
            text: (n: number) => plural(n, 'war') + ' won',
          },
          {
            label: 'Best chess score',
            // Level scores go to whoever played more.
            leader: leaderOf(
              order.map((m) => {
                const record = recordOf(m.userId);
                const results = record ? chessResults(record.chess) : null;
                return {
                  userId: m.userId,
                  amount: results ? score(results) : null,
                  then: results ? resultsPlayed(results) : 0,
                };
              }),
              { zero: true },
            ),
            text: percent,
          },
        ]
      : []),
    {
      label: 'Best reputation',
      leader: leaderOf(
        order.map((m) => ({ userId: m.userId, amount: m.reputation })),
        { zero: true },
      ),
      text: String,
    },
  ];
  return (
    <section aria-label="Leaders">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2">
        {tiles.map(({ label, leader, text }) =>
          leader ? (
            <li key={label} className="min-w-0 rounded-[3px] border border-line bg-panel/60 px-3 py-2.5">
              <div className="label">{label}</div>
              <div className="text-2xl font-semibold tabular-nums">{text(leader.amount)}</div>
              <div className="mt-1 space-y-0.5">
                {leader.userIds.map((u) => (
                  <LeaderName key={u} model={model} userId={u} />
                ))}
              </div>
            </li>
          ) : null,
        )}
      </ul>
    </section>
  );
}

function LeaderName({ model, userId }: { model: CampaignModel; userId: string }) {
  const empireHref = useEmpireHref(model.campaign.id);
  return (
    <div className="flex min-w-0">
      <PlayerName
        member={model.membersById.get(userId)}
        you={userId === model.me.userId}
        size="sm"
        href={empireHref(userId)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Shares of the world

/**
 * One bar per measure, split between the empires in their colors and hatching, with the rest of
 * the world unclaimed. Picking an empire (from the key or a bar) quiets the others and reads its
 * figures out beside each bar.
 */
function ShareBars({ model, order }: { model: CampaignModel; order: MemberView[] }) {
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [ref, width] = useElementWidth();
  const patternId = svgId(useId());
  const lit = hovered ?? pinned;
  const pin = (userId: string) => setPinned((p) => (p === userId ? null : userId));
  const hover = (userId: string | null) => setHovered(userId);
  const ids = order.map((m) => m.userId);
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Pick out an empire" className="flex flex-wrap gap-1.5">
        {order.map((m) => (
          <button
            key={m.userId}
            type="button"
            aria-pressed={pinned === m.userId}
            onClick={() => pin(m.userId)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && hover(m.userId)}
            onPointerLeave={() => hover(null)}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-[3px] border px-2 text-[0.95rem] hover:bg-raised aria-pressed:border-paper aria-pressed:bg-raised ${
              lit !== null && lit !== m.userId ? 'border-line text-muted' : 'border-line-strong'
            }`}
          >
            <EmpireSwatch color={m.color} size={12} />
            {m.userId === model.me.userId ? 'You' : m.name}
          </button>
        ))}
        <span className="inline-flex min-h-9 items-center gap-1.5 px-2 text-[0.95rem] text-muted">
          <span className="size-3 rounded-[2px] border border-line-strong" style={{ background: UNCLAIMED }} />
          Unclaimed
        </span>
      </div>
      {/* The hatching each bar draws over its empire colors, defined once for them all. */}
      <svg width={0} height={0} className="absolute" aria-hidden="true">
        <defs>
          {order.map((m) => {
            const c = empireColor(m.color);
            return (
              <pattern
                key={m.color}
                id={`${patternId}-${m.color}`}
                width={HATCH_TILE}
                height={HATCH_TILE}
                patternUnits="userSpaceOnUse"
                patternTransform={`rotate(${patternRotation(c.pattern)})`}
              >
                <HatchTile pattern={c.pattern} size={HATCH_TILE} />
              </pattern>
            );
          })}
        </defs>
      </svg>
      <ul ref={ref} className="space-y-3">
        {SHARES.map(({ measure, label, format }) => {
          const row = shareRow(model.idx, model.holdingsByUser, ids, measure);
          const part = lit === null ? null : row.parts.find((p) => p.userId === lit);
          const name = (u: string) => (u === model.me.userId ? 'You' : (model.membersById.get(u)?.name ?? 'Unknown'));
          const top = row.parts.reduce<(typeof row.parts)[number] | null>(
            (best, p) => (p.share > (best?.share ?? 0) ? p : best),
            null,
          );
          const reading = part
            ? `${name(part.userId)} ${format(part.amount)} · ${formatShare(part.share)}`
            : [
                top ? `${name(top.userId)} leads with ${formatShare(top.share)}` : '',
                row.unclaimed >= 0.0005 ? `${formatShare(row.unclaimed)} unclaimed` : '',
              ]
                .filter(Boolean)
                .join(' · ');
          // Segments with anything in them, then the unclaimed rest, a gap between each.
          const segments = [
            ...row.parts.filter((p) => p.share > 0).map((p) => ({ userId: p.userId as string | null, share: p.share })),
            ...(row.unclaimed > 0 ? [{ userId: null, share: row.unclaimed }] : []),
          ];
          const room = Math.max(0, width - GAP * (segments.length - 1));
          let x = 0;
          return (
            <li key={measure}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="label">{label}</span>
                <span className="truncate text-sm tabular-nums">{reading}</span>
              </div>
              <svg
                width={width}
                height={20}
                role="img"
                aria-label={`${label}: ${[
                  ...row.parts.map((p) => `${name(p.userId)} ${format(p.amount)}, ${formatShare(p.share)}`),
                  `unclaimed ${formatShare(row.unclaimed)}`,
                ].join('; ')}`}
                className="mt-1 block"
              >
                {width > 0 &&
                  segments.map(({ userId, share }) => {
                    const w = share * room;
                    const at = x;
                    x += w + GAP;
                    const dim = lit !== null && lit !== userId;
                    if (userId === null) {
                      return (
                        <rect
                          key="unclaimed"
                          x={at}
                          width={w}
                          height={20}
                          rx={2}
                          fill={UNCLAIMED}
                          opacity={dim ? 0.5 : 1}
                        />
                      );
                    }
                    const color = model.membersById.get(userId)?.color ?? 0;
                    return (
                      <g
                        key={userId}
                        opacity={dim ? 0.25 : 1}
                        className="cursor-pointer"
                        onPointerEnter={(e) => e.pointerType === 'mouse' && hover(userId)}
                        onPointerLeave={() => hover(null)}
                        onClick={() => pin(userId)}
                      >
                        <rect x={at} width={w} height={20} rx={2} fill={empireColor(color).hex} />
                        <rect x={at} width={w} height={20} rx={2} fill={`url(#${patternId}-${color})`} />
                      </g>
                    );
                  })}
              </svg>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Wars, chess and diplomacy: a row per empire

/** An empire's name and headline figure, with a bar under them and a line of detail. */
function EmpireRow({
  model,
  member,
  figure,
  figureLabel,
  detail,
  children,
}: {
  model: CampaignModel;
  member: MemberView;
  figure: string;
  /** The figure in words, for screen readers. */
  figureLabel?: string;
  detail: string;
  children: ReactNode;
}) {
  const empireHref = useEmpireHref(model.campaign.id);
  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1">
          <PlayerName
            member={member}
            you={member.userId === model.me.userId}
            size="sm"
            href={empireHref(member.userId)}
          />
        </span>
        <span className="shrink-0 font-semibold tabular-nums">
          <span aria-hidden={figureLabel ? true : undefined}>{figure}</span>
          {figureLabel && <span className="sr-only">{figureLabel}</span>}
        </span>
      </div>
      <div className="mt-1">{children}</div>
      {detail && <p className="mt-0.5 text-xs text-muted">{detail}</p>}
    </li>
  );
}

/** Won in the empire's color, drawn in a quiet fill, lost as an outline; longer for more played. */
function ResultBar({ results, most, color, width }: { results: Results; most: number; color: number; width: number }) {
  const parts = (['won', 'drawn', 'lost'] as const).filter((k) => results[k] > 0);
  const room = Math.max(0, width - GAP * (parts.length - 1));
  const unit = most > 0 ? room / most : 0;
  let x = 0;
  return (
    <svg width={width} height={12} aria-hidden="true" className="block">
      <rect width={width} height={12} rx={2} className="fill-raised/50" />
      {parts.map((k) => {
        const w = results[k] * unit;
        const at = x;
        x += w + GAP;
        if (k === 'won') return <rect key={k} x={at} width={w} height={12} rx={2} fill={empireColor(color).line} />;
        if (k === 'drawn') return <rect key={k} x={at} width={w} height={12} rx={2} fill={DRAWN_INK} />;
        return (
          <rect
            key={k}
            x={at + 0.75}
            y={0.75}
            width={Math.max(0, w - 1.5)}
            height={10.5}
            rx={2}
            fill="none"
            stroke={LOST_INK}
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

function ResultKey() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span>Won in the empire’s color</span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[2px]" style={{ background: DRAWN_INK }} aria-hidden="true" />
        Drawn
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[2px] border-[1.5px]" style={{ borderColor: LOST_INK }} aria-hidden="true" />
        Lost
      </span>
    </p>
  );
}

const resultsText = (r: Results) => `${r.won} won, ${r.drawn} drawn, ${r.lost} lost`;

function WarBars({ model, order, stats }: { model: CampaignModel; order: MemberView[]; stats: CampaignStats }) {
  const [ref, width] = useElementWidth();
  const rows = order.flatMap((member) => {
    const record = stats.empires.find((e) => e.userId === member.userId);
    return record ? [{ member, record, results: warResults(record.wars) }] : [];
  });
  const most = Math.max(0, ...rows.map((r) => resultsPlayed(r.results)));
  if (most === 0 && rows.every((r) => r.results.other + r.results.underway === 0)) {
    return <p className="text-[0.95rem] text-muted">No wars yet.</p>;
  }
  return (
    <div className="space-y-2">
      <ResultKey />
      <ul ref={ref} className="divide-y divide-line">
        {rows.map(({ member, record, results }) => (
          <EmpireRow
            key={member.userId}
            model={model}
            member={member}
            figure={`${results.won}–${results.drawn}–${results.lost}`}
            figureLabel={resultsText(results)}
            detail={warDetail(record, results)}
          >
            <ResultBar results={results} most={most} color={member.color} width={width} />
          </EmpireRow>
        ))}
      </ul>
    </div>
  );
}

function warDetail(record: EmpireRecordView, results: ReturnType<typeof warResults>): string {
  const { gained, lost } = record.wars;
  return [
    gained.length > 0 ? `took ${plural(gained.length, 'country', 'countries')}` : '',
    lost.length > 0 ? `lost ${plural(lost.length, 'country', 'countries')}` : '',
    results.other > 0 ? `${results.other} settled or called off` : '',
    results.underway > 0 ? `${results.underway} underway` : '',
  ]
    .filter(Boolean)
    .join(' · ')
    .replace(/^./, (c) => c.toUpperCase());
}

function ChessBars({ model, order, stats }: { model: CampaignModel; order: MemberView[]; stats: CampaignStats }) {
  const [ref, width] = useElementWidth();
  const rows = order.flatMap((member) => {
    const record = stats.empires.find((e) => e.userId === member.userId);
    return record ? [{ member, chess: record.chess, results: chessResults(record.chess) }] : [];
  });
  const most = Math.max(0, ...rows.map((r) => resultsPlayed(r.results)));
  if (most === 0) {
    const underway = rows.reduce((sum, r) => sum + r.chess.underway, 0);
    return (
      <p className="text-[0.95rem] text-muted">
        No games finished yet{underway > 0 ? `; ${plural(underway, 'game')} being played` : ''}.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <ResultKey />
      <ul ref={ref} className="divide-y divide-line">
        {rows.map(({ member, chess, results }) => {
          const s = score(results);
          return (
            <EmpireRow
              key={member.userId}
              model={model}
              member={member}
              figure={s === null ? '—' : percent(s)}
              figureLabel={s === null ? 'no games finished' : `scored ${percent(s)}: ${resultsText(results)}`}
              detail={[
                plural(chess.played, 'game'),
                chess.averageMoves !== null ? `${plural(Math.round(chess.averageMoves), 'move')} on average` : '',
                chess.underway > 0 ? `${chess.underway} underway` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              <ResultBar results={results} most={most} color={member.color} width={width} />
            </EmpireRow>
          );
        })}
      </ul>
    </div>
  );
}

function ReputationBars({ model, order, stats }: { model: CampaignModel; order: MemberView[]; stats: CampaignStats }) {
  const [ref, width] = useElementWidth();
  // Bars run either way from where every empire started, so small differences show.
  const reach = Math.max(20, ...order.map((m) => Math.abs(m.reputation - REPUTATION_START)));
  const mid = width / 2;
  const x = (n: number) => mid + ((n - REPUTATION_START) / reach) * (mid - 1);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Bars run left of the line for reputation lost since the start ({REPUTATION_START}), right for reputation gained.
      </p>
      <ul ref={ref} className="divide-y divide-line">
        {order.map((member) => {
          const accords = stats.empires.find((e) => e.userId === member.userId)?.accords;
          return (
            <EmpireRow
              key={member.userId}
              model={model}
              member={member}
              figure={`${member.reputation}`}
              figureLabel={`reputation ${member.reputation}, ${
                member.reputation === REPUTATION_START
                  ? 'where it started'
                  : `${Math.abs(member.reputation - REPUTATION_START)} ${member.reputation > REPUTATION_START ? 'above' : 'below'} the start`
              }`}
              detail={
                accords
                  ? [
                      accords.signed > 0 ? `${plural(accords.signed, 'accord')} signed` : 'No accords',
                      accords.inForce > 0 ? `${accords.inForce} in force` : '',
                      accords.kept > 0 ? `${accords.kept} kept` : '',
                      accords.broken > 0 ? `${accords.broken} broken` : '',
                      accords.betrayed > 0 ? `${accords.betrayed} broken by the partner` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : ''
              }
            >
              <svg width={width} height={12} aria-hidden="true" className="block">
                <rect width={width} height={12} rx={2} className="fill-raised/50" />
                {member.reputation !== REPUTATION_START && (
                  <rect
                    x={Math.min(mid, x(member.reputation))}
                    width={Math.abs(x(member.reputation) - mid)}
                    height={12}
                    rx={2}
                    fill={empireColor(member.color).line}
                  />
                )}
                <line x1={mid} x2={mid} y1={0} y2={12} stroke="#e4e2d8" strokeWidth={2} />
              </svg>
            </EmpireRow>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// By the numbers

interface Column {
  key: string;
  label: string;
  title?: string;
  amount(userId: string): number | null;
  text(userId: string): string;
}

function NumbersTable({
  model,
  order,
  stats,
  pointsOf,
}: {
  model: CampaignModel;
  order: MemberView[];
  stats: CampaignStats | undefined;
  pointsOf: ReadonlyMap<string, number> | null;
}) {
  const empireHref = useEmpireHref(model.campaign.id);
  const [sort, setSort] = useState<string | null>(null);
  const record = (userId: string) => stats?.empires.find((e) => e.userId === userId);
  const measured = (measure: Measure, format: (n: number | null) => string) => ({
    amount: (u: string) => amountOf(model.idx, model.holdingsByUser.get(u) ?? [], measure),
    text: (u: string) => format(amountOf(model.idx, model.holdingsByUser.get(u) ?? [], measure)),
  });
  const wars = (u: string) => {
    const r = record(u);
    return r ? warResults(r.wars) : null;
  };
  const games = (u: string) => {
    const r = record(u);
    return r ? chessResults(r.chess) : null;
  };
  const columns: Column[] = [
    ...(pointsOf
      ? [
          {
            key: 'points',
            label: 'VP',
            title: 'Victory points',
            amount: (u: string) => pointsOf.get(u) ?? 0,
            text: (u: string) => String(pointsOf.get(u) ?? 0),
          },
        ]
      : []),
    { key: 'value', label: 'Value', ...measured('value', formatPlain) },
    { key: 'countries', label: 'Countries', ...measured('countries', formatPlain) },
    { key: 'population', label: 'Population', ...measured('population', formatCount) },
    { key: 'gdp', label: 'GDP', ...measured('gdpNominalUsd', formatUsd) },
    { key: 'area', label: 'Area', ...measured('areaKm2', formatAreaCompact) },
    { key: 'military', label: 'Military', title: 'Military spending', ...measured('militarySpendingUsd', formatUsd) },
    {
      key: 'wars',
      label: 'Wars',
      title: 'Wars won, drawn and lost',
      amount: (u) => wars(u)?.won ?? null,
      text: (u) => {
        const w = wars(u);
        return w ? `${w.won}–${w.drawn}–${w.lost}` : '…';
      },
    },
    {
      key: 'chess',
      label: 'Chess',
      title: 'Score in finished games',
      amount: (u) => {
        const g = games(u);
        return g ? score(g) : null;
      },
      text: (u) => {
        const g = games(u);
        if (!g) return '…';
        const s = score(g);
        return s === null ? '—' : percent(s);
      },
    },
    {
      key: 'reputation',
      label: 'Rep',
      title: 'Reputation',
      amount: (u) => model.membersById.get(u)?.reputation ?? null,
      text: (u) => String(model.membersById.get(u)?.reputation ?? '—'),
    },
  ];
  const by = columns.find((c) => c.key === sort) ?? null;
  const rows = by
    ? [...order].sort((a, b) => (by.amount(b.userId) ?? -Infinity) - (by.amount(a.userId) ?? -Infinity))
    : order;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[0.95rem] tabular-nums">
        <caption className="sr-only">
          Every empire’s figures, {by ? `sorted by ${(by.title ?? by.label).toLowerCase()}` : 'in standings order'}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="pb-1 text-left">
              <button
                type="button"
                onClick={() => setSort(null)}
                className={`label min-h-9 hover:text-paper ${by === null ? 'text-paper' : ''}`}
              >
                Empire
              </button>
            </th>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort === c.key ? 'descending' : undefined}
                className="pb-1 pl-4 text-right whitespace-nowrap"
              >
                <button
                  type="button"
                  title={c.title}
                  onClick={() => setSort(c.key)}
                  className={`label min-h-9 hover:text-paper ${sort === c.key ? 'text-paper' : ''}`}
                >
                  {c.label}
                  {sort === c.key && <span aria-hidden="true"> ↓</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((m) => (
            <tr key={m.userId}>
              <th scope="row" className="max-w-48 py-1.5 pr-2 text-left font-normal">
                <span className="flex min-w-0">
                  <PlayerName member={m} you={m.userId === model.me.userId} size="sm" href={empireHref(m.userId)} />
                </span>
              </th>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`py-1.5 pl-4 text-right whitespace-nowrap ${sort === c.key ? 'font-semibold' : ''}`}
                >
                  {c.text(m.userId)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
