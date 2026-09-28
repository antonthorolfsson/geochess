'use client';

import type { TerritoryId } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { totalValue, type CampaignModel } from '@/lib/campaign';
import { relativeTime } from '@/lib/format';
import { keys } from '@/lib/queries';
import { DispatchLine } from '../diplo/dispatch-line';
import { EmpireSwatch } from '../hatch';
import { Notice } from '../ui';
import { DraftListSection } from './draft-list';
import { PlayerName } from './player-name';
import { useEmpireHref } from './room-context';

const countries = (n: number) => `${n} ${n === 1 ? 'country' : 'countries'}`;

/** Whose pick it is, and the controls for it: pick for me, the host's overrides. */
export function DraftStatus({ model, compact = false }: { model: CampaignModel; compact?: boolean }) {
  const { campaign, currentPicker, myTurn, isHost } = model;
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) });
  const autopick = useMutation({ mutationFn: () => api.autopick(campaign.id), onSettled: refresh });
  const endDraft = useMutation({ mutationFn: () => api.endDraft(campaign.id), onSettled: refresh });
  const draft = campaign.draft;

  if (campaign.status !== 'draft' || !draft) {
    const victory = campaign.victory;
    if (campaign.status === 'selection') {
      const waiting = victory?.players.filter((p) => !p.ready).length ?? 0;
      const mine = campaign.mySecret;
      return (
        <div className="space-y-1">
          <div className="label">Draft over · choosing secret missions</div>
          <p className="text-[0.95rem] text-muted">
            {mine?.options?.length ? <strong className="text-amber">Choose your secret mission. </strong> : null}
            Round 1 begins when everyone has one
            {waiting > 0 ? ` (${waiting} still choosing)` : ''}.
          </p>
        </div>
      );
    }
    if (campaign.status === 'finished') {
      const winners = victory?.result?.winners ?? [];
      return (
        <div className="space-y-1">
          <div className="label">Campaign over · round {campaign.round}</div>
          <p className="text-[0.95rem]">
            {winners.length === 0
              ? 'The campaign has ended.'
              : `${winners.map((id) => model.membersById.get(id)?.name ?? 'A player').join(' and ')} ${
                  winners.length > 1 ? 'share the victory' : 'won'
                }.`}
          </p>
        </div>
      );
    }
    if (campaign.status !== 'active') return null;
    const waiting = model.awaitingMe.length;
    const points = victory?.players.find((p) => p.userId === model.me.userId)?.points;
    return (
      <div className="space-y-1">
        <div className="label">Campaign underway · Round {campaign.round}</div>
        <p className="text-[0.95rem] text-muted">
          {waiting > 0 ? (
            <strong className="text-amber">
              {waiting} {waiting === 1 ? 'war is' : 'wars are'} waiting for your answer.{' '}
            </strong>
          ) : null}
          {model.activeWars.length === 0
            ? 'No wars underway.'
            : `${model.activeWars.length} ${model.activeWars.length === 1 ? 'war' : 'wars'} underway.`}{' '}
          You have {model.tokens} war {model.tokens === 1 ? 'token' : 'tokens'}
          {victory && points !== undefined ? ` and ${points} of ${victory.pointsToWin} victory points` : ''}.
        </p>
      </div>
    );
  }

  const error = autopick.error ?? endDraft.error;
  return (
    <div className="space-y-3">
      <div className="label">
        Draft · Round {draft.round} of {model.totalRounds} · Pick {draft.pickIndex + 1} of {draft.totalPicks}
      </div>
      {myTurn ? (
        <div className="rounded-[3px] border border-amber/70 bg-amber/10 px-3 py-2">
          <div className="font-stencil text-xl tracking-wide text-amber">Your pick</div>
          <p className="text-[0.95rem]">
            {model.autodraftWaiting && 'Auto-draft is waiting for you: nothing on your draft list can be claimed. '}
            {model.highlighted ? 'Claim a highlighted country bordering your empire.' : 'Claim any free country.'}
          </p>
        </div>
      ) : (
        <div className="flex min-h-11 items-center gap-2">
          <PlayerName member={currentPicker ?? undefined} />
          <span className="text-muted">is picking</span>
        </div>
      )}
      {!compact && (
        <div className="flex flex-wrap gap-2">
          {myTurn && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={autopick.isPending}
              onClick={() => autopick.mutate()}
            >
              Pick for me
            </button>
          )}
          {!myTurn && isHost && currentPicker && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={autopick.isPending}
              onClick={() => autopick.mutate()}
            >
              Pick for {currentPicker.name}
            </button>
          )}
          {isHost && (
            <button
              type="button"
              className="btn btn-danger btn-sm ml-auto"
              disabled={endDraft.isPending}
              onClick={() => {
                const left = model.unclaimed;
                const question = `End the draft now? The remaining ${countries(left)} will be drafted automatically, from each player's draft list first, then the most valuable.`;
                if (confirm(question)) endDraft.mutate();
              }}
            >
              End draft
            </button>
          )}
        </div>
      )}
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
    </div>
  );
}

export function DraftPanel({
  model,
  onSelect,
  onOpenWar,
}: {
  model: CampaignModel;
  onSelect(id: TerritoryId): void;
  onOpenWar(warId: string): void;
}) {
  return (
    <div className="space-y-6 p-4">
      <DraftStatus model={model} />
      {model.campaign.status === 'draft' && <DraftListSection model={model} onSelect={onSelect} />}
      {model.upcoming.length > 0 && <UpNext model={model} />}
      <Standings model={model} />
      <Dispatches model={model} onSelect={onSelect} onOpenWar={onOpenWar} />
    </div>
  );
}

function UpNext({ model }: { model: CampaignModel }) {
  return (
    <section>
      <h2 className="label mb-2">Up next</h2>
      <ol className="flex flex-wrap gap-1.5">
        {model.upcoming.slice(1).map((m, i) => (
          <li
            key={i}
            className={`inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-1 text-sm ${
              m.userId === model.me.userId ? 'border-amber/70 text-amber' : 'border-line'
            }`}
          >
            <EmpireSwatch color={m.color} size={12} />
            {m.name}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Standings({ model }: { model: CampaignModel }) {
  const empireHref = useEmpireHref(model.campaign.id);
  const { status, victory } = model.campaign;
  // In an Objectives campaign victory points are the race; value stays beside them.
  const showPoints = victory !== null && (status === 'active' || status === 'finished');
  const pointsOf = new Map(victory?.players.map((p) => [p.userId, p.points]) ?? []);
  const rows = model.campaign.members
    .map((m) => {
      const ids = model.holdingsByUser.get(m.userId) ?? [];
      return { member: m, count: ids.length, value: totalValue(model.idx, ids), points: pointsOf.get(m.userId) ?? 0 };
    })
    .sort((a, b) => (showPoints ? b.points - a.points : 0) || b.value - a.value || b.count - a.count);
  const showUnclaimed = model.campaign.status !== 'lobby' && model.unclaimed > 0;
  const showTokens = model.campaign.status === 'active';
  const showReputation = model.campaign.status !== 'lobby';
  const unclaimedValue = model.idx.ids.reduce(
    (sum, id) => sum + (model.owners.has(id) ? 0 : (model.idx.byId.get(id)?.value ?? 0)),
    0,
  );
  return (
    <section>
      <h2 className="label mb-2">Empires</h2>
      <table className="w-full text-[0.95rem]">
        <thead>
          <tr className="text-left">
            <th className="label w-full pb-1 font-bold">Player</th>
            {showPoints && (
              <th className="label pb-1 pl-2 text-right font-bold text-amber">
                <abbr title="Victory points" className="no-underline">
                  VP
                </abbr>
              </th>
            )}
            <th className="label pb-1 pl-2 text-right font-bold">Value</th>
            {showTokens && <th className="label pb-1 pl-3 text-right font-bold">Tokens</th>}
            {showReputation && (
              <th className="label pb-1 pl-3 text-right font-bold">
                <abbr title="Reputation" className="no-underline">
                  Rep
                </abbr>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(({ member, count, value, points }) => (
            <tr key={member.userId}>
              <td className="max-w-0 py-1.5">
                <PlayerName
                  member={member}
                  you={member.userId === model.me.userId}
                  size="sm"
                  href={empireHref(member.userId)}
                />
                <span className="block pl-6 text-xs text-muted tabular-nums">
                  {countries(count)}
                  {member.autodraft && model.campaign.status === 'draft' && ' · auto-draft'}
                </span>
              </td>
              {showPoints && <td className="py-1.5 pl-2 text-right font-bold text-amber tabular-nums">{points}</td>}
              <td className={`py-1.5 pl-2 text-right tabular-nums ${showPoints ? '' : 'font-semibold'}`}>{value}</td>
              {showTokens && <td className="py-1.5 pl-3 text-right tabular-nums">{member.tokens}</td>}
              {showReputation && <td className="py-1.5 pl-3 text-right tabular-nums">{member.reputation}</td>}
            </tr>
          ))}
          {showUnclaimed && (
            <tr className="text-muted">
              <td className="max-w-0 py-1.5">
                <span className="inline-flex items-center gap-2">
                  <span className="size-4 rounded-[2px] border border-line-strong bg-olive" aria-hidden="true" />
                  Unclaimed
                </span>
                <span className="block pl-6 text-xs tabular-nums">{countries(model.unclaimed)}</span>
              </td>
              {showPoints && <td />}
              <td className="py-1.5 pl-2 text-right tabular-nums">{unclaimedValue}</td>
              {showTokens && <td />}
              {showReputation && <td />}
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/** The campaign's event log as a feed of dispatches, newest first. */
export function Dispatches({
  model,
  onSelect,
  onOpenWar,
}: {
  model: CampaignModel;
  onSelect(id: TerritoryId): void;
  onOpenWar(warId: string): void;
}) {
  const events = [...model.campaign.events].reverse();
  if (events.length === 0) return null;
  return (
    <section>
      <h2 className="label mb-2">Dispatches</h2>
      <ol className="space-y-1.5 text-[0.95rem]">
        {events.map((e) => (
          <li key={e.id} className="flex gap-2">
            <span className="w-14 shrink-0 pt-0.5 text-xs text-faint tabular-nums">{relativeTime(e.createdAt)}</span>
            <span className="min-w-0 flex-1">
              <DispatchLine event={e} model={model} onSelect={onSelect} onOpenWar={onOpenWar} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
