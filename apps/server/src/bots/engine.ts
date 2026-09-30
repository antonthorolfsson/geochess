/**
 * The chess engine bots play with: Stockfish 19's lite WASM build (apps/server/engine/), run as a
 * child process speaking UCI, so a search never blocks the game server's clocks and sockets. One
 * process serves every bot, one search at a time; it starts on the first search and stops after a
 * while without one, to give its memory back.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setPriority } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ChessGame } from '@empire/rules';
import type { FastifyBaseLogger } from 'fastify';

/** The Stockfish build the server ships, with its `.wasm` beside it. */
export const STOCKFISH_FILE = 'stockfish-19-lite-single.js';
/** The strength range Stockfish's `UCI_Elo` accepts. */
export const STOCKFISH_ELO = { min: 1320, max: 3190 } as const;

/** A score from the side to move's point of view: centipawns, or mate in so many moves (negative: being mated). */
export type Score = { cp: number } | { mate: number };

export interface SearchRequest {
  /** The game so far, in UCI from the starting position. */
  moves: readonly string[];
  /** Stockfish's `UCI_Elo` to play to, or null for full strength. */
  elo: number | null;
  /** How many plies deep to search. */
  depth: number;
  /** The most time the search may take. */
  movetimeMs?: number;
  /** How many of the best lines to report. */
  multiPv?: number;
}

export interface SearchLine {
  move: string;
  score: Score;
}

export interface SearchResult {
  /** The move to play (at a limited strength, not always the best line's), or null with no legal move. */
  bestMove: string | null;
  /** The best lines found, best first. */
  lines: SearchLine[];
}

export interface ChessEngine {
  search(req: SearchRequest): Promise<SearchResult>;
  close(): Promise<void>;
}

/** Where the Stockfish build is: `STOCKFISH_PATH`, else `engine/` in the server package. */
export function findStockfish(override?: string): string | null {
  const candidates = override
    ? [resolve(override)]
    : [
        // From src/bots/ when running the source, and from dist/ in the built server.
        fileURLToPath(new URL(`../../engine/${STOCKFISH_FILE}`, import.meta.url)),
        fileURLToPath(new URL(`../engine/${STOCKFISH_FILE}`, import.meta.url)),
        resolve(process.cwd(), 'engine', STOCKFISH_FILE),
      ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

/** Stockfish if the server has it; otherwise (with a warning) random legal moves, so games go on. */
export function createEngine(log: FastifyBaseLogger, override?: string): ChessEngine {
  const path = findStockfish(override);
  if (path) return new StockfishEngine({ path, log });
  log.warn(`${override ?? `engine/${STOCKFISH_FILE}`} was not found, so bots will play random moves.`);
  return randomEngine;
}

/** Plays any legal move. */
export const randomEngine: ChessEngine = {
  async search({ moves }) {
    const legal = ChessGame.fromMoves(moves).legalMoves();
    const move = legal[Math.floor(Math.random() * legal.length)] ?? null;
    return { bestMove: move, lines: [] };
  },
  async close() {},
};

const START_TIMEOUT_MS = 20_000;
/** Past a search's time: when to tell it to stop, and when to give up on it. */
const STOP_AFTER_MS = 5_000;
const KILL_AFTER_MS = 10_000;
/** A search with no time limit gets this long before being stopped. */
const DEFAULT_SEARCH_MS = 10_000;
const IDLE_MS = 10 * 60_000;
/** The niceness Stockfish runs at: the lowest scheduling priority. */
const LOWEST_PRIORITY = 19;
const HASH_MB = 16;

/** The engine's process went away mid-search. */
class EngineExit extends Error {}

interface Waiter {
  /** Each line the engine prints; returns true once the waiter is done. */
  line(text: string): boolean;
  fail(err: Error): void;
}

type Log = Pick<FastifyBaseLogger, 'warn'>;

export class StockfishEngine implements ChessEngine {
  private readonly path: string;
  private readonly log: Log;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private waiter: Waiter | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idle: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(opts: { path: string; log: Log }) {
    this.path = opts.path;
    this.log = opts.log;
  }

  search(req: SearchRequest): Promise<SearchResult> {
    const run = this.queue.then(() => this.run(req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.stopProcess();
    await this.queue;
  }

  private async run(req: SearchRequest): Promise<SearchResult> {
    if (this.closed) throw new Error('The chess engine has been shut down.');
    if (this.idle) clearTimeout(this.idle);
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          await this.start();
          return await this.go(req);
        } catch (err) {
          // Whatever went wrong, the next try starts from a fresh process. A process that died
          // under the search gets one more; a search that hung doesn't.
          this.stopProcess();
          if (!(err instanceof EngineExit) || attempt >= 2 || this.closed) throw err;
        }
      }
    } finally {
      if (!this.closed) {
        this.idle = setTimeout(() => this.stopProcess(), IDLE_MS);
        this.idle.unref();
      }
    }
  }

  private async start(): Promise<void> {
    const current = this.proc;
    if (current && !current.killed && current.exitCode === null && current.signalCode === null) return;
    if (current) this.stopProcess();
    const proc = spawn(process.execPath, [this.path], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    // Searches yield to the game server, whose clocks and sockets come first on a small machine.
    try {
      if (proc.pid !== undefined) setPriority(proc.pid, LOWEST_PRIORITY);
    } catch (err) {
      this.log.warn({ err }, 'could not lower Stockfish’s priority');
    }
    proc.on('error', (err) => this.failWaiter(proc, err));
    proc.on('exit', (code, signal) => this.failWaiter(proc, new EngineExit(`Stockfish exited (${signal ?? code}).`)));
    // Writing to a process that has just died fails here rather than crashing the server.
    proc.stdin.on('error', (err) => this.failWaiter(proc, new EngineExit(err.message)));
    proc.stderr.on('data', (chunk: Buffer) =>
      this.log.warn({ stderr: String(chunk).trim() }, 'Stockfish wrote an error'),
    );
    createInterface({ input: proc.stdout }).on('line', (text) => {
      if (this.proc === proc && this.waiter?.line(text)) this.waiter = null;
    });
    await this.until('uci', (text) => text === 'uciok', START_TIMEOUT_MS);
    this.send(`setoption name Hash value ${HASH_MB}`);
    await this.until('isready', (text) => text === 'readyok', START_TIMEOUT_MS);
  }

  private async go(req: SearchRequest): Promise<SearchResult> {
    const limited = req.elo !== null;
    this.send(`setoption name UCI_LimitStrength value ${limited}`);
    if (limited) {
      const elo = Math.round(Math.min(STOCKFISH_ELO.max, Math.max(STOCKFISH_ELO.min, req.elo!)));
      this.send(`setoption name UCI_Elo value ${elo}`);
    }
    this.send(`setoption name MultiPV value ${req.multiPv ?? 1}`);
    this.send(req.moves.length > 0 ? `position startpos moves ${req.moves.join(' ')}` : 'position startpos');
    const lines = new Map<number, SearchLine & { depth: number }>();
    const budget = req.movetimeMs ?? DEFAULT_SEARCH_MS;
    const stop = setTimeout(() => this.send('stop'), budget + STOP_AFTER_MS);
    try {
      const done = await this.until(
        `go depth ${req.depth}${req.movetimeMs ? ` movetime ${req.movetimeMs}` : ''}`,
        (text) => {
          if (text.startsWith('info ')) readInfo(text, lines);
          return text.startsWith('bestmove');
        },
        budget + KILL_AFTER_MS,
      );
      const best = done.split(/\s+/)[1];
      return {
        bestMove: best && best !== '(none)' ? best : null,
        lines: [...lines.entries()].sort(([a], [b]) => a - b).map(([, { move, score }]) => ({ move, score })),
      };
    } finally {
      clearTimeout(stop);
    }
  }

  /** Sends a command and waits for the line that answers it. */
  private until(command: string, done: (text: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolveLine, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error(`Stockfish did not answer "${command}" in time.`));
      }, timeoutMs);
      this.waiter = {
        line(text) {
          if (!done(text)) return false;
          clearTimeout(timer);
          resolveLine(text);
          return true;
        },
        fail(err) {
          clearTimeout(timer);
          reject(err);
        },
      };
      this.send(command);
    });
  }

  private send(command: string): void {
    this.proc?.stdin.write(`${command}\n`);
  }

  private failWaiter(proc: ChildProcessWithoutNullStreams, err: Error): void {
    if (this.proc !== proc) return;
    this.proc = null;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.fail(err);
  }

  private stopProcess(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    const proc = this.proc;
    if (!proc) return;
    this.failWaiter(proc, new Error('Stockfish was stopped.'));
    proc.stdin.end('quit\n');
    proc.kill();
  }
}

/** Keeps the deepest report of each line from an `info … pv …` line. */
function readInfo(text: string, lines: Map<number, SearchLine & { depth: number }>): void {
  const words = text.split(/\s+/);
  const pv = words.indexOf('pv');
  const score = words.indexOf('score');
  if (pv < 0 || score < 0 || !words[pv + 1]) return;
  const after = (key: string) => {
    const i = words.indexOf(key);
    return i < 0 ? undefined : Number(words[i + 1]);
  };
  const depth = after('depth') ?? 0;
  const line = after('multipv') ?? 1;
  const value = Number(words[score + 2]);
  if (!Number.isFinite(value)) return;
  const previous = lines.get(line);
  if (previous && previous.depth > depth) return;
  lines.set(line, {
    move: words[pv + 1]!,
    score: words[score + 1] === 'mate' ? { mate: value } : { cp: value },
    depth,
  });
}
