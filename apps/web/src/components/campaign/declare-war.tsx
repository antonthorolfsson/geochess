'use client';

import {
  FORTIFY_COST,
  RESERVE_REJECTION_MESSAGES,
  TARGET_REJECTION_MESSAGES,
  accordBetween,
  blockedLaunchers,
  checkFortify,
  checkReserves,
  checkTarget,
  declarationFloor,
  fortifiedUntil,
  fortifyEnds,
  matchedRaiseRange,
  raiseFloor,
  reachableWithin,
  renunciationAgainst,
  reservesAllowed,
  stakeFloor,
  stakeableCountries,
  stakeableFromRound,
  truceBetween,
  valueOf,
  type Territory,
  type TerritoryId,
} from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { proposedWar } from '@/lib/outcomes';
import { keys } from '@/lib/queries';
import { playerName, tokensText, turnWaitText, warStatusText } from '@/lib/wars';
import { Notice, ValueBadge } from '../ui';
import { StakeBuilder, initialStake, stakeProblem, type StakeDraft, type StakeOptions } from './stake-builder';
import type { StakePreview } from './war-detail';
import { WarOutcomes, WarStakesNote } from './war-outcomes';

/**
 * The war side of a country's panel: the war it's caught up in, why it can't be attacked, or a
 * "Declare war" button that opens the stake builder.
 */
export function WarAction({
  model,
  territory,
  onOpenWar,
  onPreview,
}: {
  model: CampaignModel;
  territory: Territory;
  onOpenWar(warId: string): void;
  onPreview(preview: StakePreview | null): void;
}) {
  const { campaign, board } = model;
  const me = model.me.userId;
  const ownerId = model.owners.get(territory.id);
  const war = model.warOf.get(territory.id);
  const [building, setBuilding] = useState(false);
  useEffect(() => setBuilding(false), [territory.id]);
  // The turn moved on (or ran out) while the stake was being built.
  const turnRejection = model.turnRejection;
  useEffect(() => {
    if (turnRejection) setBuilding(false);
  }, [turnRejection]);

  if (campaign.status !== 'active' || !ownerId) return null;

  if (war) {
    return (
      <div className="flex items-center gap-3 rounded-[3px] border border-grease/60 bg-grease/10 px-3 py-2">
        <p className="min-w-0 flex-1 text-[0.95rem]">
          <strong>Caught up in a war.</strong> {warStatusText(model, war)}.
          <WarStakesNote model={model} war={war} className="block text-sm" />
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenWar(war.id)}>
          View war
        </button>
      </div>
    );
  }

  if (ownerId === me) {
    const from = stakeableFromRound(board, board.holdings.get(territory.id)!);
    return (
      <>
        {from && <p className="text-[0.95rem] text-muted">Newly won: it can be staked from round {from}.</p>}
        <Fortify model={model} territory={territory} />
      </>
    );
  }

  const until = fortifiedUntil(board, territory.id);
  const fortified = until ? (
    <p className="text-[0.95rem] text-muted">
      Fortified until round {until} starts: a war on it needs a stake of at least{' '}
      {declarationFloor(board, territory.id)}.
    </p>
  ) : null;
  const rejection = checkTarget(board, me, territory.id);
  if (rejection) {
    const owner = playerName(model, ownerId);
    const truce = rejection === 'truce' ? truceBetween(board, me, ownerId) : undefined;
    const accord = rejection === 'accord' ? accordBetween(board, me, ownerId) : undefined;
    const renounced = rejection === 'renounced' ? renunciationAgainst(board, me, ownerId) : undefined;
    return (
      <>
        {fortified}
        <p className="text-[0.95rem] text-muted">
          {truce
            ? `You have a truce with ${owner} until round ${truce.endsRound}.`
            : accord
              ? `You have an accord with ${owner}: no war between you until round ${accord.endsRound} starts.`
              : renounced
                ? `You broke your accord with ${owner}, so you can't declare war on them until round ${renounced.untilRound} starts.`
                : rejection === 'no-launcher'
                  ? noLauncherText(model, territory.id)
                  : rejection === 'stake-too-small'
                    ? `A war on it needs a stake worth at least ${declarationFloor(board, territory.id)}, and your countries bordering it can't raise that much.`
                    : TARGET_REJECTION_MESSAGES[rejection]}
        </p>
      </>
    );
  }
  if (model.tokens < 1) {
    return (
      <>
        {fortified}
        <p className="text-[0.95rem] text-muted">You have no war tokens. The next round brings one.</p>
      </>
    );
  }
  const wait = turnWaitText(model);
  if (wait) {
    return (
      <>
        {fortified}
        <p className="text-[0.95rem] text-muted">{wait}</p>
      </>
    );
  }
  if (!building) {
    return (
      <>
        {fortified}
        <button type="button" className="btn btn-war w-full" onClick={() => setBuilding(true)}>
          Declare war
        </button>
      </>
    );
  }
  return (
    <DeclareForm
      model={model}
      territory={territory}
      onCancel={() => setBuilding(false)}
      onDeclared={onOpenWar}
      onPreview={onPreview}
    />
  );
}

/**
 * "None of your countries bordering it can launch an attack: Russia is caught up in a war; Sweden
 * was newly won and can be staked from round 5."
 */
function noLauncherText(model: CampaignModel, targetId: TerritoryId): string {
  const names = (ids: TerritoryId[]) => {
    const list = ids.map((id) => model.board.idx.byId.get(id)?.name ?? id);
    return list.length === 1 ? list[0]! : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
  };
  const blocks = blockedLaunchers(model.board, model.me.userId, targetId);
  const busy = blocks.filter((b) => b.reason === 'in-war').map((b) => b.id);
  const fresh = new Map<number, TerritoryId[]>();
  for (const b of blocks)
    if (b.reason === 'newly-won') fresh.set(b.fromRound, [...(fresh.get(b.fromRound) ?? []), b.id]);
  const reasons: string[] = [];
  if (busy.length)
    reasons.push(`${names(busy)} ${busy.length === 1 ? 'is caught up in a war' : 'are caught up in wars'}`);
  for (const [round, ids] of [...fresh].sort(([a], [b]) => a - b)) {
    reasons.push(`${names(ids)} ${ids.length === 1 ? 'was' : 'were'} newly won and can be staked from round ${round}`);
  }
  return `None of your countries bordering it can launch an attack: ${reasons.join('; ')}.`;
}

function DeclareForm({
  model,
  territory,
  onCancel,
  onDeclared,
  onPreview,
}: {
  model: CampaignModel;
  territory: Territory;
  onCancel(): void;
  onDeclared(warId: string): void;
  onPreview(preview: StakePreview | null): void;
}) {
  const queryClient = useQueryClient();
  const opts: StakeOptions = useMemo(
    () => ({ minValue: declarationFloor(model.board, territory.id) }),
    [model.board, territory.id],
  );
  const [draft, setDraft] = useState<StakeDraft | null>(() => initialStake(model, territory.id, opts));
  const [reserves, setReserves] = useState<TerritoryId[]>([]);
  useEffect(() => {
    onPreview(draft ? { targetId: territory.id, ...draft } : null);
    return () => onPreview(null);
  }, [draft, territory.id, onPreview]);
  // Reserves stay joined to the stake: any it no longer reaches (or that moved into it) drop out.
  const kept = useMemo(() => {
    if (!draft) return [];
    const inStake = new Set(draft.stake);
    const joined = reachableWithin(model.idx, draft.launchId, new Set([...draft.stake, ...reserves]));
    return reserves.filter((id) => !inStake.has(id) && joined.has(id));
  }, [draft, reserves, model.idx]);

  const declare = useMutation({
    mutationFn: (d: StakeDraft) =>
      api.declareWar(model.campaign.id, {
        targetId: territory.id,
        launchId: d.launchId,
        stake: d.stake,
        ...(kept.length > 0 ? { reserves: kept } : {}),
      }),
    onSuccess: ({ id }) => onDeclared(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(model.campaign.id) }),
  });

  const war = useMemo(
    () => (draft ? proposedWar(model, territory.id, draft, kept) : null),
    [model, territory.id, draft, kept],
  );

  if (!draft || !war) return <Notice tone="error">No stake can be built against {territory.name} right now.</Notice>;
  const problem =
    stakeProblem(model, territory.id, draft, opts) ??
    ((rejection) => rejection && RESERVE_REJECTION_MESSAGES[rejection])(
      checkReserves(model.board, model.me.userId, draft.launchId, draft.stake, kept),
    );

  return (
    <div className="space-y-4 rounded-[3px] border border-grease/60 p-3">
      <div className="space-y-2">
        <div className="font-stencil text-xl tracking-wide text-[#ef7b72]">Declare war on {territory.name}</div>
        <DeclarationTerms model={model} territory={territory} minValue={opts.minValue} />
      </div>
      <StakeBuilder model={model} targetId={territory.id} opts={opts} draft={draft} onChange={setDraft} />
      {reservesAllowed(model.campaign.rules) && (
        <Reserves model={model} territory={territory} draft={draft} reserves={kept} onChange={setReserves} />
      )}
      <WarOutcomes model={model} war={war} heading="What declaring could change" />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-war flex-1"
          disabled={problem !== null || declare.isPending}
          onClick={() => declare.mutate(draft)}
        >
          {declare.isPending ? 'Declaring…' : 'Declare war'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {declare.error && <Notice tone="error">{errorMessage(declare.error)}</Notice>}
    </div>
  );
}

/**
 * What declaring costs and binds you to, before any stake is chosen: the war token, the least
 * stake (and why, if the target is fortified), and what follows the war whatever its result.
 */
function DeclarationTerms({
  model,
  territory,
  minValue,
}: {
  model: CampaignModel;
  territory: Territory;
  minValue: number;
}) {
  const { rules } = model.campaign;
  const defender = playerName(model, model.owners.get(territory.id)!);
  const until = fortifiedUntil(model.board, territory.id);
  const base = stakeFloor(rules, territory.value);
  const { truceRounds, lockRounds } = rules.war;
  const rounds = (n: number) => `${n} ${n === 1 ? 'round' : 'rounds'}`;
  const after = [
    truceRounds > 0 &&
      `a truce with ${defender} for ${rounds(truceRounds)} once it ends (unless the war is called off or withdrawn)`,
    lockRounds > 0 && `countries that change hands can be staked again ${rounds(lockRounds)} later`,
  ].filter(Boolean);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="label pt-0.5">Cost</dt>
      <dd className="text-muted">
        {model.tokens === 1 ? 'Your last war token' : `1 of your ${tokensText(model.tokens)}`}, spent however the war
        ends
        {model.turns ? '; declaring also takes your turn' : ''}.
      </dd>
      <dt className="label pt-0.5">Least stake</dt>
      <dd className="text-muted">
        <strong className="text-paper tabular-nums">{minValue}</strong>
        {until
          ? `: ${territory.name} is fortified until round ${until} starts, so ${rules.war.raisePct}% of its ${territory.value} (${base} otherwise).`
          : `: ${rules.war.stakeFloorPct}% of ${territory.name}’s ${territory.value}. If ${defender} wins the game, they take the whole stake.`}
      </dd>
      {after.length > 0 && (
        <>
          <dt className="label pt-0.5">After</dt>
          <dd className="text-muted">{`${after.join('; ')}.`.replace(/^./, (c) => c.toUpperCase())}</dd>
        </>
      )}
    </dl>
  );
}

/**
 * Countries set aside at the declaration to meet a raise at once: joined to the stake, and tied up
 * until the defender's answer is settled.
 */
function Reserves({
  model,
  territory,
  draft,
  reserves,
  onChange,
}: {
  model: CampaignModel;
  territory: Territory;
  draft: StakeDraft;
  reserves: TerritoryId[];
  onChange(reserves: TerritoryId[]): void;
}) {
  const { idx, board } = model;
  const stakeable = useMemo(() => stakeableCountries(board, model.me.userId), [board, model.me.userId]);
  const taken = new Set([...draft.stake, ...reserves]);
  const frontier = [...new Set([...taken].flatMap((id) => idx.neighbors(id)))]
    .filter((id) => stakeable.has(id) && !taken.has(id))
    .sort((a, b) => (idx.byId.get(b)?.value ?? 0) - (idx.byId.get(a)?.value ?? 0));
  const name = (id: TerritoryId) => idx.byId.get(id)?.name ?? id;
  const range = matchedRaiseRange(territory.value);
  const what =
    model.campaign.rules.war.raise === 'matched'
      ? `A raise puts in one of ${playerName(model, model.owners.get(territory.id)!)}'s countries worth ${range.min} to ${range.max}, which you must match.`
      : `A raise demands a stake of ${raiseFloor(model.campaign.rules, territory.value)}.`;
  const remove = (id: TerritoryId) => onChange(reserves.filter((r) => r !== id));

  return (
    <details className="rounded-[3px] border border-line px-3 py-2" open={reserves.length > 0}>
      <summary className="min-h-9 cursor-pointer content-center font-semibold">
        Reserves{reserves.length > 0 ? ` · worth ${valueOf(idx, reserves)}` : ''}
      </summary>
      <div className="space-y-2 pt-2">
        <p className="text-sm text-muted">
          {what} Countries you set aside meet it at once, as far as they reach, so the war goes ahead without waiting
          for you. They&apos;re tied up until the answer is settled; anything a raise doesn&apos;t need is free again.
        </p>
        {reserves.length > 0 && (
          <ul className="divide-y divide-line rounded-[3px] border border-line">
            {reserves.map((id) => (
              <li key={id} className="flex min-h-11 items-center gap-2 px-3">
                <span className="min-w-0 flex-1 truncate">{name(id)}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(id)}>
                  Remove
                </button>
                <ValueBadge value={idx.byId.get(id)?.value ?? 0} />
              </li>
            ))}
          </ul>
        )}
        {frontier.length > 0 && (
          <ul className="max-h-40 divide-y divide-line overflow-y-auto rounded-[3px] border border-line">
            {frontier.map((id) => (
              <li key={id} className="flex min-h-11 items-center gap-2 px-3">
                <span className="min-w-0 flex-1 truncate text-muted">{name(id)}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...reserves, id])}>
                  Set aside
                </button>
                <ValueBadge value={idx.byId.get(id)?.value ?? 0} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/** Fortifying one of your countries: a war token makes war on it need a raised stake for a while. */
function Fortify({ model, territory }: { model: CampaignModel; territory: Territory }) {
  const queryClient = useQueryClient();
  const fortify = useMutation({
    mutationFn: () => api.fortify(model.campaign.id, territory.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(model.campaign.id) }),
  });
  const { reset } = fortify;
  useEffect(() => reset(), [territory.id, reset]);
  if (!model.campaign.rules.war.fortify) return null;
  const board = model.board;
  const until = fortifiedUntil(board, territory.id);
  const rejection = checkFortify(board, model.me.userId, territory.id);
  const ends = fortifyEnds(board.round);
  const needs = Math.max(
    raiseFloor(model.campaign.rules, territory.value),
    declarationFloor({ ...board, holdings: new Map() }, territory.id),
  );
  // Only on your turn, where the campaign takes turns.
  const wait = rejection === null ? turnWaitText(model) : null;
  return (
    <div className="space-y-2 rounded-[3px] border border-line px-3 py-2">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[0.95rem]">
          {until ? (
            <>
              <strong>Fortified</strong> until round {until} starts: a war on it needs a stake of at least {needs}.
            </>
          ) : (
            <>
              Fortify for {tokensText(FORTIFY_COST)}: until round {ends} starts, a war on it needs a stake of at least{' '}
              {needs}.
            </>
          )}
        </p>
        {rejection !== 'fortified' && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={fortify.isPending || model.tokens < FORTIFY_COST || rejection !== null || wait !== null}
            title={model.tokens < FORTIFY_COST ? 'You have no war tokens.' : (wait ?? undefined)}
            onClick={() => fortify.mutate()}
          >
            {until ? `Extend to round ${ends}` : 'Fortify'}
          </button>
        )}
      </div>
      {wait && model.tokens >= FORTIFY_COST && (
        <p className="text-sm text-muted">
          {model.turnRejection === 'turns-over' ? wait : `Fortifying takes your turn. ${wait}`}
        </p>
      )}
      {fortify.error && <Notice tone="error">{errorMessage(fortify.error)}</Notice>}
    </div>
  );
}
