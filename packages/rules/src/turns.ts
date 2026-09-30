/**
 * Declaring in turns (`rules.war.turns`). Each round, players take turns round the table: on a
 * turn, declare one war or fortify one country, or pass, which ends their declaring for the
 * round. Answers, games, peace terms and diplomacy don't wait for turns. Without the setting,
 * anyone declares whenever they like (the original rule).
 */
import type { Pace } from './config';
import type { UserId } from './draft';
import {
  FORTIFY_COST,
  RESPONSE_WINDOW_MS,
  RESPONSE_WINDOW_TEXT,
  attackableTargets,
  checkFortify,
  type WarBoard,
} from './war';

/** How long a player has for a turn before it passes for them: the same as the answer window. */
export const TURN_WINDOW_MS: Record<Pace, number> = RESPONSE_WINDOW_MS;
export const TURN_WINDOW_TEXT: Record<Pace, string> = RESPONSE_WINDOW_TEXT;

/** War tokens a declaration costs. */
export const DECLARE_COST = 1;

/** Where declaring stands in a round. */
export interface TurnState {
  /** The round's order. */
  order: readonly UserId[];
  /** Players who passed, or whose time ran out: done declaring for the round. */
  passed: readonly UserId[];
  /** Whose turn it is, or null once declaring is over for the round. */
  current: UserId | null;
}

/**
 * The order players take their turns in during `round`: the draft's seats, round the table, one
 * seat further along each round, so everyone goes first in turn. Round 1 starts with whoever
 * drafted last, since the first seat already had the draft's first pick.
 */
export function turnOrder(seats: readonly UserId[], round: number): UserId[] {
  const n = seats.length;
  if (n === 0) return [];
  const first = (((n - 2 + round) % n) + n) % n;
  return [...seats.slice(first), ...seats.slice(0, first)];
}

/**
 * Whether a player has anything to do with a turn: tokens for a declaration and a country to
 * declare war on, or tokens to fortify and a country of theirs to fortify.
 */
export function canTakeTurn(board: WarBoard, userId: UserId, tokens: number): boolean {
  if (board.rules.war.fortify && tokens >= FORTIFY_COST) {
    for (const [id, holding] of board.holdings) {
      if (holding.ownerId === userId && checkFortify(board, userId, id) === null) return true;
    }
  }
  return tokens >= DECLARE_COST && attackableTargets(board, userId).size > 0;
}

/**
 * Whose turn comes next after `after`'s (or first in the round, with null): round the order from
 * the seat after theirs, with them last, passing over anyone who passed or has nothing to do
 * (`canAct`). A player `busy` in a live game goes after everyone else who can act. Null when
 * nobody can: declaring is over for the round.
 */
export function nextTurn(
  state: Pick<TurnState, 'order' | 'passed'>,
  after: UserId | null,
  canAct: (userId: UserId) => boolean,
  busy: (userId: UserId) => boolean = () => false,
): UserId | null {
  const { order, passed } = state;
  const start = after === null ? 0 : order.indexOf(after) + 1;
  let deferred: UserId | null = null;
  for (let i = 0; i < order.length; i++) {
    const id = order[(start + i) % order.length]!;
    if (passed.includes(id)) continue;
    if (busy(id)) {
      if (deferred === null && canAct(id)) deferred = id;
    } else if (canAct(id)) {
      return id;
    }
  }
  return deferred;
}

export type TurnRejection = 'not-your-turn' | 'turns-over';

export const TURN_REJECTION_MESSAGES: Record<TurnRejection, string> = {
  'not-your-turn': 'Wait for your turn: players declare war and fortify in turn.',
  'turns-over': 'Declaring is over for this round. The next round brings new turns.',
};

/**
 * Why `userId` can't declare war or fortify now, as far as turns go, or null if they can. With no
 * turns this round (`state` null), anyone can.
 */
export function checkTurn(state: TurnState | null, userId: UserId): TurnRejection | null {
  if (!state) return null;
  if (state.current === null) return 'turns-over';
  return state.current === userId ? null : 'not-your-turn';
}

/**
 * Turns to come before `userId`'s: whoever's turn it is, then the players after them who haven't
 * passed and have something to do (`canAct`, as things stand). A guide, since that can change
 * before their turns come. Null once declaring is over, or when `userId` has passed.
 */
export function turnsBefore(
  state: TurnState,
  userId: UserId,
  canAct: (userId: UserId) => boolean = () => true,
): number | null {
  if (state.current === null || state.passed.includes(userId)) return null;
  const n = state.order.length;
  const start = state.order.indexOf(state.current);
  if (start < 0 || !state.order.includes(userId)) return null;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const id = state.order[(start + i) % n]!;
    if (id === userId) return count;
    if (i === 0 || (!state.passed.includes(id) && canAct(id))) count++;
  }
  return null;
}
