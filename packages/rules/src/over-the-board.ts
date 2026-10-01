/**
 * Playing a war's game over the board: friends who meet up play it on a real board, and the
 * result is reported here. Either player offers, the other accepts, and the online game stops
 * (no moves, no clocks). When the game is over, a player reports a win or a draw and the other
 * confirms or disputes it; resigning reports a loss at once. A report nobody answers in the answer
 * window stands. Either player can take the game back online, with the clocks as they were,
 * unless a report is waiting for an answer. Bots play online only.
 */
import { winFor, type Color, type GameResult } from './chess';
import type { Pace } from './config';
import type { UserId } from './draft';
import { RESPONSE_WINDOW_MS, RESPONSE_WINDOW_TEXT } from './war';

/** A result reported over the board, waiting for the other player to confirm it. */
export interface ResultReport {
  by: UserId;
  result: GameResult;
}

export type OverTheBoardAction =
  /** Moving the game over the board: offered, then accepted or declined by the other player. */
  | 'offer'
  | 'accept'
  | 'decline'
  /** Reporting the result: a win for the reporter, or a draw. */
  | 'report-win'
  | 'report-draw'
  /** Answering the other player's report. */
  | 'confirm'
  | 'dispute'
  /** Back to the online board. */
  | 'online';

/** What the over-the-board rules need about a game. */
export interface OverTheBoardState {
  status: 'waiting' | 'playing' | 'finished' | 'cancelled';
  whiteId: UserId;
  blackId: UserId;
  /** A standing offer to play over the board. */
  offerBy: UserId | null;
  overTheBoard: boolean;
  report: ResultReport | null;
}

export type OverTheBoardRejection =
  'not-playing' | 'bot' | 'over-the-board' | 'online' | 'no-offer' | 'offered' | 'no-report' | 'report-waiting';

export const OVER_THE_BOARD_REJECTION_MESSAGES: Record<OverTheBoardRejection, string> = {
  'not-playing': 'This game is not underway.',
  bot: 'Bots play online only.',
  'over-the-board': 'This game is already being played over the board.',
  online: 'This game is being played online.',
  'no-offer': 'There is no offer to play over the board.',
  offered: 'You have already offered to play over the board.',
  'no-report': 'There is no result to answer.',
  'report-waiting': 'A reported result is waiting for an answer.',
};

/** How a game changes; `ending` finishes it. */
export interface OverTheBoardChange {
  offerBy?: UserId | null;
  overTheBoard?: boolean;
  report?: ResultReport | null;
  ending?: GameResult;
}

/** How long a reported result waits for the other player before it stands: the answer window. */
export const REPORT_WINDOW_MS: Record<Pace, number> = RESPONSE_WINDOW_MS;
export const REPORT_WINDOW_TEXT: Record<Pace, string> = RESPONSE_WINDOW_TEXT;

const colorOf = (state: OverTheBoardState, userId: UserId): Color => (state.whiteId === userId ? 'white' : 'black');

/**
 * What `action` by `userId` (one of the players) does to the game, or why it can't. `bots` are the
 * seats a bot plays, which can't play over the board.
 */
export function overTheBoard(
  state: OverTheBoardState,
  userId: UserId,
  action: OverTheBoardAction,
  bots: ReadonlySet<UserId> = new Set(),
): { ok: true; change: OverTheBoardChange } | { ok: false; reason: OverTheBoardRejection } {
  const no = (reason: OverTheBoardRejection) => ({ ok: false as const, reason });
  if (state.status !== 'playing') return no('not-playing');
  const opponentId = state.whiteId === userId ? state.blackId : state.whiteId;
  switch (action) {
    case 'offer':
      if (state.overTheBoard) return no('over-the-board');
      if (bots.has(userId) || bots.has(opponentId)) return no('bot');
      if (state.offerBy === userId) return no('offered');
      // Offering back accepts.
      if (state.offerBy === opponentId) return { ok: true, change: { offerBy: null, overTheBoard: true } };
      return { ok: true, change: { offerBy: userId } };
    case 'accept':
      if (state.overTheBoard) return no('over-the-board');
      if (state.offerBy !== opponentId) return no('no-offer');
      if (bots.has(userId) || bots.has(opponentId)) return no('bot');
      return { ok: true, change: { offerBy: null, overTheBoard: true } };
    case 'decline':
      if (state.offerBy !== opponentId) return no('no-offer');
      return { ok: true, change: { offerBy: null } };
    case 'report-win':
    case 'report-draw': {
      if (!state.overTheBoard) return no('online');
      // A player may change their own report; the other answers it first.
      if (state.report && state.report.by !== userId) return no('report-waiting');
      const result = action === 'report-win' ? winFor(colorOf(state, userId)) : '1/2-1/2';
      return { ok: true, change: { report: { by: userId, result } } };
    }
    case 'confirm':
      if (!state.overTheBoard) return no('online');
      if (state.report?.by !== opponentId) return no('no-report');
      return { ok: true, change: { report: null, ending: state.report.result } };
    case 'dispute':
      if (!state.overTheBoard) return no('online');
      if (state.report?.by !== opponentId) return no('no-report');
      return { ok: true, change: { report: null } };
    case 'online':
      if (!state.overTheBoard) return no('online');
      if (state.report) return no('report-waiting');
      return { ok: true, change: { overTheBoard: false } };
  }
}
