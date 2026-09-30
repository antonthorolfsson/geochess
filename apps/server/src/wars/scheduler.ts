import type { AppContext } from '../context';
import { lapseProposals } from '../diplomacy/accords';
import { runVictoryDeadlines } from '../victory/scheduler';
import { armAllFlags, flagOverdueGames } from './games';
import { lapsePeaceOffers } from './peace';
import { expireResponses } from './service';
import { expireTurns } from './turns';

/** How often the server looks for deadlines that have passed. Live flag-falls have their own timers. */
const POLL_MS = 5_000;

/**
 * Everything due by now: unanswered declarations and counter-offers, turns to declare nobody
 * took, flag-falls, half-settled games, accord proposals and peace offers nobody answered, secret
 * missions not chosen in time, claims whose holding time is up, and anything a bot still has to do.
 */
export async function runDueWork(ctx: AppContext): Promise<void> {
  await expireResponses(ctx);
  await expireTurns(ctx);
  await flagOverdueGames(ctx);
  await lapseProposals(ctx);
  await lapsePeaceOffers(ctx);
  await runVictoryDeadlines(ctx);
  await ctx.bots.sweep();
}

/**
 * An in-process scheduler that polls the database, so it works the same on PGlite and Postgres.
 * Deadlines live in the database, so nothing is lost across restarts.
 */
export function startScheduler(ctx: AppContext): { stop(): void } {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueWork(ctx);
    } catch (err) {
      ctx.log.error({ err }, 'scheduled work failed');
    } finally {
      running = false;
    }
  };
  void armAllFlags(ctx)
    .catch((err: unknown) => ctx.log.error({ err }, 'could not re-arm flag timers'))
    .then(tick);
  const timer = setInterval(() => void tick(), POLL_MS);
  return { stop: () => clearInterval(timer) };
}
