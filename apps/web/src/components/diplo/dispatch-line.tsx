'use client';

import { missionName, type EventView, type TerritoryId, type WarView } from '@empire/rules';
import type { ReactNode } from 'react';
import type { CampaignModel } from '@/lib/campaign';
import { requirementText } from '@/lib/victory';
import { EmpireSwatch } from '../hatch';

const countries = (n: number) => `${n} ${n === 1 ? 'country' : 'countries'}`;

/** How a dispatch sits in the feed: wars in grease pencil, accords on paper, missions in amber, the rest plain. */
export function dispatchTone(type: EventView['type']): 'war' | 'accord' | 'broken' | 'mission' | 'plain' {
  if (type === 'accord.broken') return 'broken';
  if (type.startsWith('war.')) return 'war';
  if (type.startsWith('accord.') || type.startsWith('reputation.')) return 'accord';
  if (type.startsWith('mission') || type.startsWith('claim.') || type === 'campaign.won') return 'mission';
  return 'plain';
}

/** One entry of the campaign's event log, in words. */
export function DispatchLine({
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
  const version = model.campaign.rules.victory.version;
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
      return event.payload.round === 1 ? (
        <strong>Round 1 began: to war. Everyone has their first war token.</strong>
      ) : (
        <strong>Round {event.payload.round} began. War tokens refilled.</strong>
      );
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
        cancelled: `The war for ${target} was cancelled: the campaign ended first.`,
      }[outcome];
      return <strong>{warLine(warId, text)}</strong>;
    }
    case 'missions.dealt':
      return (
        <strong>Secret missions have been dealt. Each player chooses one, privately, before round 1 begins.</strong>
      );
    case 'mission.revealed': {
      const { userId, mission, reason } = event.payload;
      return (
        <span>
          <strong className="text-amber">
            {name(userId)}’s secret mission {reason === 'final' ? 'was' : 'is'} {missionName(mission)}
          </strong>
          {reason === 'near' ? ', one step from completion' : reason === 'claim' ? ', now complete' : ''}:{' '}
          {requirementText(model, mission)}
        </span>
      );
    }
    case 'claim.started': {
      const { userId, kind, eligibleRound } = event.payload;
      return (
        <span>
          <strong>
            {name(userId)} claims {missionName({ kind }, version)}
          </strong>
          : it can score in round {eligibleRound} at the earliest, if it’s still held then and no war can break it.
        </span>
      );
    }
    case 'claim.interrupted': {
      const { userId, kind } = event.payload;
      return (
        <span className="text-muted">
          {name(userId)} lost the position claimed for {missionName({ kind }, version)} before it scored.
        </span>
      );
    }
    case 'mission.awarded': {
      const { userId, kind, points, total } = event.payload;
      return (
        <strong className="text-amber">
          {name(userId)} scored {missionName({ kind }, version)}: +{points}, {total} {total === 1 ? 'point' : 'points'}.
        </strong>
      );
    }
    case 'campaign.won': {
      const winners = event.payload.winners.map((id) => name(id));
      return (
        <strong className="font-stencil text-lg tracking-wide text-amber">
          {event.payload.seasonEnd && 'The last round is over. '}
          {winners.length > 1
            ? `${winners.slice(0, -1).join(', ')} and ${winners.at(-1)} share the victory.`
            : `${winners[0]} wins the campaign.`}
        </strong>
      );
    }
    case 'accord.signed': {
      const { proposerId, recipientId, endsRound, terms, renews } = event.payload;
      return (
        <span>
          <strong>
            {name(proposerId)} and {name(recipientId)} {renews ? 'renewed their accord' : 'signed an accord'}
          </strong>
          : no war between them until round {endsRound}.
          {terms && <span className="block text-muted italic">“{terms}”</span>}
        </span>
      );
    }
    case 'accord.broken': {
      const { breakerId, partnerId } = event.payload;
      return (
        <strong className="text-[#ef7b72]">
          {name(breakerId)} broke the accord with {name(partnerId)}.
        </strong>
      );
    }
    case 'accord.kept': {
      const [a, b] = event.payload.players;
      return (
        <>
          The accord between {name(a)} and {name(b)} ran its course.
        </>
      );
    }
    case 'reputation.changed': {
      const { userId, delta, reputation } = event.payload;
      return (
        <span className="text-muted">
          {name(userId)}&apos;s reputation {delta < 0 ? 'fell' : 'rose'} to{' '}
          <span className="font-semibold text-paper tabular-nums">{reputation}</span>{' '}
          <span className="tabular-nums">
            ({delta > 0 ? '+' : '−'}
            {Math.abs(delta)})
          </span>
          .
        </span>
      );
    }
    case 'reputation.earned': {
      const { heldRound, gains } = event.payload;
      return (
        <span className="text-muted">
          Accords held through round {heldRound} earned reputation:{' '}
          {gains.map((g, i) => (
            <span key={g.userId}>
              {i > 0 && ', '}
              {name(g.userId)} <span className="tabular-nums">+{g.delta}</span>
            </span>
          ))}
          .
        </span>
      );
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
