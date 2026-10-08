import { deleteFinishedCampaigns } from '../campaigns/service';
import type { AppContext } from '../context';
import { lapseProposals } from '../diplomacy/accords';
import { runVictoryDeadlines } from '../victory/scheduler';
import { armAllFlags, flagOverdueGames } from './games';
import { lapsePeaceOffers } from './peace';
import { advanceScheduledRounds, dueRoundEnds, expireResponses } from './service';
import { expireTurns } from './turns';

/** How often the server looks for deadlines that have passed. Live flag-falls have their own timers. */
const POLL_MS = 5_000;

/**
 * Everything due by now: unanswered declarations and counter-offers, turns to declare nobody
 * took, flag-falls, half-settled games, accord proposals and peace offers nobody answered, secret
 * missions not chosen in time, claims whose holding time is up, rounds whose scheduled time is up,
 * anything a bot still has to do, and finished campaigns whose time to be kept is up.
 *
 * A scheduled round ends at its time, however late the server gets to it: what fell due by then
 * is dealt with first, in that round, and what fell due since, after, in the next round, or not at
 * all once the campaign has ended (see `round-end.ts`).
 */
export async function runDueWork(ctx: AppContext): Promise<void> {
  for (const at of await dueRoundEnds(ctx)) {
    await runDeadlines(ctx, at);
    await advanceScheduledRounds(ctx, at);
  }
  await runDeadlines(ctx, ctx.now());
  await ctx.bots.sweep();
  await deleteFinishedCampaigns(ctx);
}

/** Every deadline that fell due by `upTo`. */
async function runDeadlines(ctx: AppContext, upTo: Date): Promise<void> {
  await expireResponses(ctx, upTo);
  await expireTurns(ctx, upTo);
  await flagOverdueGames(ctx, upTo);
  await lapseProposals(ctx, upTo);
  await lapsePeaceOffers(ctx, upTo);
  await runVictoryDeadlines(ctx, upTo);
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
