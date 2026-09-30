import { BOT_LEVELS, ChessGame } from '@empire/rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEVEL_PLAY, chooseMove, drawThreshold, skillLevel, takesDraw, thinkingMs } from '../src/bots/chess';
import { STOCKFISH_ELO, StockfishEngine, findStockfish } from '../src/bots/engine';

/** The Stockfish build the server ships, played for real. */
const path = findStockfish();
const warnings: unknown[] = [];
let engine: StockfishEngine;
beforeAll(() => {
  engine = new StockfishEngine({ path: path!, log: { warn: (...args: unknown[]) => void warnings.push(args) } });
});
afterAll(async () => {
  await engine.close();
});

const moves = (text: string) => text.split(' ');
/** White mates with Qxf7 next. */
const BEFORE_SCHOLARS_MATE = moves('e2e4 e7e5 f1c4 b8c6 d1h5 g8f6');

describe('the shipped Stockfish', () => {
  it('is found beside the server', () => {
    expect(path).toMatch(/engine[\\/]stockfish-19-lite-single\.js$/);
  });

  it('plays a legal move at every level', { timeout: 30_000 }, async () => {
    const opening = moves('e2e4 e7e5 g1f3 b8c6');
    const legal = ChessGame.fromMoves(opening).legalMoves();
    for (const { level } of BOT_LEVELS) {
      expect(legal, `level ${level}`).toContain(await chooseMove(engine, level, opening, Math.random));
    }
    expect(warnings).toEqual([]);
  });

  it('finds a mate in one at full strength, and scores it', { timeout: 30_000 }, async () => {
    expect(await chooseMove(engine, 8, BEFORE_SCHOLARS_MATE, () => 0.5)).toBe('h5f7');
    const { lines } = await engine.search({ moves: BEFORE_SCHOLARS_MATE, elo: null, depth: 6 });
    expect(lines[0]).toEqual({ move: 'h5f7', score: { mate: 1 } });
  });

  it('reports several lines, best first', { timeout: 30_000 }, async () => {
    const { lines } = await engine.search({ moves: [], elo: null, depth: 8, multiPv: 3 });
    expect(lines).toHaveLength(3);
    const cp = lines.map((l) => ('cp' in l.score ? l.score.cp : NaN));
    expect(cp).toEqual([...cp].sort((a, b) => b - a));
  });

  it('weighs a draw by the position', { timeout: 30_000 }, async () => {
    // White is a queen up, Black to move.
    const queenUp = moves('e2e4 d7d5 e4d5 d8d5 b1c3 d5e5 g1e2 e5e4 c3e4');
    expect(await takesDraw(engine, queenUp, 'black', 30)).toBe(true);
    expect(await takesDraw(engine, queenUp, 'white', 30)).toBe(false);
  });

  it('answers searches one after another, and starts afresh after its process dies', { timeout: 30_000 }, async () => {
    const results = await Promise.all([1, 2, 3].map((d) => engine.search({ moves: [], elo: 1500, depth: d })));
    for (const r of results) expect(new ChessGame().legalMoves()).toContain(r.bestMove);
    engine['proc']?.kill('SIGKILL');
    const again = await engine.search({ moves: ['e2e4'], elo: null, depth: 4 });
    expect(ChessGame.fromMoves(['e2e4']).legalMoves()).toContain(again.bestMove);
  });
});

describe('bot levels', () => {
  it('follow Stockfish’s own strength scale', () => {
    expect(skillLevel(STOCKFISH_ELO.min)).toBe(0);
    expect(skillLevel(2068)).toBeCloseTo(4.45, 1);
    expect(skillLevel(STOCKFISH_ELO.max)).toBeCloseTo(18.38, 1);
    // Stockfish picks its move at depth 1 + its skill level, so that's as deep as a level searches.
    for (const play of Object.values(LEVEL_PLAY)) {
      if (play.elo !== null) expect(play.depth).toBe(1 + Math.floor(skillLevel(play.elo)));
    }
    const elos = Object.values(LEVEL_PLAY).map((p) => p.elo ?? Infinity);
    expect(elos).toEqual([...elos].sort((a, b) => a - b));
  });

  it('pause briefly over live moves, never much of the clock', () => {
    for (const r of [0, 0.5, 0.999]) {
      const random = () => r;
      expect(thinkingMs(300_000, 3_000, 2, random)).toBeLessThanOrEqual(1_300);
      const middle = thinkingMs(300_000, 3_000, 30, random);
      expect(middle).toBeGreaterThanOrEqual(300);
      expect(middle).toBeLessThanOrEqual(9_000);
      expect(thinkingMs(10_000, 2_000, 30, random)).toBeLessThanOrEqual(500);
    }
  });

  it('take a draw when it wins the war and never when it loses it', () => {
    expect(drawThreshold({ armageddon: true }, 'armageddon', 'black', true)).toBe(Infinity);
    expect(drawThreshold({ armageddon: true }, 'armageddon', 'white', false)).toBe(-Infinity);
    expect(drawThreshold({ armageddon: false }, 'armageddon', 'white', true)).toBeGreaterThan(0);
    expect(drawThreshold({ armageddon: false }, 'armageddon', 'black', false)).toBeLessThan(0);
    expect(drawThreshold({ armageddon: false }, 'defender-holds', 'black', false)).toBe(30);
  });
});
