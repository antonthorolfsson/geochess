'use client';

import type { StatKey, TerritoryId } from '@empire/rules';
import Link from 'next/link';
import { totalValue, type CampaignModel } from '@/lib/campaign';
import { formatArea, formatCount, formatUsd, ordinal } from '@/lib/format';
import { Stat, ValueBadge } from '../ui';
import { PlayerName } from './player-name';
import { useCompareHref, useEmpireHref } from './room-context';

/** A first look at the player's empire, with a link to its full statistics page. */
export function EmpirePanel({ model, onSelect }: { model: CampaignModel; onSelect(id: TerritoryId): void }) {
  const empireHref = useEmpireHref(model.campaign.id);
  const compareHref = useCompareHref(model.campaign.id);
  const ids = model.holdingsByUser.get(model.me.userId) ?? [];
  const all = model.idx.dataset.territories;
  const mine = ids
    .flatMap((id) => model.idx.byId.get(id) ?? [])
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  /** Total over the holdings, or null when none of them has the figure. */
  const sum = (key: StatKey) => {
    const known = mine.map((t) => t.stats[key]).filter((v): v is number => v !== null);
    return known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;
  };
  const share = (key: StatKey) => {
    const mineTotal = sum(key);
    const world = all.reduce((s, t) => s + (t.stats[key] ?? 0), 0);
    return mineTotal !== null && world > 0 ? `${((mineTotal / world) * 100).toFixed(1)}% of the world` : undefined;
  };
  /** Where the empire would rank among the world's countries on this figure. */
  const rank = (key: StatKey) => {
    const mineTotal = sum(key);
    return mineTotal === null ? null : all.filter((t) => (t.stats[key] ?? 0) > mineTotal).length + 1;
  };
  const comparisons = [
    { key: 'gdpNominalUsd', text: (r: string) => `Your economy would rank ${r} in the world.` },
    { key: 'population', text: (r: string) => `Your population would rank ${r} in the world.` },
    { key: 'areaKm2', text: (r: string) => `Your territory would rank ${r} in the world by area.` },
  ] as const;

  return (
    <div className="space-y-6 p-4">
      <header className="space-y-3">
        <div>
          <div className="label mb-1">Your empire</div>
          <PlayerName member={model.me} size="lg" />
        </div>
        {model.campaign.status !== 'lobby' && (
          <div className="flex flex-wrap gap-2">
            <Link href={empireHref(model.me.userId)} className="btn btn-ghost btn-sm">
              Full statistics
            </Link>
            <Link href={compareHref} className="btn btn-ghost btn-sm">
              Compare empires
            </Link>
          </div>
        )}
      </header>

      {mine.length === 0 ? (
        <p className="text-[0.95rem] text-muted">
          {model.campaign.status === 'lobby'
            ? 'Your empire takes shape in the draft. Browse the map to plan your picks.'
            : "You don't hold any countries yet."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Stat label="Countries" value={mine.length} />
            <Stat label="Game value" value={totalValue(model.idx, ids)} />
            <Stat label="Population" value={formatCount(sum('population'))} note={share('population')} />
            <Stat label="GDP" value={formatUsd(sum('gdpNominalUsd'))} note={share('gdpNominalUsd')} />
            <Stat label="GDP (PPP)" value={formatUsd(sum('gdpPppUsd'))} note={share('gdpPppUsd')} />
            <Stat label="Area" value={formatArea(sum('areaKm2'))} note={share('areaKm2')} />
            <Stat label="Military spending" value={formatUsd(sum('militarySpendingUsd'))} />
            <Stat label="Armed forces" value={formatCount(sum('armedForces'))} />
          </div>
          <ul className="space-y-1 border-l-2 border-amber/60 pl-3 text-[0.95rem]">
            {comparisons.map(({ key, text }) => {
              const r = rank(key);
              return r === null ? null : <li key={key}>{text(ordinal(r))}</li>;
            })}
          </ul>
          <section>
            <h2 className="label mb-2">Holdings</h2>
            <ul className="divide-y divide-line rounded-[3px] border border-line">
              {mine.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(t.id)}
                    className="flex min-h-11 w-full items-center gap-3 px-3 text-left hover:bg-raised"
                  >
                    <span className="flex-1 truncate">{t.name}</span>
                    <span className="text-sm text-muted tabular-nums">{formatCount(t.stats.population)}</span>
                    <ValueBadge value={t.value} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <p className="text-xs text-faint">
        Country data: World Bank World Development Indicators (CC BY 4.0) and Natural Earth. Figures marked est. are
        estimates.
      </p>
    </div>
  );
}
