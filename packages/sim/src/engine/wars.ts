/**
 * The war lifecycle, as apps/server/src/wars/service.ts and peace.ts run it: declare (on your turn,
 * where the rules have turns), answer, reply, fight, resolve; calling a declaration off,
 * fortifying, and peace terms. Every check comes from the rules package; an illegal action is
 * refused with the rules' own reason, never applied.
 */
import {
  DECLARE_COST,
  FORTIFY_COST,
  afterGame,
  canRaise,
  canRecall,
  checkFortify,
  checkReserves,
  checkStake,
  checkTarget,
  counterCost,
  fortifyEnds,
  peaceIssue,
  peaceTransfers,
  raiseDemand,
  raiseOptions,
  redirectOptions,
  stakeFromReserves,
  tributeOptions,
  valueOf,
  warTransfers,
  type GameEndReason,
  type PeaceTerms,
  type TerritoryId,
  type Transfer,
  type UserId,
  type WarOutcome,
} from '@empire/rules';
import { weighted } from '../random';
import { warBoard } from './board';
import { playGame, type PlayedGame } from './chess';
import { signAgreedAccord } from './diplomacy';
import { heldBy, nameOf, newId, nextSeq, note, valueOfIds } from './state';
import { turnIssue, turnTaken } from './turns';
import type { SimPeaceOffer, SimState, SimWar } from './types';
import { settle } from './victory';

export interface Declaration {
  targetId: TerritoryId;
  launchId: TerritoryId;
  stake: TerritoryId[];
  /** Countries set aside to meet a raise at once. */
  reserves?: TerritoryId[];
}

export type Response =
  | { kind: 'accept' }
  | { kind: 'raise'; territoryId?: TerritoryId }
  | { kind: 'redirect'; targetId: TerritoryId }
  | { kind: 'tribute'; territoryId: TerritoryId }
  | { kind: 'tribute'; tokens: number };

export type Reply = { kind: 'accept'; stake?: TerritoryId[] } | { kind: 'withdraw' } | { kind: 'refuse' };

/** Declares war, or says why it can't be declared. */
export function declare(s: SimState, attackerId: UserId, d: Declaration): SimWar | string {
  const attacker = s.byId.get(attackerId)!;
  if (s.status !== 'active') return 'not-active';
  const turn = turnIssue(s, attackerId);
  if (turn) return turn;
  if (attacker.tokens < DECLARE_COST) return 'no-tokens';
  const board = warBoard(s);
  const target = checkTarget(board, attackerId, d.targetId);
  if (target) return target;
  const stake = checkStake(board, attackerId, d.targetId, d.launchId, d.stake);
  if (stake) return stake;
  const reserves = d.reserves ?? [];
  const reserveIssue = checkReserves(board, attackerId, d.launchId, d.stake, reserves);
  if (reserveIssue) return reserveIssue;
  const latency = weighted(s.cfg.latency, s.rng.latency);
  const war: SimWar = {
    id: newId(s, 'w'),
    attackerId,
    defenderId: s.holdings.get(d.targetId)!.ownerId,
    targetId: d.targetId,
    launchId: d.launchId,
    stake: [d.launchId, ...d.stake.filter((id) => id !== d.launchId)],
    reserves,
    status: 'declared',
    counter: null,
    redirectedFrom: null,
    declaredRound: s.round,
    declaredSeq: nextSeq(s),
    dueRound: s.round + latency,
    outcome: null,
    resolvedRound: null,
    seq: null,
    transfers: [],
    endReason: null,
    armageddon: false,
    response: null,
    reply: null,
  };
  s.wars.push(war);
  s.actions.push({
    t: 'declare',
    war: war.id,
    by: attackerId,
    targetId: d.targetId,
    launchId: d.launchId,
    stake: war.stake,
    ...(reserves.length > 0 ? { reserves } : {}),
  });
  attacker.tokens -= DECLARE_COST;
  s.stats.declared++;
  note(
    s,
    () =>
      `${attackerId} declares war on ${war.defenderId}: ${nameOf(s, d.targetId)} (${s.idx.byId.get(d.targetId)!.value}) ` +
      `from ${nameOf(s, d.launchId)}, staking ${valueOfIds(s, war.stake)}`,
  );
  turnTaken(s, attackerId);
  return war;
}

/**
 * The defender answers a declaration. Returns why it's refused, or null. Reserves set aside at the
 * declaration meet a raise at once when they can, as the server does within the answer.
 */
export function respond(s: SimState, war: SimWar, r: Response): string | null {
  if (war.status !== 'declared') return 'already-answered';
  const board = warBoard(s);
  const active = board.wars.find((w) => w.id === war.id)!;
  const defender = s.byId.get(war.defenderId)!;
  const rules = s.rules.war;
  switch (r.kind) {
    case 'accept':
      war.status = 'ready';
      war.response = 'accept';
      break;
    case 'raise':
      if (rules.raise === 'off') return 'no-raise';
      if (rules.raise === 'matched') {
        if (!r.territoryId) return 'raise-country';
        if (!raiseOptions(board, active).includes(r.territoryId)) return 'bad-raise';
        war.counter = { kind: 'raise', minValue: raiseDemand(board, active, r.territoryId), added: r.territoryId };
      } else {
        if (!canRaise(board, active)) return 'cannot-raise';
        const cost = counterCost(s.rules, 'raise');
        if (defender.tokens < cost) return 'no-tokens';
        defender.tokens -= cost;
        war.counter = { kind: 'raise', minValue: raiseDemand(board, active), ...(cost > 0 ? { tokens: cost } : {}) };
      }
      war.status = 'countered';
      war.response = 'raise';
      break;
    case 'redirect': {
      if (!redirectOptions(board, active).includes(r.targetId)) return 'bad-redirect';
      const cost = counterCost(s.rules, 'redirect');
      if (defender.tokens < cost) return 'no-tokens';
      defender.tokens -= cost;
      war.counter = { kind: 'redirect', targetId: r.targetId, ...(cost > 0 ? { tokens: cost } : {}) };
      war.status = 'countered';
      war.response = 'redirect';
      break;
    }
    case 'tribute':
      if (rules.peaceTerms) return 'no-tribute';
      if ('territoryId' in r) {
        if (!tributeOptions(board, active).includes(r.territoryId)) return 'bad-tribute';
        war.counter = { kind: 'tribute', territoryId: r.territoryId, tokens: 0 };
        war.response = 'tribute-country';
      } else {
        if (r.tokens < 1 || r.tokens > defender.tokens) return 'not-enough-tokens';
        // Offered tokens are held back until the attacker answers.
        defender.tokens -= r.tokens;
        war.counter = { kind: 'tribute', territoryId: null, tokens: r.tokens };
        war.response = 'tribute-tokens';
      }
      war.status = 'countered';
      break;
  }
  s.stats.responses[war.response!]++;
  s.actions.push({ t: 'respond', war: war.id, response: r });
  if (r.kind !== 'accept') note(s, () => `${war.defenderId} answers ${war.id} with ${describeCounter(s, war)}`);
  const counter = war.counter;
  if (counter?.kind === 'raise' && war.reserves.length > 0) {
    const stake = stakeFromReserves(s.idx, war.stake, war.reserves, counter.minValue);
    if (stake) {
      s.stats.fromReserves++;
      note(s, () => `${war.attackerId} meets the raise from reserves`);
      applyReply(s, war, { kind: 'accept', stake }, false);
    }
  }
  return null;
}

function describeCounter(s: SimState, war: SimWar): string {
  const c = war.counter!;
  if (c.kind === 'raise') return `a raise to ${c.minValue}${c.added ? `, putting in ${nameOf(s, c.added)}` : ''}`;
  if (c.kind === 'redirect') return `a redirect to ${nameOf(s, c.targetId)}`;
  return c.territoryId ? `tribute: ${nameOf(s, c.territoryId)}` : `tribute: ${c.tokens} tokens`;
}

/** The attacker answers a counter-offer. Returns why it's refused, or null. */
export function reply(s: SimState, war: SimWar, r: Reply): string | null {
  return applyReply(s, war, r, true);
}

/** A reply, recorded as an action unless the server makes it itself (reserves meeting a raise). */
function applyReply(s: SimState, war: SimWar, r: Reply, record: boolean): string | null {
  const counter = war.counter;
  if (war.status !== 'countered' || !counter) return 'nothing-to-answer';
  const allowed = { raise: ['accept', 'withdraw'], redirect: ['accept', 'withdraw'], tribute: ['accept', 'refuse'] };
  if (!allowed[counter.kind].includes(r.kind)) return 'bad-reply';
  if (counter.kind === 'raise' && r.kind === 'accept') {
    const stake = r.stake;
    if (!stake) return 'stake-required';
    const rejection = checkStake(warBoard(s), war.attackerId, war.targetId, war.launchId, stake, {
      minValue: counter.minValue,
      exceptWarId: war.id,
    });
    if (rejection) return rejection;
    war.stake = [war.launchId, ...stake.filter((id) => id !== war.launchId)];
  }
  war.reply = r.kind;
  s.stats.replies[r.kind]++;
  if (record) {
    s.actions.push({
      t: 'reply',
      war: war.id,
      reply: counter.kind === 'raise' && r.kind === 'accept' ? { kind: 'accept', stake: war.stake } : r,
    });
  }
  if (r.kind === 'withdraw') {
    resolve(s, war, 'withdrawn');
    return null;
  }
  if (counter.kind === 'tribute') {
    const defender = s.byId.get(war.defenderId)!;
    if (r.kind === 'refuse') {
      defender.tokens += counter.tokens;
      war.status = 'ready';
      return null;
    }
    s.byId.get(war.attackerId)!.tokens += counter.tokens;
    const transfers: Transfer[] = counter.territoryId
      ? [{ territoryId: counter.territoryId, from: war.defenderId, to: war.attackerId }]
      : [];
    resolve(s, war, 'tribute', { transfers });
    return null;
  }
  // A counter the defender paid for: the attacker gets the tokens for fighting on.
  if (counter.tokens) s.byId.get(war.attackerId)!.tokens += counter.tokens;
  if (counter.kind === 'redirect') {
    war.redirectedFrom = war.targetId;
    war.targetId = counter.targetId;
  }
  war.status = 'ready';
  return null;
}

/** The attacker calls off a declaration before the defender answers: the token is spent, no truce. */
export function recall(s: SimState, war: SimWar): string | null {
  if (!s.rules.war.recall) return 'no-recall';
  if (!canRecall(s.rules, war.status)) return 'already-answered';
  s.actions.push({ t: 'recall', war: war.id });
  s.stats.recalled++;
  note(s, () => `${war.attackerId} calls off ${war.id}`);
  resolve(s, war, 'withdrawn');
  return null;
}

/** A player spends a war token fortifying a country until the round after next starts. */
export function fortify(s: SimState, userId: UserId, territoryId: TerritoryId): string | null {
  if (s.status !== 'active') return 'not-active';
  const turn = turnIssue(s, userId);
  if (turn) return turn;
  const player = s.byId.get(userId)!;
  const rejection = checkFortify(warBoard(s), userId, territoryId);
  if (rejection) return rejection;
  if (player.tokens < FORTIFY_COST) return 'no-tokens';
  player.tokens -= FORTIFY_COST;
  s.holdings.set(territoryId, { ...s.holdings.get(territoryId)!, fortifiedUntil: fortifyEnds(s.round) });
  s.actions.push({ t: 'fortify', by: userId, territoryId });
  s.stats.fortified++;
  note(s, () => `${userId} fortifies ${nameOf(s, territoryId)}`);
  turnTaken(s, userId);
  return null;
}

/** Each side's war tokens: whoever pays in peace terms must have them. */
const tokensOf = (s: SimState, war: SimWar) => ({
  attacker: s.byId.get(war.attackerId)!.tokens,
  defender: s.byId.get(war.defenderId)!.tokens,
});

/** A player at war offers terms to end it. A new offer replaces their last one still open. */
export function offerPeace(s: SimState, war: SimWar, proposerId: UserId, terms: PeaceTerms): SimPeaceOffer | string {
  if (s.status !== 'active') return 'not-active';
  if (proposerId !== war.attackerId && proposerId !== war.defenderId) return 'not-party';
  if (war.status === 'resolved') return 'war-over';
  const board = warBoard(s);
  const issue = peaceIssue(
    board,
    board.wars.find((w) => w.id === war.id)!,
    terms,
    tokensOf(s, war),
  );
  if (issue) return issue;
  for (const o of s.peaceOffers) {
    if (o.warId === war.id && o.proposerId === proposerId && o.status === 'proposed') o.status = 'withdrawn';
  }
  const offer: SimPeaceOffer = {
    id: newId(s, 'o'),
    warId: war.id,
    proposerId,
    recipientId: proposerId === war.attackerId ? war.defenderId : war.attackerId,
    terms,
    status: 'proposed',
  };
  s.peaceOffers.push(offer);
  s.actions.push({ t: 'peace', war: war.id, offer: offer.id, by: proposerId, terms });
  s.stats.peaceOffered++;
  return offer;
}

/**
 * The player offered terms accepts or declines. Accepting ends the war on them: the terms change
 * hands, and an accord comes into force if they name one; missions are settled once after both.
 */
export function answerPeace(s: SimState, war: SimWar, offer: SimPeaceOffer, accept: boolean): string | null {
  if (offer.status !== 'proposed') return 'already-answered';
  if (!accept) {
    s.actions.push({ t: 'peace-answer', war: war.id, offer: offer.id, accept });
    offer.status = 'declined';
    return null;
  }
  if (s.status !== 'active') return 'not-active';
  if (war.status === 'resolved') return 'war-over';
  const board = warBoard(s);
  const issue = peaceIssue(
    board,
    board.wars.find((w) => w.id === war.id)!,
    offer.terms,
    tokensOf(s, war),
  );
  if (issue) return issue;
  const action: Extract<SimState['actions'][number], { t: 'peace-answer' }> = {
    t: 'peace-answer',
    war: war.id,
    offer: offer.id,
    accept,
  };
  s.actions.push(action);
  offer.status = 'accepted';
  s.stats.peaceAccepted++;
  if (war.status === 'declared') {
    war.response = 'peace';
    s.stats.responses.peace++;
  }
  const { terms } = offer;
  const attacker = s.byId.get(war.attackerId)!;
  const defender = s.byId.get(war.defenderId)!;
  attacker.tokens += terms.tokensToAttacker - terms.tokensToDefender;
  defender.tokens += terms.tokensToDefender - terms.tokensToAttacker;
  resolve(s, war, 'settled', { transfers: peaceTransfers(war, terms), settle: false });
  if (terms.accordRounds) {
    action.accord = signAgreedAccord(s, offer.proposerId, offer.recipientId, terms.accordRounds).id;
  }
  settle(s, new Set([war.attackerId, war.defenderId]));
  return null;
}

/** A game's result chosen in advance (tests), instead of the chess model's. */
export type ForcedGame = (war: SimWar, armageddon: boolean) => PlayedGame;

/** Fights a war's game (and any Armageddon tiebreak), then resolves it. */
export function fight(s: SimState, war: SimWar, forced?: ForcedGame): void {
  if (war.status !== 'ready') return;
  war.status = 'playing';
  s.stats.games++;
  const play = (armageddon: boolean) => {
    const game = forced ? forced(war, armageddon) : playGame(s, war, armageddon);
    s.actions.push({ t: 'game', war: war.id, armageddon, winner: game.winner, reason: game.reason });
    return game;
  };
  let game = play(false);
  let outcome = afterGame(s.rules, false, game.winner);
  if (outcome === 'armageddon') {
    war.armageddon = true;
    s.stats.armageddons++;
    game = play(true);
    outcome = afterGame(s.rules, true, game.winner);
  }
  if (game.reason === 'checkmate') s.stats.checkmates++;
  resolve(s, war, outcome as WarOutcome, { reason: game.reason });
}

/**
 * A war ends: countries change hands (each newly acquired this round, any fortification gone),
 * offers of peace still open lapse, and missions are settled (unless the caller settles them
 * itself, after more of the same change).
 */
export function resolve(
  s: SimState,
  war: SimWar,
  outcome: WarOutcome,
  detail: { transfers?: Transfer[]; reason?: GameEndReason; settle?: boolean } = {},
): void {
  const transfers = detail.transfers ?? warTransfers(war, outcome);
  for (const t of transfers) s.holdings.set(t.territoryId, { ownerId: t.to, acquiredRound: s.round });
  for (const o of s.peaceOffers) if (o.warId === war.id && o.status === 'proposed') o.status = 'lapsed';
  war.status = 'resolved';
  war.outcome = outcome;
  war.resolvedRound = s.round;
  war.seq = nextSeq(s);
  war.transfers = transfers;
  war.endReason = detail.reason ?? null;
  s.history.wars.push({
    id: war.id,
    attackerId: war.attackerId,
    defenderId: war.defenderId,
    launchId: war.launchId,
    targetId: war.targetId,
    outcome,
    transfers,
    declaredRound: war.declaredRound,
    round: s.round,
    declaredSeq: war.declaredSeq,
    seq: war.seq,
    endReason: war.endReason,
  });
  s.stats.outcomes[outcome]++;
  const moved = valueOfIds(
    s,
    transfers.map((t) => t.territoryId),
  );
  if (outcome === 'attacker') s.stats.valueTaken += moved;
  else if (outcome === 'defender') s.stats.valueRepelled += moved;
  else if (outcome === 'tribute') s.stats.valueTribute += moved;
  else if (outcome === 'settled') {
    const to = (userId: UserId) =>
      valueOf(
        s.idx,
        transfers.filter((t) => t.to === userId).map((t) => t.territoryId),
      );
    s.stats.valueSettled += to(war.attackerId) - to(war.defenderId);
  }
  note(s, () => {
    const what = transfers.map((t) => nameOf(s, t.territoryId)).join(', ');
    const how = war.endReason ? ` by ${war.endReason}` : '';
    return `${war.id} (${war.attackerId} on ${war.defenderId}, ${nameOf(s, war.targetId)}) ends: ${outcome}${how}${what ? ` — ${what}` : ''}`;
  });
  for (const id of [war.attackerId, war.defenderId]) {
    const p = s.byId.get(id)!;
    if (p.eliminatedRound === null && heldBy(s, id).size === 0) {
      p.eliminatedRound = s.round;
      note(s, `${id} is eliminated`);
    }
  }
  if (detail.settle !== false) settle(s, new Set([war.attackerId, war.defenderId]));
}
