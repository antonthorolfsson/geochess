/**
 * The chess side of a war: move legality, how games end, and clock arithmetic. Built on chessops
 * (GPL-3.0-or-later), so the server enforces and the board previews with the same code.
 */
import { Chess, castlingSide, normalizeMove } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import type { NormalMove } from 'chessops/types';
import { kingCastlesTo, makeSquare, makeUci, parseSquare, parseUci } from 'chessops/util';

export { INITIAL_FEN } from 'chessops/fen';

export type Color = 'white' | 'black';

export type GameResult = '1-0' | '0-1' | '1/2-1/2';

export type GameEndReason =
  | 'checkmate'
  | 'resignation'
  | 'timeout'
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold-repetition'
  | 'fifty-moves'
  | 'agreement'
  /** The flag fell, but the opponent could never have mated: a draw. */
  | 'timeout-vs-insufficient-material';

export interface GameEnding {
  result: GameResult;
  reason: GameEndReason;
}

export const opposite = (color: Color): Color => (color === 'white' ? 'black' : 'white');
export const colorToMove = (ply: number): Color => (ply % 2 === 0 ? 'white' : 'black');
export const winFor = (color: Color): GameResult => (color === 'white' ? '1-0' : '0-1');
export const winnerOf = (result: GameResult): Color | null =>
  result === '1-0' ? 'white' : result === '0-1' ? 'black' : null;

/**
 * A game rebuilt from its moves. Besides the position it counts how often each position has
 * occurred, for threefold repetition, which (like the fifty-move rule) ends the game at once.
 */
export class ChessGame {
  readonly pos: Chess;
  /** Moves in UCI, castling written as the king's two-square move (e1g1). */
  readonly moves: string[] = [];
  readonly sans: string[] = [];
  private readonly seen = new Map<string, number>();

  /** A game from the standard starting position, or from `initialFen`. */
  constructor(initialFen?: string) {
    this.pos = initialFen ? Chess.fromSetup(parseFen(initialFen).unwrap()).unwrap() : Chess.default();
    this.record();
  }

  /** Replays stored moves; throws if one is illegal, since stored games were validated. */
  static fromMoves(moves: readonly string[], initialFen?: string): ChessGame {
    const game = new ChessGame(initialFen);
    for (const uci of moves) {
      if (game.play(uci) === null) throw new Error(`Illegal move ${uci} at ply ${game.ply}`);
    }
    return game;
  }

  get turn(): Color {
    return this.pos.turn;
  }

  get ply(): number {
    return this.moves.length;
  }

  get fen(): string {
    return makeFen(this.pos.toSetup());
  }

  /** Plays a move given in UCI (castling as e1g1 or e1h1); returns its SAN, or null if it's illegal. */
  play(uci: string): string | null {
    const parsed = parseUci(uci);
    if (!parsed || !('from' in parsed)) return null;
    const move = normalizeMove(this.pos, parsed) as NormalMove;
    if (!this.pos.isLegal(move)) return null;
    const standard = standardUci(this.pos, move);
    const san = makeSanAndPlay(this.pos, move);
    this.moves.push(standard);
    this.sans.push(san);
    this.record();
    return san;
  }

  /** A move typed by a player, in SAN (Nf3, O-O, exd8=Q) or UCI (g1f3), as UCI; null if not legal here. */
  parseInput(text: string): string | null {
    const input = text.trim();
    if (!input) return null;
    const uci = parseUci(input.toLowerCase());
    if (uci && 'from' in uci) {
      const move = normalizeMove(this.pos, uci) as NormalMove;
      return this.pos.isLegal(move) ? standardUci(this.pos, move) : null;
    }
    const san = parseSan(this.pos, input.replace(/0/g, 'O'));
    return san && 'from' in san ? standardUci(this.pos, san) : null;
  }

  /** Legal moves per square, in chessground's shape. */
  dests(): Map<string, string[]> {
    return chessgroundDests(this.pos);
  }

  /** Whether moving from `from` to `to` (square names) takes a pawn to its last rank. */
  isPromotion(from: string, to: string): boolean {
    const square = parseSquare(from);
    const role = square === undefined ? undefined : this.pos.board.getRole(square);
    return role === 'pawn' && (to.endsWith('8') || to.endsWith('1'));
  }

  isCheck(): boolean {
    return this.pos.isCheck();
  }

  /** How the game has ended on the board, if it has: mate, stalemate, a dead position, repetition or fifty moves. */
  ending(): GameEnding | null {
    if (this.pos.isCheckmate()) return { result: winFor(opposite(this.pos.turn)), reason: 'checkmate' };
    if (this.pos.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
    if (this.pos.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient-material' };
    if ((this.seen.get(positionKey(this.pos)) ?? 0) >= 3) return { result: '1/2-1/2', reason: 'threefold-repetition' };
    if (this.pos.halfmoves >= 100) return { result: '1/2-1/2', reason: 'fifty-moves' };
    return null;
  }

  /** The result when `color` runs out of time: a loss, unless the opponent could never mate. */
  timeout(color: Color): GameEnding {
    const opponent = opposite(color);
    return this.pos.hasInsufficientMaterial(opponent)
      ? { result: '1/2-1/2', reason: 'timeout-vs-insufficient-material' }
      : { result: winFor(opponent), reason: 'timeout' };
  }

  private record(): void {
    const key = positionKey(this.pos);
    this.seen.set(key, (this.seen.get(key) ?? 0) + 1);
  }
}

/** Board, turn, castling rights and a capturable en passant square: what repetition compares. */
function positionKey(pos: Chess): string {
  return makeFen(pos.toSetup()).split(' ').slice(0, 4).join(' ');
}

/** UCI with castling as the king's two-square move, which is what players and boards expect. */
function standardUci(pos: Chess, move: NormalMove): string {
  const side = castlingSide(pos, move);
  if (!side) return makeUci(move);
  return makeSquare(move.from) + makeSquare(kingCastlesTo(pos.turn, side));
}

// ---------------------------------------------------------------------------------------------
// Clocks

export interface LiveClockSpec {
  initialMs: number;
  incrementMs: number;
}

/** Each side's clock. Live games have a clock and increment; correspondence games a time per move. */
export type TimeControl =
  | { kind: 'live'; white: LiveClockSpec; black: LiveClockSpec }
  | { kind: 'correspondence'; white: { perMoveMs: number }; black: { perMoveMs: number } };

/** Time left on each side's clock in a live game, in milliseconds. */
export interface Clocks {
  white: number;
  black: number;
}

export function initialClocks(tc: TimeControl): Clocks | null {
  return tc.kind === 'live' ? { white: tc.white.initialMs, black: tc.black.initialMs } : null;
}

/**
 * Charges the mover for their thinking time (already net of any lag compensation) and adds their
 * increment. `flagged` means their time ran out before the move arrived.
 */
export function chargeClock(
  tc: Extract<TimeControl, { kind: 'live' }>,
  clocks: Clocks,
  mover: Color,
  thinkingMs: number,
): { clocks: Clocks; flagged: boolean } {
  const left = clocks[mover] - Math.max(0, thinkingMs);
  if (left <= 0) return { clocks: { ...clocks, [mover]: 0 }, flagged: true };
  return { clocks: { ...clocks, [mover]: left + tc[mover].incrementMs }, flagged: false };
}

/** When the side to move loses on time, counting from `since` (the previous move, or the start). */
export function turnDeadline(tc: TimeControl, clocks: Clocks | null, turn: Color, since: number): number {
  if (tc.kind === 'live') return since + (clocks?.[turn] ?? tc[turn].initialMs);
  return since + tc[turn].perMoveMs;
}
