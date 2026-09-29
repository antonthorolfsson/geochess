/**
 * The war lifecycle, as apps/server/src/wars/service.ts runs it: declare, answer, reply, fight,
 * resolve. Every check comes from the rules package; an illegal action is refused with the rules'
 * own reason, never applied.
 */
import {
  afterGame,
  canRaise,
  checkStake,
  checkTarget,
  raiseFloor,
  redirectOptions,
  tributeOptions,
  warTransfers,
  type GameEndReason,
  type TerritoryId,
  type Transfer,
  type UserId,
  type WarOutcome,
} from '@empire/rules';
import { weighted } from '../random';
import { warBoard } from './board';
import { playGame, type PlayedGame } from './chess';
import { heldBy, nameOf, newId, nextSeq, note, valueOfIds } from './state';
import type { SimState, SimWar } from './types';
import { settle } from './victory';

export interface Declaration {
  targetId: TerritoryId;
  launchId: TerritoryId;
  stake: TerritoryId[];
}

export type Response =
  | { kind: 'accept' }
  | { kind: 'raise' }
  | { kind: 'redirect'; targetId: TerritoryId }
  | { kind: 'tribute'; territoryId: TerritoryId }
  | { kind: 'tribute'; tokens: number };

export type Reply = { kind: 'accept'; stake?: TerritoryId[] } | { kind: 'withdraw' } | { kind: 'refuse' };

/** Declares war, or says why it can't be declared. */
export function declare(s: SimState, attackerId: UserId, d: Declaration): SimWar | string {
  const attacker = s.byId.get(attackerId)!;
  if (s.status !== 'active') return 'not-active';
  if (attacker.tokens < 1) return 'no-tokens';
  const board = warBoard(s);
  const target = checkTarget(board, attackerId, d.targetId);
  if (target) return target;
  const stake = checkStake(board, attackerId, d.targetId, d.launchId, d.stake);
  if (stake) return stake;
  const latency = weighted(s.cfg.latency, s.rng.latency);
  const war: SimWar = {
    id: newId(s, 'w'),
    attackerId,
    defenderId: s.holdings.get(d.targetId)!.ownerId,
    targetId: d.targetId,
    launchId: d.launchId,
    stake: [d.launchId, ...d.stake.filter((id) => id !== d.launchId)],
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
  });
  attacker.tokens -= 1;
  s.stats.declared++;
  note(
    s,
    () =>
      `${attackerId} declares war on ${war.defenderId}: ${nameOf(s, d.targetId)} (${s.idx.byId.get(d.targetId)!.value}) ` +
      `from ${nameOf(s, d.launchId)}, staking ${valueOfIds(s, war.stake)}`,
  );
  return war;
}

/** The defender answers a declaration. Returns why it's refused, or null. */
export function respond(s: SimState, war: SimWar, r: Response): string | null {
  if (war.status !== 'declared') return 'already-answered';
  const board = warBoard(s);
  const active = board.wars.find((w) => w.id === war.id)!;
  const defender = s.byId.get(war.defenderId)!;
  switch (r.kind) {
    case 'accept':
      war.status = 'ready';
      war.response = 'accept';
      break;
    case 'raise':
      if (!canRaise(board, active)) return 'cannot-raise';
      war.counter = { kind: 'raise', minValue: raiseFloor(s.rules, s.idx.byId.get(war.targetId)!.value) };
      war.status = 'countered';
      war.response = 'raise';
      break;
    case 'redirect':
      if (!redirectOptions(board, active).includes(r.targetId)) return 'bad-redirect';
      war.counter = { kind: 'redirect', targetId: r.targetId };
      war.status = 'countered';
      war.response = 'redirect';
      break;
    case 'tribute':
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
  return null;
}

function describeCounter(s: SimState, war: SimWar): string {
  const c = war.counter!;
  if (c.kind === 'raise') return `a raise to ${c.minValue}`;
  if (c.kind === 'redirect') return `a redirect to ${nameOf(s, c.targetId)}`;
  return c.territoryId ? `tribute: ${nameOf(s, c.territoryId)}` : `tribute: ${c.tokens} tokens`;
}

/** The attacker answers a counter-offer. Returns why it's refused, or null. */
export function reply(s: SimState, war: SimWar, r: Reply): string | null {
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
  s.actions.push({
    t: 'reply',
    war: war.id,
    reply: counter.kind === 'raise' && r.kind === 'accept' ? { kind: 'accept', stake: war.stake } : r,
  });
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
  if (counter.kind === 'redirect') {
    war.redirectedFrom = war.targetId;
    war.targetId = counter.targetId;
  }
  war.status = 'ready';
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

/** A war ends: countries change hands (each newly acquired this round), and missions are settled. */
export function resolve(
  s: SimState,
  war: SimWar,
  outcome: WarOutcome,
  detail: { transfers?: Transfer[]; reason?: GameEndReason } = {},
): void {
  const transfers = detail.transfers ?? warTransfers(war, outcome);
  for (const t of transfers) s.holdings.set(t.territoryId, { ownerId: t.to, acquiredRound: s.round });
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
  settle(s, new Set([war.attackerId, war.defenderId]));
}
