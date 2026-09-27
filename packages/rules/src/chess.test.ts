import { describe, expect, it } from 'vitest';
import { ChessGame, chargeClock, colorToMove, initialClocks, turnDeadline, type TimeControl } from './chess';

const moves = (text: string) => text.split(' ');

describe('chess games', () => {
  it('replay legal moves and reject illegal ones', () => {
    const game = ChessGame.fromMoves(moves('e2e4 e7e5 g1f3'));
    expect(game.sans).toEqual(['e4', 'e5', 'Nf3']);
    expect(game.turn).toBe('black');
    expect(game.play('e5e4')).toBeNull();
    expect(game.play('b8c6')).toBe('Nc6');
    expect(() => ChessGame.fromMoves(['e2e5'])).toThrow();
  });

  it('write castling as the king’s two-square move, whichever way it arrives', () => {
    const opening = moves('e2e4 e7e5 g1f3 b8c6 f1c4 g8f6');
    const viaRook = ChessGame.fromMoves(opening);
    expect(viaRook.play('e1h1')).toBe('O-O');
    const viaKing = ChessGame.fromMoves(opening);
    expect(viaKing.play('e1g1')).toBe('O-O');
    expect(viaRook.moves.at(-1)).toBe('e1g1');
    expect(viaKing.moves.at(-1)).toBe('e1g1');
  });

  it('parse typed moves in SAN or UCI', () => {
    const game = ChessGame.fromMoves(moves('e2e4 e7e5 g1f3 b8c6 f1c4 g8f6'));
    expect(game.parseInput('O-O')).toBe('e1g1');
    expect(game.parseInput('0-0')).toBe('e1g1');
    expect(game.parseInput('Ng5')).toBe('f3g5');
    expect(game.parseInput('d2d4')).toBe('d2d4');
    expect(game.parseInput('Qh8')).toBeNull();
    expect(game.parseInput('  ')).toBeNull();
    expect(new ChessGame('8/P6k/8/8/8/8/8/K7 w - - 0 1').parseInput('a8=Q')).toBe('a7a8q');
  });

  it('know a promotion when a pawn reaches the last rank', () => {
    const game = new ChessGame('8/P6k/8/8/8/8/p7/K7 w - - 0 1');
    expect(game.isPromotion('a7', 'a8')).toBe(true);
    expect(game.isPromotion('a1', 'b1')).toBe(false);
    expect(game.isPromotion('h9', 'a8')).toBe(false);
  });

  it('list legal destinations for the board', () => {
    const dests = new ChessGame().dests();
    expect(dests.get('g1')).toEqual(['f3', 'h3']);
    expect([...dests.values()].flat()).toHaveLength(20);
  });

  it('detect checkmate and stalemate', () => {
    expect(ChessGame.fromMoves(moves('f2f3 e7e5 g2g4 d8h4')).ending()).toEqual({ result: '0-1', reason: 'checkmate' });
    const stalemate = new ChessGame('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
    stalemate.play('g6h6');
    expect(stalemate.ending()).toEqual({ result: '1/2-1/2', reason: 'stalemate' });
  });

  it('draw on threefold repetition and after fifty moves', () => {
    const shuffle = moves('g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8');
    expect(ChessGame.fromMoves(shuffle.slice(0, 7)).ending()).toBeNull();
    expect(ChessGame.fromMoves(shuffle).ending()).toEqual({ result: '1/2-1/2', reason: 'threefold-repetition' });
    const slow = new ChessGame('4k3/8/8/8/8/8/8/R3K3 w - - 99 80');
    expect(slow.ending()).toBeNull();
    slow.play('a1a2');
    expect(slow.ending()).toEqual({ result: '1/2-1/2', reason: 'fifty-moves' });
  });

  it('draw a dead position, and a flag against a bare king', () => {
    const bare = new ChessGame('4k3/8/8/8/8/8/4q3/4K3 w - - 0 1');
    bare.play('e1e2');
    expect(bare.ending()).toEqual({ result: '1/2-1/2', reason: 'insufficient-material' });
    const lone = new ChessGame('4k3/8/8/8/8/8/8/R3K3 b - - 0 1');
    expect(lone.timeout('white')).toEqual({ result: '1/2-1/2', reason: 'timeout-vs-insufficient-material' });
    expect(lone.timeout('black')).toEqual({ result: '1-0', reason: 'timeout' });
  });
});

describe('clocks', () => {
  const live: Extract<TimeControl, { kind: 'live' }> = {
    kind: 'live',
    white: { initialMs: 300_000, incrementMs: 3000 },
    black: { initialMs: 345_000, incrementMs: 3450 },
  };

  it('charge thinking time and add the increment', () => {
    const start = initialClocks(live)!;
    expect(chargeClock(live, start, 'white', 10_000)).toEqual({
      clocks: { white: 293_000, black: 345_000 },
      flagged: false,
    });
    expect(chargeClock(live, start, 'black', 400_000)).toEqual({ clocks: { white: 300_000, black: 0 }, flagged: true });
  });

  it('set the deadline from the clock live, and from the time per move in correspondence', () => {
    expect(turnDeadline(live, { white: 12_000, black: 1 }, 'white', 1000)).toBe(13_000);
    const corr: TimeControl = { kind: 'correspondence', white: { perMoveMs: 100 }, black: { perMoveMs: 200 } };
    expect(turnDeadline(corr, null, colorToMove(1), 1000)).toBe(1200);
    expect(initialClocks(corr)).toBeNull();
  });
});
