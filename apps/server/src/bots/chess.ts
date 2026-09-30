/**
 * How a bot plays chess at its level: the search it asks Stockfish for, the random moves the
 * lowest levels mix in, how long it pauses over a live move, and when it takes a draw.
 */
import { ChessGame, colorToMove, type Color, type DrawRule } from '@empire/rules';
import { STOCKFISH_ELO, type ChessEngine, type Score } from './engine';

export interface LevelPlay {
  /** Stockfish's `UCI_Elo`, or null for full strength. */
  elo: number | null;
  /** The chance of a random legal move instead of the engine's. */
  randomMoves: number;
  depth: number;
  /** The longest a move may take (full strength only; a limited Stockfish picks at a fixed depth). */
  movetimeMs?: number;
}

/**
 * Stockfish's own mapping from `UCI_Elo` to its skill level (`Skill` in its search.cpp). A limited
 * Stockfish chooses its move once its search reaches depth 1 + the level, so searching deeper only
 * burns time.
 */
export function skillLevel(elo: number): number {
  const e = (elo - STOCKFISH_ELO.min) / (STOCKFISH_ELO.max - STOCKFISH_ELO.min);
  return Math.min(19, Math.max(0, ((37.2473 * e - 40.8525) * e + 22.2943) * e - 0.311438));
}

const limited = (elo: number, randomMoves = 0): LevelPlay => ({
  elo,
  randomMoves,
  depth: 1 + Math.floor(skillLevel(elo)),
});

/** Levels 1 to 8 (`BOT_LEVELS` in the rules describes them to players). */
export const LEVEL_PLAY: Record<number, LevelPlay> = {
  1: limited(STOCKFISH_ELO.min, 0.35),
  2: limited(STOCKFISH_ELO.min, 0.12),
  3: limited(1400),
  4: limited(1500),
  5: limited(1900),
  6: limited(2400),
  7: limited(2700),
  8: { elo: null, randomMoves: 0, depth: 20, movetimeMs: 1500 },
};

/** At full strength the first moves vary among near-equal choices, so games don't repeat. */
const VARIED_PLIES = 10;
const VARIED_WITHIN_CP = 30;

export function levelPlay(level: number): LevelPlay {
  const play = LEVEL_PLAY[level];
  if (!play) throw new Error(`Unknown bot level: ${level}`);
  return play;
}

const pickOne = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)]!;

/** A score as centipawns for comparison, mates beyond any material. */
export function centipawns(score: Score | undefined): number {
  if (!score) return 0;
  if ('cp' in score) return score.cp;
  return score.mate > 0 ? 100_000 - score.mate : -100_000 - score.mate;
}

/**
 * The bot's move in a game (UCI). `movetimeMs` shortens a full-strength search when the clock is
 * low. Should the engine fail, a random legal move keeps the game going.
 */
export async function chooseMove(
  engine: ChessEngine,
  level: number,
  moves: readonly string[],
  random: () => number,
  opts: { movetimeMs?: number; onError?: (err: unknown) => void } = {},
): Promise<string> {
  const legal = ChessGame.fromMoves(moves).legalMoves();
  if (legal.length === 0) throw new Error('There is no legal move to play.');
  if (legal.length === 1) return legal[0]!;
  const play = levelPlay(level);
  if (random() < play.randomMoves) return pickOne(legal, random);
  const varied = play.elo === null && moves.length < VARIED_PLIES;
  try {
    const movetimeMs =
      play.movetimeMs === undefined ? undefined : Math.min(play.movetimeMs, opts.movetimeMs ?? play.movetimeMs);
    const result = await engine.search({
      moves,
      elo: play.elo,
      depth: play.depth,
      movetimeMs,
      multiPv: varied ? 3 : 1,
    });
    let move = result.bestMove;
    if (varied && result.lines.length > 1) {
      const best = centipawns(result.lines[0]!.score);
      move = pickOne(
        result.lines.filter((l) => centipawns(l.score) >= best - VARIED_WITHIN_CP),
        random,
      ).move;
    }
    if (move && legal.includes(move)) return move;
    throw new Error(`The engine offered ${move ?? 'no move'}, which is not legal here.`);
  } catch (err) {
    opts.onError?.(err);
    return pickOne(legal, random);
  }
}

/**
 * How long a bot pauses over a live move: quick in the opening and when short of time, a few
 * seconds otherwise, and never much of its clock.
 */
export function thinkingMs(clockMs: number, incrementMs: number, ply: number, random: () => number): number {
  const jitter = 0.5 + random();
  if (clockMs < 20_000) return Math.min(200 + 400 * random(), clockMs / 20);
  if (ply < 8) return 500 + 800 * random();
  const pause = Math.min(clockMs / 100 + incrementMs / 3, 6_000) * jitter;
  return Math.max(300, Math.min(pause, clockMs / 15));
}

/**
 * The best score for the bot, as centipawns, at or below which it takes a draw: always when a
 * draw wins it the war, never when a draw loses it, and otherwise when it isn't doing better.
 */
export function drawThreshold(game: { armageddon: boolean }, draws: DrawRule, bot: Color, attacker: boolean): number {
  // In Armageddon, Black wins on a draw.
  if (game.armageddon) return bot === 'black' ? Infinity : -Infinity;
  // A draw sends the war to Armageddon, which favours the attacker (Black, winning a draw).
  if (draws === 'armageddon') return attacker ? 150 : -150;
  // The defender holds: nothing changes hands either way.
  return 30;
}

/** Whether the bot playing `bot` accepts a draw offered in this position. */
export async function takesDraw(
  engine: ChessEngine,
  moves: readonly string[],
  bot: Color,
  threshold: number,
): Promise<boolean> {
  if (threshold === Infinity) return true;
  if (threshold === -Infinity) return false;
  const { lines } = await engine.search({ moves, elo: null, depth: 12, movetimeMs: 1000 });
  const forMover = centipawns(lines[0]?.score);
  const forBot = colorToMove(moves.length) === bot ? forMover : -forMover;
  return forBot <= threshold;
}
