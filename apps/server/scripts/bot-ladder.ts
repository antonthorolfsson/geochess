/**
 * The bot levels' ladder. Levels play each other with the shipped Stockfish, as bots play in a
 * campaign; a Bradley–Terry fit of every result, anchored on Stockfish's own calibration of
 * level 3 (`UCI_Elo` 1400), gives each level a rating. `BOT_LEVELS` in the rules quotes it.
 *
 *   pnpm --filter @empire/server bot-ladder --games 100 --engines 8
 *   pnpm --filter @empire/server bot-ladder --levels 1-4        # part of the ladder
 *
 * Adjacent levels play `--games` games each way round (and levels two apart half as many, to tie
 * the ladder together); pairings with level 8, which thinks for over a second a move, play
 * `--engine-games`. Games longer than `--max-plies` are scored as draws.
 */
import { BOT_LEVELS, ChessGame, type GameResult } from '@empire/rules';
import { parseArgs } from 'node:util';
import { LEVEL_PLAY, chooseMove } from '../src/bots/chess';
import { StockfishEngine, findStockfish } from '../src/bots/engine';

const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '100' },
    'engine-games': { type: 'string', default: '20' },
    engines: { type: 'string', default: '8' },
    'max-plies': { type: 'string', default: '300' },
    levels: { type: 'string', default: '1-8' },
  },
});
const [lowest, highest] = values.levels.split('-').map(Number) as [number, number];
const GAMES = Number(values.games);
const ENGINE_GAMES = Number(values['engine-games']);
const ENGINES = Number(values.engines);
const MAX_PLIES = Number(values['max-plies']);
const ANCHOR = { level: 3, rating: LEVEL_PLAY[3]!.elo! };
if (
  !values.levels
    .split('-')
    .map(Number)
    .every((n) => n >= 1 && n <= BOT_LEVELS.length)
) {
  throw new Error('--levels takes a range such as 1-4.');
}
const levels = BOT_LEVELS.map((l) => l.level).filter((l) => l >= lowest && l <= (highest ?? lowest));
/** Level 8 thinks for over a second a move, so its pairings play fewer games. */
const top = BOT_LEVELS.length;

interface Pairing {
  white: number;
  black: number;
}

const pairings: Pairing[] = [];
for (const a of levels) {
  for (const gap of [1, 2]) {
    const b = a + gap;
    if (!levels.includes(b)) continue;
    const n = b === top ? ENGINE_GAMES : gap === 1 ? GAMES : Math.ceil(GAMES / 2);
    for (let i = 0; i < n; i++) pairings.push(i % 2 === 0 ? { white: a, black: b } : { white: b, black: a });
  }
}

async function play(engine: StockfishEngine, { white, black }: Pairing): Promise<GameResult> {
  const game = new ChessGame();
  for (;;) {
    const ending = game.ending();
    if (ending) return ending.result;
    if (game.ply >= MAX_PLIES) return '1/2-1/2';
    const uci = await chooseMove(engine, game.turn === 'white' ? white : black, game.moves, Math.random);
    if (game.play(uci) === null) throw new Error(`Illegal move ${uci}`);
  }
}

const log = { warn: (...args: unknown[]) => console.warn(...args) };
const path = findStockfish();
if (!path) throw new Error('Stockfish was not found in apps/server/engine/.');

const results: { white: number; black: number; result: GameResult }[] = [];
const started = Date.now();
let next = 0;
await Promise.all(
  Array.from({ length: ENGINES }, async () => {
    const engine = new StockfishEngine({ path, log });
    try {
      while (next < pairings.length) {
        const pairing = pairings[next++]!;
        results.push({ ...pairing, result: await play(engine, pairing) });
        if (results.length % 50 === 0) {
          console.error(`${results.length}/${pairings.length} games, ${Math.round((Date.now() - started) / 1000)} s`);
        }
      }
    } finally {
      await engine.close();
    }
  }),
);

// Head to head, from the stronger level's side.
const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
const heads = new Map<string, { games: number; score: number; low: number; high: number }>();
for (const r of results) {
  const low = Math.min(r.white, r.black);
  const high = Math.max(r.white, r.black);
  const h = heads.get(pairKey(low, high)) ?? { games: 0, score: 0, low, high };
  const whiteScore = r.result === '1-0' ? 1 : r.result === '0-1' ? 0 : 0.5;
  h.games++;
  h.score += r.white === high ? whiteScore : 1 - whiteScore;
  heads.set(pairKey(low, high), h);
}
const eloOf = (score: number) => {
  const s = Math.min(0.99, Math.max(0.01, score));
  return -400 * Math.log10(1 / s - 1);
};
console.log('\nHead to head (score of the stronger level)\n');
console.log('pair   games  score   Elo gap');
for (const h of [...heads.values()].sort((a, b) => a.low - b.low || a.high - b.high)) {
  const score = h.score / h.games;
  console.log(
    `${`${h.low}-${h.high}`.padEnd(6)} ${String(h.games).padStart(5)}  ${score.toFixed(2).padStart(5)}  ${Math.round(eloOf(score)).toString().padStart(8)}`,
  );
}

// Bradley–Terry with draws as half a win each, fitted by minorization–maximization.
const strength = new Map(levels.map((l) => [l, 1]));
for (let iter = 0; iter < 2_000; iter++) {
  for (const l of levels) {
    let wins = 0;
    let denom = 0;
    for (const r of results) {
      if (r.white !== l && r.black !== l) continue;
      const other = r.white === l ? r.black : r.white;
      const whiteScore = r.result === '1-0' ? 1 : r.result === '0-1' ? 0 : 0.5;
      wins += r.white === l ? whiteScore : 1 - whiteScore;
      denom += 1 / (strength.get(l)! + strength.get(other)!);
    }
    if (denom > 0) strength.set(l, Math.max(1e-9, wins) / denom);
  }
}
if (!levels.includes(ANCHOR.level)) throw new Error(`The ladder needs level ${ANCHOR.level}, its anchor.`);
const anchor = 400 * Math.log10(strength.get(ANCHOR.level)!);
console.log(`\nRatings, level ${ANCHOR.level} anchored at ${ANCHOR.rating}\n`);
console.log('level  fitted  Stockfish UCI_Elo');
for (const l of levels) {
  const fitted = Math.round(ANCHOR.rating + 400 * Math.log10(strength.get(l)!) - anchor);
  const nominal = LEVEL_PLAY[l]!.elo;
  const random = LEVEL_PLAY[l]!.randomMoves;
  console.log(
    `${String(l).padStart(5)}  ${String(fitted).padStart(6)}  ${nominal === null ? 'full strength' : `${nominal}${random ? ` with ${Math.round(random * 100)}% random moves` : ''}`}`,
  );
}
console.log(`\n${results.length} games in ${Math.round((Date.now() - started) / 1000)} s`);
