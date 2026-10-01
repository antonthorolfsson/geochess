'use client';

import {
  STAKE_REJECTION_MESSAGES,
  checkStake,
  clockModifiers,
  ratingHandicap,
  launchersFor,
  reachableWithin,
  stakeableCountries,
  suggestStake,
  valueOf,
  type TerritoryId,
} from '@empire/rules';
import { useMemo } from 'react';
import type { CampaignModel } from '@/lib/campaign';
import { handicapLine } from '@/lib/rules-text';
import { ValueBadge } from '../ui';

export interface StakeDraft {
  launchId: TerritoryId;
  /** The launching country first. */
  stake: TerritoryId[];
}

export interface StakeOptions {
  /** The least the stake may be worth: the stake floor, or what a raise demands. */
  minValue: number;
  /** Rework this war's own stake (a raise), which the war itself locks. */
  exceptWarId?: string;
  /** Keep this launching country (a raise can't change it). */
  launchId?: TerritoryId;
}

/** The cheapest stake to start from, or null when none is possible. */
export function initialStake(model: CampaignModel, targetId: TerritoryId, opts: StakeOptions): StakeDraft | null {
  const plan = suggestStake(model.board, model.me.userId, targetId, opts);
  return plan && { launchId: plan.launchId, stake: plan.stake };
}

/** Why the stake can't be used, or null. */
export function stakeProblem(
  model: CampaignModel,
  targetId: TerritoryId,
  draft: StakeDraft,
  opts: StakeOptions,
): string | null {
  const rejection = checkStake(model.board, model.me.userId, targetId, draft.launchId, draft.stake, opts);
  return rejection && STAKE_REJECTION_MESSAGES[rejection];
}

/**
 * Builds a stake: the launching country plus connected countries. Removing a country also drops
 * any it was connecting, so the stake stays in one piece.
 */
export function StakeBuilder({
  model,
  targetId,
  opts,
  draft,
  onChange,
}: {
  model: CampaignModel;
  targetId: TerritoryId;
  opts: StakeOptions;
  draft: StakeDraft;
  onChange(draft: StakeDraft): void;
}) {
  const { board, idx } = model;
  const me = model.me.userId;
  const target = idx.byId.get(targetId)!;
  const launchers = useMemo(
    () => (opts.launchId ? [opts.launchId] : launchersFor(board, me, targetId, opts)),
    [board, me, targetId, opts],
  );
  const stakeable = useMemo(() => stakeableCountries(board, me, opts.exceptWarId), [board, me, opts.exceptWarId]);
  const inStake = new Set(draft.stake);
  const frontier = [
    ...new Set(draft.stake.flatMap((id) => idx.neighbors(id)).filter((id) => stakeable.has(id) && !inStake.has(id))),
  ].sort((a, b) => (idx.byId.get(b)?.value ?? 0) - (idx.byId.get(a)?.value ?? 0));
  const value = valueOf(idx, draft.stake);
  const problem = stakeProblem(model, targetId, draft, opts);
  const modifiers = clockModifiers(board, me, targetId);
  const defenderId = board.holdings.get(targetId)?.ownerId;
  const defender = defenderId ? model.membersById.get(defenderId) : undefined;
  const handicap = ratingHandicap(model.campaign.rules.war, model.me.rating?.rating, defender?.rating?.rating);

  const remove = (id: TerritoryId) => {
    const rest = new Set(draft.stake.filter((s) => s !== id));
    const connected = reachableWithin(idx, draft.launchId, rest);
    onChange({ launchId: draft.launchId, stake: draft.stake.filter((s) => connected.has(s)) });
  };
  const add = (id: TerritoryId) => onChange({ launchId: draft.launchId, stake: [...draft.stake, id] });
  const relaunch = (launchId: TerritoryId) => {
    const plan = suggestStake(board, me, targetId, { ...opts, launchId });
    onChange(plan ? { launchId, stake: plan.stake } : { launchId, stake: [launchId] });
  };

  const name = (id: TerritoryId) => idx.byId.get(id)?.name ?? id;
  const enough = value >= opts.minValue;

  return (
    <div className="space-y-4">
      {launchers.length > 1 && (
        <fieldset>
          <legend className="label mb-1">Attack from</legend>
          <div className="flex flex-wrap gap-1.5">
            {launchers.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={draft.launchId === id}
                onClick={() => relaunch(id)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-[3px] border px-3 text-[0.95rem] ${
                  draft.launchId === id ? 'border-paper bg-raised' : 'border-line-strong hover:bg-raised'
                }`}
              >
                {name(id)} <span className="text-muted tabular-nums">{idx.byId.get(id)?.value}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="label">Stake</span>
          <span className={`text-sm tabular-nums ${enough ? 'text-muted' : 'text-amber'}`}>
            Worth <strong className="text-paper">{value}</strong> · needs {opts.minValue} · target {target.value}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gunmetal" aria-hidden="true">
          <div
            className={`h-full ${enough ? 'bg-paper' : 'bg-amber'}`}
            style={{ width: `${Math.min(100, (value / Math.max(opts.minValue, target.value, value)) * 100)}%` }}
          />
        </div>
        <ul className="mt-2 divide-y divide-line rounded-[3px] border border-line">
          {draft.stake.map((id) => (
            <li key={id} className="flex min-h-11 items-center gap-2 px-3">
              <span className="min-w-0 flex-1 truncate">{name(id)}</span>
              {id === draft.launchId ? (
                <span className="label">Attacks from</span>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(id)}>
                  Remove
                </button>
              )}
              <ValueBadge value={idx.byId.get(id)?.value ?? 0} />
            </li>
          ))}
        </ul>
      </div>

      {frontier.length > 0 && (
        <div>
          <div className="label mb-1">Connected countries you can add</div>
          <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-[3px] border border-line">
            {frontier.map((id) => (
              <li key={id} className="flex min-h-11 items-center gap-2 px-3">
                <span className="min-w-0 flex-1 truncate text-muted">{name(id)}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => add(id)}>
                  Add
                </button>
                <ValueBadge value={idx.byId.get(id)?.value ?? 0} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <ClockPreview parts={modifiers.parts} net={modifiers.net} />
      {handicap && defender && (
        <p className="text-sm text-muted">
          <span className="label mr-2">Handicap</span>
          {handicapLine(handicap, model.campaign.rules.war.pace, { attacker: 'You', defender: defender.name })}
        </p>
      )}
      {problem && <p className="text-sm text-amber">{problem}</p>}
    </div>
  );
}

/** The clock modifiers a war would get, in a line. */
export function ClockPreview({ parts, net }: ReturnType<typeof clockModifiers>) {
  if (parts.length === 0) return null;
  const who = net > 0 ? `Defender +${net}% time` : net < 0 ? `Attacker +${-net}% time` : 'Even clocks';
  return (
    <p className="text-sm text-muted">
      <span className="label mr-2">Clock</span>
      {who} ({parts.map((p) => `${p.label.toLowerCase()} ${p.side === 'defender' ? '+' : '−'}${p.pct}%`).join(', ')})
    </p>
  );
}
