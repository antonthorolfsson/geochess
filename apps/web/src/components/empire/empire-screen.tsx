'use client';

import type { Acquisition, CampaignStats, StatKey, Territory, TerritoryId } from '@empire/rules';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '@/lib/api';
import { totalValue, type CampaignModel } from '@/lib/campaign';
import { empireFigures, formatShare, valueRank, type EmpireFigure } from '@/lib/empire';
import { formatArea, formatAreaCompact, formatCount, formatUsd, ordinal } from '@/lib/format';
import { useCampaignStats } from '@/lib/queries';
import { playerName } from '@/lib/wars';
import { useCampaignRoom, useEmpireHref } from '../campaign/room-context';
import { EmpireSwatch } from '../hatch';
import { Notice, Spinner, ValueBadge } from '../ui';
import { ChessProfileView } from './chess-profile';
import { HistoryChart } from './history-chart';
import { WarRecordView } from './war-record';

const FIGURES: { key: StatKey; label: string; format(n: number | null): string }[] = [
  { key: 'population', label: 'Population', format: formatCount },
  { key: 'gdpNominalUsd', label: 'GDP', format: formatUsd },
  { key: 'gdpPppUsd', label: 'GDP (PPP)', format: formatUsd },
  { key: 'areaKm2', label: 'Area', format: formatAreaCompact },
  { key: 'militarySpendingUsd', label: 'Military spending', format: formatUsd },
  { key: 'armedForces', label: 'Armed forces', format: formatCount },
];

/** The comparisons spelled out, as "<whose> <noun> would rank …". */
const COMPARISONS: { key: StatKey; noun: string; by?: string }[] = [
  { key: 'gdpNominalUsd', noun: 'economy' },
  { key: 'population', noun: 'population' },
  { key: 'areaKm2', noun: 'territory', by: ' by area' },
  { key: 'militarySpendingUsd', noun: 'military spending' },
];

/** One empire's statistics page, over the campaign screen. Every member can see every empire's. */
export function EmpireScreen({ userId }: { userId: string }) {
  const { model, showCountry } = useCampaignRoom();
  const stats = useCampaignStats(model.campaign.id);
  const member = model.membersById.get(userId);
  if (!member) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <Notice>This player isn’t part of the campaign.</Notice>
        <Link href={`/c/${model.campaign.id}`} className="btn btn-ghost">
          Back to the map
        </Link>
      </div>
    );
  }
  const record = stats.data?.empires.find((e) => e.userId === userId);
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
      <EmpireHeader model={model} userId={userId} />
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        <Section title="Real-world totals">
          <Totals model={model} userId={userId} />
        </Section>
        <Section title="History" note="Game value at the end of each round">
          {stats.data ? <HistoryChart model={model} history={stats.data.history} userId={userId} /> : pending}
        </Section>
        <Section title="War record">
          {record ? (
            <WarRecordView
              model={model}
              record={record.wars}
              accords={record.accords}
              reputation={member.reputation}
              onShowCountry={showCountry}
            />
          ) : (
            pending
          )}
        </Section>
        <Section title="Chess profile">
          {record ? <ChessProfileView model={model} profile={record.chess} userId={userId} /> : pending}
        </Section>
      </div>
      <Section title="Countries">
        <Countries model={model} userId={userId} stats={stats.data} onShowCountry={showCountry} />
      </Section>
      <p className="border-t border-line pt-4 text-xs text-faint">
        Country data: World Bank World Development Indicators (CC BY 4.0) and Natural Earth. Figures marked est. include
        estimates. Opening names: the Lichess openings list (public domain).
      </p>
    </article>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-line pt-4">
      <h2 className="text-xl font-bold">{title}</h2>
      {note && <p className="text-sm text-muted">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmpireHeader({ model, userId }: { model: CampaignModel; userId: string }) {
  const { campaign } = model;
  const empireHref = useEmpireHref(campaign.id);
  // The link that opened the page is now out of reach under it, so focus starts on the heading.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), [userId]);
  const member = model.membersById.get(userId)!;
  const ids = model.holdingsByUser.get(userId) ?? [];
  const { rank, of } = valueRank(model.idx, model.holdingsByUser, userId);
  const you = userId === model.me.userId;
  const facts = [
    `${ids.length} ${ids.length === 1 ? 'country' : 'countries'}`,
    `value ${totalValue(model.idx, ids)}`,
    ...(campaign.status === 'lobby' ? [] : [`reputation ${member.reputation}`]),
    ...(campaign.status === 'active' ? [`${member.tokens} war ${member.tokens === 1 ? 'token' : 'tokens'}`] : []),
  ];
  const others = campaign.members.filter((m) => m.userId !== userId);
  return (
    <header className="space-y-3">
      <div>
        <div className="label">Empire{campaign.status === 'lobby' ? '' : ` · ${ordinal(rank)} of ${of} by value`}</div>
        <h1 ref={heading} tabIndex={-1} className="flex min-w-0 items-center gap-3 focus:outline-none">
          <EmpireSwatch color={member.color} size={28} className="shrink-0" />
          <span className="truncate font-stencil text-[2rem] leading-tight tracking-wide">{member.name}</span>
          {you && <span className="shrink-0 text-xs font-bold tracking-widest text-muted uppercase">you</span>}
        </h1>
        <p className="text-[0.95rem] text-muted">{facts.join(' · ')}</p>
      </div>
      {others.length > 0 && (
        <nav aria-label="Other empires" className="flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">Other empires</span>
          {others.map((m) => (
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

function Totals({ model, userId }: { model: CampaignModel; userId: string }) {
  const ids = model.holdingsByUser.get(userId) ?? [];
  if (ids.length === 0) {
    return (
      <p className="text-[0.95rem] text-muted">
        {model.campaign.status === 'lobby' ? 'Empires take shape in the draft.' : 'No countries, so nothing to count.'}
      </p>
    );
  }
  const figures = empireFigures(model.idx, model.holdingsByUser, userId);
  const empires = model.campaign.members.length;
  const whose = userId === model.me.userId ? 'Your' : `${playerName(model, userId)}’s`;
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
        {FIGURES.map(({ key, label, format }) => (
          <Figure key={key} label={label} figure={figures[key]} format={format} empires={empires} />
        ))}
      </dl>
      <ul className="space-y-1 border-l-2 border-amber/60 pl-3 text-[0.95rem]">
        {COMPARISONS.map(({ key, noun, by = '' }) => {
          const f = figures[key];
          if (f.worldRank === null) return null;
          const around =
            f.above && f.below
              ? `, between ${f.above.name} and ${f.below.name}`
              : f.below
                ? `, ahead of ${f.below.name}`
                : f.above
                  ? `, behind ${f.above.name}`
                  : '';
          return (
            <li key={key}>
              {whose} {noun} would rank {ordinal(f.worldRank)} in the world{by}
              {around}.
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Figure({
  label,
  figure,
  format,
  empires,
}: {
  label: string;
  figure: EmpireFigure;
  format(n: number | null): string;
  empires: number;
}) {
  const notes = [
    figure.share !== null ? `${formatShare(figure.share)} of the world` : null,
    figure.worldRank !== null ? `${ordinal(figure.worldRank)} in the world` : null,
    figure.empireRank !== null && empires > 1 ? `${ordinal(figure.empireRank)} of ${empires} empires` : null,
    figure.missing > 0 && figure.total !== null
      ? `no figure for ${figure.missing} ${figure.missing === 1 ? 'country' : 'countries'}`
      : null,
  ].filter(Boolean);
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd>
        <span className="text-2xl font-semibold">{format(figure.total)}</span>
        {figure.estimated > 0 && figure.total !== null && (
          <abbr
            title={`Includes estimates for ${figure.estimated} ${figure.estimated === 1 ? 'country' : 'countries'}`}
            className="ml-1 align-super text-[0.7rem] font-bold text-amber no-underline"
          >
            est.
          </abbr>
        )}
        {notes.map((n) => (
          <span key={n} className="block text-xs text-muted">
            {n}
          </span>
        ))}
      </dd>
    </div>
  );
}

type SortKey = 'name' | 'value' | 'population' | 'gdpNominalUsd' | 'areaKm2';

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'name', label: 'Country' },
  { key: 'value', label: 'Value' },
  { key: 'population', label: 'Population' },
  { key: 'gdpNominalUsd', label: 'GDP' },
  { key: 'areaKm2', label: 'Area', className: 'hidden sm:table-cell' },
];

function acquisitionText(model: CampaignModel, id: TerritoryId, a: Acquisition | undefined): string {
  // Right after a war the map can be ahead of the statistics: say only what the map knows.
  const changedHands = model.campaign.acquired[id];
  if (changedHands && a?.via !== 'war' && a?.via !== 'tribute') return `Changed hands in round ${changedHands}`;
  if (!a) return '';
  if (a.via === 'draft') return a.pick === null ? 'Drafted' : `Drafted, pick ${a.pick + 1}`;
  const from = playerName(model, a.from);
  return a.via === 'tribute' ? `Tribute from ${from}, round ${a.round}` : `Won from ${from}, round ${a.round}`;
}

function Countries({
  model,
  userId,
  stats,
  onShowCountry,
}: {
  model: CampaignModel;
  userId: string;
  stats: CampaignStats | undefined;
  onShowCountry(id: TerritoryId): void;
}) {
  const [sort, setSort] = useState<SortKey>('value');
  const territories = (model.holdingsByUser.get(userId) ?? []).flatMap((id) => model.idx.byId.get(id) ?? []);
  if (territories.length === 0) return <p className="text-[0.95rem] text-muted">No countries yet.</p>;
  const figure = (t: Territory, key: SortKey) =>
    key === 'name' ? 0 : key === 'value' ? t.value : (t.stats[key] ?? -1);
  const sorted = [...territories].sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : figure(b, sort) - figure(a, sort) || b.value - a.value || a.name.localeCompare(b.name),
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[0.95rem] tabular-nums">
        <caption className="sr-only">
          {playerName(model, userId)}’s countries, sorted by {COLUMNS.find((c) => c.key === sort)!.label.toLowerCase()}
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort === c.key ? (c.key === 'name' ? 'ascending' : 'descending') : undefined}
                className={`pb-1 ${c.key === 'name' ? 'text-left' : 'pl-3 text-right'} ${c.className ?? ''}`}
              >
                <button
                  type="button"
                  onClick={() => setSort(c.key)}
                  className={`label min-h-9 hover:text-paper ${sort === c.key ? 'text-paper' : ''}`}
                >
                  {c.label}
                  {sort === c.key && <span aria-hidden="true">{c.key === 'name' ? ' ↑' : ' ↓'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((t) => (
            <tr key={t.id}>
              <td className="max-w-0 py-1.5 pr-2">
                <button
                  type="button"
                  onClick={() => onShowCountry(t.id)}
                  className="block max-w-full truncate text-left font-semibold hover:underline"
                >
                  {t.name}
                </button>
                <span className="block truncate text-xs text-muted">
                  {acquisitionText(model, t.id, stats?.acquisitions[t.id])}
                </span>
              </td>
              <td className="py-1.5 pl-3 text-right">
                <ValueBadge value={t.value} />
              </td>
              <td className="py-1.5 pl-3 text-right">{formatCount(t.stats.population)}</td>
              <td className="py-1.5 pl-3 text-right">{formatUsd(t.stats.gdpNominalUsd)}</td>
              <td className="hidden py-1.5 pl-3 text-right sm:table-cell">{formatArea(t.stats.areaKm2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
