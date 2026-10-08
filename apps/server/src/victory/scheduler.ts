import { and, eq, lte } from 'drizzle-orm';
import { mutate } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { missionClaims } from '../db/schema';
import { expireSelections } from './selection';

/**
 * Victory deadlines, polled like the others so restarts lose nothing: secret missions nobody chose
 * in time, and claims whose minimum holding time has just run out, by `upTo`. A claim is checked
 * once when its time is up (the check runs in a campaign change, like every other); after that,
 * round starts and war results check it again.
 */
export async function runVictoryDeadlines(ctx: AppContext, upTo: Date = ctx.now()): Promise<void> {
  await expireSelections(ctx, upTo);
  const due = await ctx.db
    .selectDistinct({ campaignId: missionClaims.campaignId })
    .from(missionClaims)
    .where(
      and(
        eq(missionClaims.status, 'pending'),
        eq(missionClaims.timeReached, false),
        lte(missionClaims.eligibleAt, upTo),
      ),
    );
  for (const { campaignId } of due) {
    try {
      // Nothing else changes, so nobody is told unless the check logs something (points, a win).
      await mutate(ctx, campaignId, async (scope) => scope.notifyOnly([]), { upTo });
    } catch (err) {
      ctx.log.error({ err, campaignId }, 'could not check victory claims');
    }
  }
}
