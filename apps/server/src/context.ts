import type { FastifyBaseLogger } from 'fastify';
import type { Mailer } from './auth/mailer';
import type { BotRunner } from './bots/runner';
import type { DatasetProvider } from './datasets';
import type { Db } from './db/client';
import type { Env } from './env';
import type { KeyedMutex } from './lib/mutex';
import type { Timers } from './lib/timers';
import type { Notifier } from './notifications/notifier';
import type { Hub } from './realtime/hub';
import type { OpeningNamer } from './stats/openings';

/** Services shared by every route module. */
export interface AppContext {
  db: Db;
  env: Env;
  datasets: DatasetProvider;
  hub: Hub;
  mailer: Mailer;
  notifier: Notifier;
  log: FastifyBaseLogger;
  /** The current time. Injectable so tests can step through deadlines. */
  now(): Date;
  /**
   * A uniform number in [0, 1): crypto-backed in production, injectable so tests can deal
   * predictable missions. Seeds for secret missions are drawn from it and kept server-side.
   */
  random(): number;
  /** Per-campaign serialization of state changes. */
  locks: KeyedMutex;
  /** Per-game serialization of moves. Taken before a campaign lock, never inside one. */
  gameLocks: KeyedMutex;
  /** Live games' flag timers. */
  timers: Timers;
  /** Names games' openings for the chess profiles. */
  openings: OpeningNamer;
  /** Plays for the bot players: told of every change to a campaign or game with a bot in it. */
  bots: BotRunner;
}
