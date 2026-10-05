/**
 * Declaring in turns, as apps/server/src/wars/turns.ts runs it: each round starts at the top of an
 * order that moves on a seat a round, and after each declaration, fortification or pass the turn
 * goes to the next player with something to do. Nobody is ever busy in a live game here, since the
 * simulator plays every game within the actions that fight it.
 */
import { canTakeTurn, checkTurn, nextTurn, turnOrder, type TurnRejection, type UserId } from '@empire/rules';
import { warBoard } from './board';
import { note } from './state';
import type { SimState } from './types';

/** A round has started (tokens given, accords settled): turns start at the top of the order. */
export function beginTurns(s: SimState): void {
  if (!s.rules.war.turns) {
    s.turns = null;
    return;
  }
  s.turns = { order: turnOrder(s.order, s.round), passed: [], current: null };
  giveNextTurn(s, null);
}

function giveNextTurn(s: SimState, after: UserId | null): void {
  const turns = s.turns!;
  const board = warBoard(s);
  turns.current = nextTurn(turns, after, (id) => canTakeTurn(board, id, s.byId.get(id)!.tokens));
  if (!turns.current) {
    s.turnsEndedRound = s.round;
    note(s, 'declaring is over for the round');
  }
}

/** Why a player can't declare war or fortify now, as far as turns go, or null if they can. */
export const turnIssue = (s: SimState, userId: UserId): TurnRejection | null => checkTurn(s.turns, userId);

/** A player declared war or fortified on their turn: the turn moves on. */
export function turnTaken(s: SimState, userId: UserId): void {
  if (s.turns?.current === userId) giveNextTurn(s, userId);
}

/** A player passes their turn, ending their declaring for the round. Returns why it's refused, or null. */
export function pass(s: SimState, userId: UserId): string | null {
  if (s.status !== 'active') return 'not-active';
  const turns = s.turns;
  if (!turns) return 'no-turns';
  if (!turns.current) return 'turns-over';
  if (turns.current !== userId) return 'not-your-turn';
  turns.passed = [...turns.passed, userId];
  s.actions.push({ t: 'pass', by: userId });
  note(s, `${userId} passes`);
  giveNextTurn(s, userId);
  return null;
}
