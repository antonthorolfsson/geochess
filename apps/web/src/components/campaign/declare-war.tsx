'use client';

import {
  TARGET_REJECTION_MESSAGES,
  accordBetween,
  checkTarget,
  renunciationAgainst,
  stakeFloor,
  stakeableFromRound,
  truceBetween,
  type Territory,
} from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys } from '@/lib/queries';
import { playerName, warStatusText } from '@/lib/wars';
import { Notice } from '../ui';
import { StakeBuilder, initialStake, stakeProblem, type StakeDraft, type StakeOptions } from './stake-builder';
import type { StakePreview } from './war-detail';

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

  if (campaign.status !== 'active' || !ownerId) return null;

  if (war) {
    return (
      <div className="flex items-center gap-3 rounded-[3px] border border-grease/60 bg-grease/10 px-3 py-2">
        <p className="min-w-0 flex-1 text-[0.95rem]">
          <strong>Caught up in a war.</strong> {warStatusText(model, war)}.
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenWar(war.id)}>
          View war
        </button>
      </div>
    );
  }

  if (ownerId === me) {
    const from = stakeableFromRound(board, board.holdings.get(territory.id)!);
    return from ? <p className="text-[0.95rem] text-muted">Newly won: it can be staked from round {from}.</p> : null;
  }

  const rejection = checkTarget(board, me, territory.id);
  if (rejection) {
    const owner = playerName(model, ownerId);
    const truce = rejection === 'truce' ? truceBetween(board, me, ownerId) : undefined;
    const accord = rejection === 'accord' ? accordBetween(board, me, ownerId) : undefined;
    const renounced = rejection === 'renounced' ? renunciationAgainst(board, me, ownerId) : undefined;
    return (
      <p className="text-[0.95rem] text-muted">
        {truce
          ? `You have a truce with ${owner} until round ${truce.endsRound}.`
          : accord
            ? `You have an accord with ${owner}: no war between you until round ${accord.endsRound} starts.`
            : renounced
              ? `You broke your accord with ${owner}, so you can't declare war on them until round ${renounced.untilRound} starts.`
              : TARGET_REJECTION_MESSAGES[rejection]}
      </p>
    );
  }
  if (model.tokens < 1) {
    return <p className="text-[0.95rem] text-muted">You have no war tokens. The next round brings one.</p>;
  }
  if (!building) {
    return (
      <button type="button" className="btn btn-war w-full" onClick={() => setBuilding(true)}>
        Declare war
      </button>
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
    () => ({ minValue: stakeFloor(model.campaign.rules, territory.value) }),
    [model.campaign.rules, territory.value],
  );
  const [draft, setDraft] = useState<StakeDraft | null>(() => initialStake(model, territory.id, opts));
  useEffect(() => {
    onPreview(draft ? { targetId: territory.id, ...draft } : null);
    return () => onPreview(null);
  }, [draft, territory.id, onPreview]);

  const declare = useMutation({
    mutationFn: (d: StakeDraft) =>
      api.declareWar(model.campaign.id, { targetId: territory.id, launchId: d.launchId, stake: d.stake }),
    onSuccess: ({ id }) => onDeclared(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(model.campaign.id) }),
  });

  if (!draft) return <Notice tone="error">No stake can be built against {territory.name} right now.</Notice>;
  const problem = stakeProblem(model, territory.id, draft, opts);
  const defender = playerName(model, model.owners.get(territory.id)!);

  return (
    <div className="space-y-4 rounded-[3px] border border-grease/60 p-3">
      <div>
        <div className="font-stencil text-xl tracking-wide text-[#ef7b72]">Declare war on {territory.name}</div>
        <p className="text-sm text-muted">
          Stake at least {opts.minValue}: if {defender} wins the game, they take the stake. Costs 1 of your{' '}
          {model.tokens} war {model.tokens === 1 ? 'token' : 'tokens'}.
        </p>
      </div>
      <StakeBuilder model={model} targetId={territory.id} opts={opts} draft={draft} onChange={setDraft} />
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
