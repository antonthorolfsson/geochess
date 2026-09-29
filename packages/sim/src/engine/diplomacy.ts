/**
 * Accords, as apps/server/src/diplomacy/accords.ts runs them: proposals answered at once (the
 * answer window is shorter than a round), signing (renewing any accord in force), renouncing, and
 * what a round start does to them.
 */
import {
  REPUTATION_BROKEN,
  REPUTATION_PER_ROUND,
  accordBetween,
  accordEndsRound,
  accordsHeldThrough,
  accordsInForce,
  type UserId,
} from '@empire/rules';
import { newId, nextSeq, note } from './state';
import type { SimAccord, SimState } from './types';
import { settle } from './victory';

/** The accord in force between two players, if any. */
export function accordInForce(s: SimState, a: UserId, b: UserId): SimAccord | undefined {
  const inForce = accordBetween({ round: s.round, accords: accordsInForce(s.accords, s.round) }, a, b);
  return inForce ? s.accords.find((x) => x.id === inForce.id) : undefined;
}

export function propose(s: SimState, proposerId: UserId, recipientId: UserId, rounds: number): SimAccord {
  const accord: SimAccord = {
    id: newId(s, 'a'),
    proposerId,
    recipientId,
    status: 'proposed',
    endsRound: null,
    endedRound: null,
    brokenBy: null,
    rounds,
    signedRound: null,
    renews: null,
  };
  s.accords.push(accord);
  s.accordStats.proposed++;
  s.actions.push({ t: 'propose', accord: accord.id, by: proposerId, to: recipientId, rounds });
  return accord;
}

/** The recipient signs or declines. Signing renews any accord already in force between them. */
export function answer(s: SimState, accord: SimAccord, accept: boolean): void {
  if (accord.status !== 'proposed') return;
  s.actions.push({ t: 'answer', accord: accord.id, accept });
  if (!accept) {
    accord.status = 'declined';
    return;
  }
  const renewed = accordInForce(s, accord.proposerId, accord.recipientId);
  if (renewed) {
    renewed.status = 'renewed';
    renewed.endedRound = s.round;
    s.accordStats.renewed++;
  }
  accord.status = 'active';
  accord.signedRound = s.round;
  accord.endsRound = accordEndsRound(s.round, accord.rounds);
  accord.renews = renewed?.id ?? null;
  const seq = nextSeq(s);
  if (renewed) {
    const span = s.history.accords.find((a) => a.id === renewed.id);
    if (span && span.to === null) span.to = seq;
  }
  s.history.accords.push({
    id: accord.id,
    players: [accord.proposerId, accord.recipientId],
    from: seq,
    to: null,
    brokenBy: null,
  });
  s.accordStats.signed++;
  note(
    s,
    () =>
      `${accord.proposerId} and ${accord.recipientId} sign an accord until round ${accord.endsRound}${renewed ? ' (renewal)' : ''}`,
  );
  settle(s, new Set([accord.proposerId, accord.recipientId]));
}

/** A partner breaks an accord in force: it ends at once, and the breaker loses reputation. */
export function renounce(s: SimState, accord: SimAccord, breakerId: UserId): void {
  if (accord.status !== 'active') return;
  s.actions.push({ t: 'renounce', accord: accord.id, by: breakerId });
  accord.status = 'broken';
  accord.brokenBy = breakerId;
  accord.endedRound = s.round;
  const seq = nextSeq(s);
  const span = s.history.accords.find((a) => a.id === accord.id);
  if (span && span.to === null) Object.assign(span, { to: seq, brokenBy: breakerId });
  s.byId.get(breakerId)!.reputation += REPUTATION_BROKEN;
  s.accordStats.broken++;
  const partner = accord.proposerId === breakerId ? accord.recipientId : accord.proposerId;
  note(s, () => `${breakerId} breaks the accord with ${partner}`);
  settle(s, new Set([accord.proposerId, accord.recipientId]));
}

/**
 * A round has started: accords held through the whole round before pay both partners, then those
 * whose last round has passed run their course.
 */
export function startRoundForAccords(s: SimState): void {
  const history = s.accords.filter((a) => a.status === 'active' || a.status === 'renewed');
  for (const accord of accordsHeldThrough(history, s.round)) {
    for (const id of [accord.proposerId, accord.recipientId]) s.byId.get(id)!.reputation += REPUTATION_PER_ROUND;
  }
  const due = s.accords.filter((a) => a.status === 'active' && a.endsRound !== null && a.endsRound <= s.round);
  for (const accord of due) {
    accord.status = 'kept';
    accord.endedRound = s.round;
    const seq = nextSeq(s);
    const span = s.history.accords.find((a) => a.id === accord.id);
    if (span && span.to === null) span.to = seq;
    s.accordStats.kept++;
  }
}
