'use client';

import type { EventView, TerritoryId, WarView } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, errorMessage } from '@/lib/api';
import { totalValue, type CampaignModel } from '@/lib/campaign';
import { relativeTime } from '@/lib/format';
import { keys } from '@/lib/queries';
import { EmpireSwatch } from '../hatch';
import { Notice } from '../ui';
import { DraftListSection } from './draft-list';
import { PlayerName } from './player-name';

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
    if (campaign.status !== 'active') return null;
    const waiting = model.awaitingMe.length;
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
          You have {model.tokens} war {model.tokens === 1 ? 'token' : 'tokens'}.
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
  const rows = model.campaign.members
    .map((m) => {
      const ids = model.holdingsByUser.get(m.userId) ?? [];
      return { member: m, count: ids.length, value: totalValue(model.idx, ids) };
    })
    .sort((a, b) => b.value - a.value || b.count - a.count);
  const showUnclaimed = model.campaign.status !== 'lobby' && model.unclaimed > 0;
  const showTokens = model.campaign.status === 'active';
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
            <th className="label pb-1 font-bold">Player</th>
            <th className="label pb-1 text-right font-bold">Countries</th>
            <th className="label pb-1 text-right font-bold">Value</th>
            {showTokens && <th className="label pb-1 pl-2 text-right font-bold">Tokens</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(({ member, count, value }) => (
            <tr key={member.userId}>
              <td className="max-w-0 py-2 pr-2">
                <PlayerName member={member} you={member.userId === model.me.userId} size="sm" />
                {member.autodraft && model.campaign.status === 'draft' && (
                  <span className="ml-1 text-xs text-muted">auto</span>
                )}
              </td>
              <td className="py-2 text-right tabular-nums">{count}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{value}</td>
              {showTokens && <td className="py-2 pl-2 text-right tabular-nums">{member.tokens}</td>}
            </tr>
          ))}
          {showUnclaimed && (
            <tr className="text-muted">
              <td className="py-2 pr-2">
                <span className="inline-flex items-center gap-2">
                  <span className="size-4 rounded-[2px] border border-line-strong bg-olive" aria-hidden="true" />
                  Unclaimed
                </span>
              </td>
              <td className="py-2 text-right tabular-nums">{model.unclaimed}</td>
              <td className="py-2 text-right tabular-nums">{unclaimedValue}</td>
              {showTokens && <td />}
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
              <EventLine event={e} model={model} onSelect={onSelect} onOpenWar={onOpenWar} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EventLine({
  event,
  model,
  onSelect,
  onOpenWar,
}: {
  event: EventView;
  model: CampaignModel;
  onSelect(id: TerritoryId): void;
  onOpenWar(warId: string): void;
}) {
  const name = (userId: string | null) =>
    userId ? (model.membersById.get(userId)?.name ?? 'A former player') : 'Someone';
  const country = (id: TerritoryId) => (
    <button
      type="button"
      className="font-semibold underline decoration-line-strong underline-offset-2 hover:decoration-paper"
      onClick={() => onSelect(id)}
    >
      {model.idx.byId.get(id)?.name ?? id}
    </button>
  );
  const warOf = (warId: string): WarView | undefined => model.campaign.wars.find((w) => w.id === warId);
  /** A war line links to the war when it's still in view. */
  const warLine = (warId: string, children: ReactNode) =>
    warOf(warId) ? (
      <button type="button" className="text-left hover:underline" onClick={() => onOpenWar(warId)}>
        {children}
      </button>
    ) : (
      <>{children}</>
    );
  const targetName = (warId: string) => {
    const war = warOf(warId);
    return war ? (model.idx.byId.get(war.targetId)?.name ?? war.targetId) : 'the frontier';
  };
  switch (event.type) {
    case 'round.started':
      return <strong>Round {event.payload.round} began. War tokens refilled.</strong>;
    case 'war.declared': {
      const { attackerId, defenderId, targetId, stake } = event.payload;
      return (
        <span className="text-[#ef7b72]">
          {name(attackerId)} declared war on {name(defenderId)} for {country(targetId)}, staking{' '}
          {stake.map((id) => model.idx.byId.get(id)?.name ?? id).join(', ')}.
        </span>
      );
    }
    case 'war.response': {
      const { warId, response, counter, auto } = event.payload;
      const war = warOf(warId);
      const defender = name(war?.defenderId ?? event.actorId);
      if (response === 'accept') {
        return warLine(
          warId,
          auto
            ? `No answer from ${defender}: the war for ${targetName(warId)} goes ahead.`
            : `${defender} accepted the war for ${targetName(warId)}.`,
        );
      }
      if (counter?.kind === 'raise')
        return warLine(warId, `${defender} raised the stakes: at least ${counter.minValue}.`);
      if (counter?.kind === 'redirect') {
        return warLine(warId, `${defender} redirected the attack to ${model.idx.byId.get(counter.targetId)?.name}.`);
      }
      if (counter?.kind === 'tribute') {
        const what = counter.territoryId
          ? model.idx.byId.get(counter.territoryId)?.name
          : `${counter.tokens} war ${counter.tokens === 1 ? 'token' : 'tokens'}`;
        return warLine(warId, `${defender} offered tribute: ${what}.`);
      }
      return null;
    }
    case 'war.reply': {
      const { warId, reply, auto } = event.payload;
      const war = warOf(warId);
      const attacker = name(war?.attackerId ?? event.actorId);
      if (reply === 'withdraw') {
        return warLine(warId, auto ? `No answer from ${attacker}: the attack is called off.` : `${attacker} withdrew.`);
      }
      if (reply === 'refuse') return warLine(warId, `${attacker} refused the tribute. The game goes ahead.`);
      const kind = war?.counter?.kind;
      if (kind === 'tribute')
        return warLine(warId, auto ? `${attacker} took the tribute.` : `${attacker} accepted the tribute.`);
      if (kind === 'redirect') return warLine(warId, `${attacker} will fight for ${targetName(warId)}.`);
      return warLine(warId, `${attacker} raised the stake.`);
    }
    case 'war.started': {
      const { warId, armageddon, whiteId, blackId } = event.payload;
      return warLine(
        warId,
        `${armageddon ? 'Armageddon' : 'The battle'} for ${targetName(warId)} began: ${name(whiteId)} (White) against ${name(blackId)}.`,
      );
    }
    case 'war.resolved': {
      const { warId, outcome, transfers, tokens } = event.payload;
      const war = warOf(warId);
      const target = targetName(warId);
      const taken = transfers.map((t) => model.idx.byId.get(t.territoryId)?.name ?? t.territoryId).join(', ');
      const text = {
        attacker: `${name(war?.attackerId ?? null)} took ${target}.`,
        defender: `${name(war?.defenderId ?? null)} held ${target} and took ${taken}.`,
        held: `${target} held: the battle was drawn.`,
        tribute: `${name(war?.attackerId ?? null)} took tribute: ${taken || `${tokens} war ${tokens === 1 ? 'token' : 'tokens'}`}.`,
        withdrawn: `The war for ${target} was called off.`,
      }[outcome];
      return <strong>{warLine(warId, text)}</strong>;
    }
    case 'campaign.created':
      return <>{name(event.actorId)} opened the campaign.</>;
    case 'member.joined':
      return <>{event.payload.name} joined.</>;
    case 'member.left':
      return <>{event.payload.kicked ? `${event.payload.name} was removed.` : `${event.payload.name} left.`}</>;
    case 'draft.started':
      return <>The draft began. Order: {event.payload.order.map(name).join(', ')}.</>;
    case 'draft.completed':
      return <strong>The draft is complete. Every country has an owner.</strong>;
    case 'draft.ended': {
      const { unclaimed, autoPicked } = event.payload;
      return (
        <strong>
          {name(event.actorId)} ended the draft.{' '}
          {autoPicked ? `The remaining ${countries(autoPicked)} were drafted automatically. ` : ''}
          {unclaimed === 0 ? 'Every country has an owner.' : `${countries(unclaimed)} stay unclaimed.`}
        </strong>
      );
    }
    case 'draft.pick': {
      const { userId, territoryId, pickNumber, auto } = event.payload;
      const t = model.idx.byId.get(territoryId);
      const picker = model.membersById.get(userId);
      // The host picking for a stalled player is logged with the host as the actor.
      const forSomeoneElse = event.actorId !== null && event.actorId !== userId;
      return (
        <>
          <span className="text-faint tabular-nums">#{pickNumber + 1}</span>{' '}
          {picker ? <EmpireSwatch color={picker.color} size={11} className="inline align-[-1px]" /> : null}{' '}
          {forSomeoneElse ? (
            <>
              {name(event.actorId)} picked {country(territoryId)} for {name(userId)}
            </>
          ) : (
            <>
              {name(userId)} {auto ? 'auto-drafted' : 'claimed'} {country(territoryId)}
            </>
          )}{' '}
          <span className="text-faint">({t?.value ?? '?'})</span>
        </>
      );
    }
  }
}
