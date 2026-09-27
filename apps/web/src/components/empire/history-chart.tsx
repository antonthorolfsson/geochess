'use client';

import { empireColor, type HistoryView, type HistoryWar } from '@empire/rules';
import Link from 'next/link';
import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { CampaignModel } from '@/lib/campaign';
import { useElementWidth } from '@/lib/use-element-width';
import { useIsDesktop } from '@/lib/use-media-query';
import { countryName, playerName } from '@/lib/wars';
import { PlayerName } from '../campaign/player-name';

type Measure = 'value' | 'countries';

const MEASURES: Record<Measure, { label: string; caption: string }> = {
  value: { label: 'Value', caption: 'Game value at the end of each round' },
  countries: { label: 'Countries', caption: 'Countries held at the end of each round' },
};

const MARGIN = { top: 12, right: 40, bottom: 26, left: 34 };
/** Other empires are context: quiet lines, so the empire the page is about stands out. */
const CONTEXT_INK = 'rgb(166 170 162 / 0.4)';
/** The map-room surface, as the ring that keeps markers clear of the lines they sit on. */
const SURFACE = '#1f2428';

/** A round number for axis ticks: 1, 2, 5 or 10 times a power of ten, never below 1. */
function niceStep(raw: number): number {
  if (raw <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

const roundLabel = (round: number) => (round === 0 ? 'Draft' : String(round));
const readoutLabel = (round: number) => (round === 0 ? 'End of the draft' : `Round ${round}`);

/**
 * Every empire's size over the campaign, one line each, with the empire the page is about in its
 * own color and its wars marked. Other empires light up from the readout below the chart, which
 * gives every value at a round: the one under the mouse, else the one picked (click, tap or arrow
 * keys), else now. A table view holds the rest.
 */
export function HistoryChart({
  model,
  history,
  userId,
}: {
  model: CampaignModel;
  history: HistoryView;
  userId: string;
}) {
  const isDesktop = useIsDesktop();
  const [measure, setMeasure] = useState<Measure>('value');
  const [asTable, setAsTable] = useState(false);
  /** The round picked by a click, tap or key, which stays until another is picked. */
  const [picked, setPicked] = useState<number | null>(null);
  /** The round under the mouse. */
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [ref, width] = useElementWidth();
  const readoutId = useId();

  const { points } = history;
  const last = points.length - 1;
  const members = model.campaign.members;
  const highlight = hovered ?? pinned;

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex" role="group" aria-label="Measure">
        {(Object.keys(MEASURES) as Measure[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={measure === m}
            onClick={() => setMeasure(m)}
            className={`btn btn-sm -ml-px first:ml-0 first:rounded-r-none last:rounded-l-none ${
              measure === m ? 'border-paper bg-paper text-gunmetal' : 'btn-ghost'
            }`}
          >
            {MEASURES[m].label}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={asTable}
        onClick={() => setAsTable((v) => !v)}
        className="btn btn-ghost btn-sm"
      >
        {asTable ? 'Chart' : 'Table'}
      </button>
    </div>
  );

  if (last < 1) {
    return (
      <p className="text-[0.95rem] text-muted">
        The history starts with the first round: every empire’s size at the end of each round, and the wars that changed
        it.
      </p>
    );
  }

  const valueAt = (i: number, u: string) => points[i]![measure][u] ?? 0;
  const active = hover ?? picked;
  const shown = active ?? last;
  const me = model.membersById.get(userId);
  const lineOf = (u: string) => empireColor(model.membersById.get(u)?.color ?? 0).line;

  // This empire's wars that moved territory, by the round they ended in.
  const myWars = history.wars.filter((w) => w.transfers.some((t) => t.from === userId || t.to === userId));
  const warRounds = new Set(myWars.map((w) => w.round));

  if (asTable) {
    const columns = [...members].sort((a, b) => valueAt(last, b.userId) - valueAt(last, a.userId));
    return (
      <div className="space-y-3">
        {controls}
        <div className="max-h-[420px] overflow-auto rounded-[3px] border border-line">
          <table className="w-full text-[0.95rem] tabular-nums">
            <caption className="sr-only">{MEASURES[measure].caption}, most recent first</caption>
            <thead className="sticky top-0 bg-gunmetal">
              <tr>
                <th scope="col" className="label px-3 py-2 text-left">
                  Round
                </th>
                {columns.map((m) => (
                  <th key={m.userId} scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    {m.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {points
                .map((p, i) => ({ p, i }))
                .reverse()
                .map(({ p, i }) => (
                  <tr key={p.round}>
                    <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">
                      {roundLabel(p.round)}
                      {warRounds.has(p.round) && (
                        <span className="ml-1.5 text-[#ef7b72]" title="A war moved territory">
                          ⚑
                        </span>
                      )}
                    </th>
                    {columns.map((m) => (
                      <td
                        key={m.userId}
                        className={`px-3 py-1.5 text-right ${m.userId === userId ? 'font-semibold' : ''}`}
                      >
                        {valueAt(i, m.userId)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const plotH = isDesktop ? 220 : 170;
  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right);
  // Lines needn't start at zero: fit the range to the data, so a round's gains and losses show.
  const all = points.flatMap((_, i) => members.map((m) => valueAt(i, m.userId)));
  const [lo, hi] = [Math.min(...all), Math.max(...all)];
  const step = niceStep(Math.max(hi - lo, 4) / 4);
  const bottom = Math.max(0, Math.floor((lo - step / 2) / step) * step);
  const top = Math.ceil((hi + step / 2) / step) * step;
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, k) => bottom + k * step);
  const x = (i: number) => MARGIN.left + (i / last) * plotW;
  const y = (v: number) => MARGIN.top + plotH - ((v - bottom) / (top - bottom)) * plotH;
  const every = [1, 2, 5, 10, 20, 50, 100].find((k) => (plotW / last) * k >= 34) ?? 200;
  const path = (u: string) =>
    points.map((_, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(valueAt(i, u)).toFixed(1)}`).join('');

  const clamp = (i: number) => Math.max(0, Math.min(last, i));
  const roundAt = (e: PointerEvent<SVGSVGElement>) => {
    const left = e.currentTarget.getBoundingClientRect().left + MARGIN.left;
    return clamp(Math.round(((e.clientX - left) / Math.max(plotW, 1)) * last));
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse') setHover(roundAt(e));
    else if (e.buttons) setPicked(roundAt(e)); // a finger or pen dragging along the chart
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Escape') {
      setPicked(null);
      return;
    }
    const moves: Record<string, (at: number) => number> = {
      ArrowLeft: (at) => at - 1,
      ArrowRight: (at) => at + 1,
      Home: () => 0,
      End: () => last,
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    setPicked((at) => clamp(move(at ?? last)));
  };

  const others = members.filter((m) => m.userId !== userId && m.userId !== highlight);
  /** A picked round in words, for screen readers. */
  const pickedText = (i: number) =>
    `${readoutLabel(points[i]!.round)}: ${[...members]
      .sort((a, b) => valueAt(i, b.userId) - valueAt(i, a.userId))
      .map((m) => `${m.name} ${valueAt(i, m.userId)}`)
      .join(', ')}`;
  const rows = [...members]
    .map((m) => ({
      member: m,
      value: valueAt(shown, m.userId),
      change: shown > 0 ? valueAt(shown, m.userId) - valueAt(shown - 1, m.userId) : null,
    }))
    .sort((a, b) => b.value - a.value || a.member.name.localeCompare(b.member.name));
  const emphasized = [highlight, userId].filter((u): u is string => u !== null && u !== userId).concat(userId);

  return (
    <div className="space-y-3">
      {controls}
      <div ref={ref} style={{ height: plotH + MARGIN.top + MARGIN.bottom }}>
        {width > 0 && (
          <svg
            width={width}
            height={plotH + MARGIN.top + MARGIN.bottom}
            role="group"
            aria-label={`${MEASURES[measure].caption}. Use the arrow keys to step through the rounds, Escape to go back to now.`}
            aria-describedby={readoutId}
            tabIndex={0}
            className="touch-pan-y select-none focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber"
            onPointerMove={onMove}
            onPointerDown={(e) => setPicked(roundAt(e))}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(t)} y2={y(t)} className="stroke-line" />
                <text
                  x={MARGIN.left - 6}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-faint text-[11px] tabular-nums"
                >
                  {t}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              i % every === 0 ? (
                <text
                  key={p.round}
                  x={x(i)}
                  y={MARGIN.top + plotH + 18}
                  textAnchor="middle"
                  className="fill-faint text-[11px] tabular-nums"
                >
                  {roundLabel(p.round)}
                </text>
              ) : null,
            )}

            {others.map((m) => (
              <path
                key={m.userId}
                d={path(m.userId)}
                fill="none"
                stroke={CONTEXT_INK}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {emphasized.map((u) => (
              <path
                key={u}
                d={path(u)}
                fill="none"
                stroke={lineOf(u)}
                strokeWidth={u === userId ? 2.5 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {active !== null && (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={MARGIN.top}
                y2={MARGIN.top + plotH}
                stroke="rgb(228 226 216 / 0.35)"
              />
            )}
            {emphasized.map((u) =>
              // The round being read: a dot on each colored line, or a ring around a war marker.
              u === userId && warRounds.has(points[shown]!.round) ? (
                <circle
                  key={u}
                  cx={x(shown)}
                  cy={y(valueAt(shown, u))}
                  r={8}
                  fill="none"
                  stroke={lineOf(u)}
                  strokeWidth={2}
                />
              ) : (
                <circle
                  key={u}
                  cx={x(shown)}
                  cy={y(valueAt(shown, u))}
                  r={4}
                  fill={lineOf(u)}
                  stroke={SURFACE}
                  strokeWidth={2}
                />
              ),
            )}
            {points.map((p, i) =>
              warRounds.has(p.round) ? (
                <circle
                  key={p.round}
                  cx={x(i)}
                  cy={y(valueAt(i, userId))}
                  r={4.5}
                  stroke={SURFACE}
                  strokeWidth={2}
                  className="fill-grease"
                />
              ) : null,
            )}
            <text
              x={x(last) + 12}
              y={y(valueAt(last, userId))}
              dy="0.32em"
              className="fill-paper text-[12px] font-semibold tabular-nums"
            >
              {valueAt(last, userId)}
            </text>
          </svg>
        )}
      </div>

      <Readout
        id={readoutId}
        model={model}
        userId={userId}
        round={points[shown]!.round}
        now={shown === last}
        onNow={picked !== null && picked !== last ? () => setPicked(null) : undefined}
        rows={rows}
        lineOf={lineOf}
        highlight={highlight}
        onPin={(u) => setPinned((p) => (p === u ? null : u))}
        onHover={setHovered}
        wars={myWars.filter((w) => w.round === points[shown]!.round)}
        measure={measure}
      />
      {me && myWars.length > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" className="fill-grease" />
          </svg>
          A round in which {userId === model.me.userId ? 'you' : me.name} won or lost territory in a war
        </p>
      )}
      {/* Screen readers hear the rounds picked with the keys, not every move of a mouse. */}
      <p className="sr-only" aria-live="polite">
        {picked === null ? '' : pickedText(picked)}
      </p>
    </div>
  );
}

/** Every empire at one round, largest first; the legend too, since picking a row lights up its line. */
function Readout({
  id,
  model,
  userId,
  round,
  now,
  onNow,
  rows,
  lineOf,
  highlight,
  onPin,
  onHover,
  wars,
  measure,
}: {
  id: string;
  model: CampaignModel;
  userId: string;
  round: number;
  now: boolean;
  /** Back to the latest round, when an earlier one is picked. */
  onNow?: () => void;
  rows: { member: CampaignModel['me']; value: number; change: number | null }[];
  lineOf(userId: string): string;
  highlight: string | null;
  onPin(userId: string): void;
  onHover(userId: string | null): void;
  wars: HistoryWar[];
  measure: Measure;
}) {
  return (
    <div id={id} className="space-y-2">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <span className="label">
          {readoutLabel(round)}
          {now && round > 0 ? ' · now' : ''}
        </span>
        {onNow && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onNow}>
            Show now
          </button>
        )}
      </div>
      <ul className="divide-y divide-line rounded-[3px] border border-line">
        {rows.map(({ member, value, change }) => {
          const mine = member.userId === userId;
          const lit = mine || member.userId === highlight;
          const row = (
            <>
              <span
                className="h-0.5 w-4 shrink-0 rounded-full"
                style={{ background: lit ? lineOf(member.userId) : CONTEXT_INK }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <PlayerName member={member} you={member.userId === model.me.userId} size="sm" />
              </span>
              <span className="w-10 text-right text-xs text-muted tabular-nums">
                {change ? `${change > 0 ? '+' : '−'}${Math.abs(change)}` : ''}
              </span>
              <span className={`w-10 text-right tabular-nums ${mine ? 'font-bold' : 'font-semibold'}`}>{value}</span>
            </>
          );
          return (
            <li key={member.userId}>
              {mine ? (
                <div className="flex min-h-11 items-center gap-3 bg-raised/40 px-3">{row}</div>
              ) : (
                <button
                  type="button"
                  aria-pressed={member.userId === highlight}
                  aria-label={`${member.name}: ${value} ${measure === 'value' ? 'game value' : 'countries'}. Show their line.`}
                  onClick={() => onPin(member.userId)}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(member.userId)}
                  onPointerLeave={() => onHover(null)}
                  className="flex min-h-11 w-full items-center gap-3 px-3 text-left hover:bg-raised/60 aria-pressed:bg-raised/60"
                >
                  {row}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {wars.length > 0 && (
        <ul className="space-y-1 text-[0.95rem]">
          {wars.map((w) => (
            <li key={w.warId}>
              <Link
                href={`/c/${model.campaign.id}?war=${w.warId}`}
                className="inline-flex items-start gap-2 hover:underline"
              >
                <span className="text-[#ef7b72]" aria-hidden="true">
                  ⚑
                </span>
                <span>{warLine(model, w, userId)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Took Chad and Niger from Cy", "Lost Libya to Bo", "Paid Chad as tribute to Cy". */
function warLine(model: CampaignModel, war: HistoryWar, userId: string): string {
  const list = (ids: string[]) => {
    const names = ids.map((id) => countryName(model, id));
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
  };
  const gained = war.transfers.filter((t) => t.to === userId);
  const lost = war.transfers.filter((t) => t.from === userId);
  const tribute = war.outcome === 'tribute';
  if (gained.length > 0) {
    const from = playerName(model, gained[0]!.from);
    const what = list(gained.map((t) => t.territoryId));
    return tribute ? `Received ${what} as tribute from ${from}` : `Took ${what} from ${from}`;
  }
  const to = playerName(model, lost[0]!.to);
  const what = list(lost.map((t) => t.territoryId));
  return tribute ? `Paid ${what} as tribute to ${to}` : `Lost ${what} to ${to}`;
}
