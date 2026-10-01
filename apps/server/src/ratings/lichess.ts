import { parseLichessPerfs, type LichessRatings } from '@empire/rules';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env';

/** Reads players' ratings from Lichess. Tests pass their own. */
export interface LichessClient {
  /** A Lichess user's ratings from their public profile; null if Lichess couldn't be reached. */
  ratings(username: string): Promise<LichessRatings | null>;
}

const TIMEOUT_MS = 5000;

export function createLichessClient(env: Env, log: FastifyBaseLogger): LichessClient {
  return {
    async ratings(username) {
      try {
        const res = await fetch(`${env.LICHESS_HOST}/api/user/${encodeURIComponent(username)}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Lichess answered ${res.status}`);
        const body = (await res.json()) as { perfs?: unknown };
        return parseLichessPerfs(body.perfs);
      } catch (err) {
        log.warn({ err, username }, 'could not read Lichess ratings');
        return null;
      }
    },
  };
}
