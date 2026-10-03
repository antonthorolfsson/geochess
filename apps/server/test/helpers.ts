import { ChessGame, type Dataset, type ServerMessage } from '@empire/rules';
import { lineDataset } from '@empire/rules/testing';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app';
import type { Mailer } from '../src/auth/mailer';
import type { ChessEngine, SearchRequest, Score } from '../src/bots/engine';
import { staticDatasetProvider } from '../src/datasets';
import { openDatabase } from '../src/db/client';
import { loadEnv } from '../src/env';
import type { Notice } from '../src/notifications/notifier';
import type { LichessClient } from '../src/ratings/lichess';
import { runDueWork } from '../src/wars/scheduler';

export interface TestServer {
  app: FastifyInstance;
  mail: { to: string; subject: string; text: string }[];
  /** Every notice the server sent, oldest first. */
  notices: Notice[];
  /** The server's clock, which only moves when a test moves it. */
  clock: { now(): Date; advance(ms: number): void };
  /** Runs the scheduler's work for the current time: expired answers, flag-falls, bots' turns. */
  runDue(): Promise<void>;
  /** Waits until the bots have done everything they're going to do for now. */
  bots(): Promise<void>;
  close(): Promise<void>;
}

/**
 * A server on an in-memory database with the six-territory test map (or `dataset`), configured
 * like development unless `env` says otherwise.
 */
export async function startTestServer(
  dataset: Dataset = lineDataset(),
  env: NodeJS.ProcessEnv = {},
  opts: { random?: () => number; engine?: ChessEngine; lichess?: LichessClient } = {},
): Promise<TestServer> {
  const database = await openDatabase({ dataDir: null });
  const mail: TestServer['mail'] = [];
  const notices: Notice[] = [];
  const mailer: Mailer = { delivers: false, send: async (m) => void mail.push(m) };
  let now = Date.now();
  const app = await buildApp({
    db: database.db,
    env: loadEnv({ NODE_ENV: 'test', DEV_LOGIN: '1', ...env }),
    datasets: staticDatasetProvider([dataset]),
    mailer,
    notifier: { send: async (n) => void notices.push(n) },
    now: () => new Date(now),
    random: opts.random,
    scheduler: false,
    engine: opts.engine ?? testEngine(),
    // Tests never reach Lichess: unless a test says otherwise, it can't be reached.
    lichess: opts.lichess ?? { ratings: async () => null },
  });
  return {
    app,
    mail,
    notices,
    clock: { now: () => new Date(now), advance: (ms) => void (now += ms) },
    async runDue() {
      await runDueWork(app.ctx);
      await app.ctx.bots.idle();
    },
    bots: () => app.ctx.bots.idle(),
    async close() {
      await app.close();
      await database.close();
    },
  };
}

export interface Client {
  cookie: string;
  get<T = unknown>(url: string): Promise<{ status: number; body: T }>;
  post<T = unknown>(url: string, payload?: object): Promise<{ status: number; body: T }>;
  patch<T = unknown>(url: string, payload: object): Promise<{ status: number; body: T }>;
  put<T = unknown>(url: string, payload: object): Promise<{ status: number; body: T }>;
  del<T = unknown>(url: string): Promise<{ status: number; body: T }>;
}

export function client(app: FastifyInstance, cookie = ''): Client {
  const call = async <T>(opts: InjectOptions) => {
    const res = await app.inject({ ...opts, headers: { ...opts.headers, cookie } });
    return { status: res.statusCode, body: (res.body ? res.json() : null) as T };
  };
  return {
    cookie,
    get: (url) => call({ method: 'GET', url }),
    post: (url, payload = {}) => call({ method: 'POST', url, payload }),
    patch: (url, payload) => call({ method: 'PATCH', url, payload }),
    put: (url, payload) => call({ method: 'PUT', url, payload }),
    del: (url) => call({ method: 'DELETE', url }),
  };
}

export async function signIn(app: FastifyInstance, name: string): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/dev', payload: { name } });
  const session = res.cookies.find((c) => c.name === 'ec_session');
  if (!session) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  return client(app, `ec_session=${session.value}`);
}

/** Opens a socket as `c` and records every message the server sends. */
export async function listen(app: FastifyInstance, c: Client): Promise<{ messages: ServerMessage[]; close(): void }> {
  const messages: ServerMessage[] = [];
  const ws = await app.injectWS('/ws', { headers: { cookie: c.cookie } });
  ws.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
  return { messages, close: () => ws.terminate() };
}

export const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The original game's answers to a declaration (a free raise, redirects anywhere, tribute), with
 * declarations whenever players like, which campaigns stored before the revised answers still
 * play: for tests of those rules.
 */
export const ORIGINAL_ANSWERS = {
  raise: 'free',
  raises: 1,
  redirect: 'anywhere',
  redirectToken: false,
  fortify: false,
  peaceTerms: false,
  recall: false,
  turns: false,
} as const;

/** A chess engine for tests, and what it was asked. */
export interface TestEngine extends ChessEngine {
  requests: SearchRequest[];
  /** The line it plays while it can, from the start of each game (either colour). */
  script: string[];
  /** The score it reports for the side to move. */
  score: Score;
}

/**
 * Plays the scripted move for the position when it's legal, else the first legal move in UCI
 * order, so games with bots come out the same every time.
 */
export function testEngine(script: string[] = []): TestEngine {
  const engine: TestEngine = {
    requests: [],
    script,
    score: { cp: 0 },
    async search(req) {
      engine.requests.push(req);
      const game = ChessGame.fromMoves(req.moves);
      const legal = game.legalMoves().sort();
      const scripted = engine.script[req.moves.length];
      const move = scripted && legal.includes(scripted) ? scripted : (legal[0] ?? null);
      return { bestMove: move, lines: move ? [{ move, score: engine.score }] : [] };
    },
    async close() {},
  };
  return engine;
}
