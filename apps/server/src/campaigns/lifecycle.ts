import { refillTokens } from '@empire/rules';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context';
import { campaigns, members } from '../db/schema';
import type { MutationScope } from './mutate';

/**
 * Round 1 begins and everyone gets their first war tokens: straight after the draft in an
 * open-ended campaign, once every secret mission is chosen in an Objectives one. Callers then let
 * accords signed before it that end with it run their course.
 */
export async function openCampaign(ctx: AppContext, scope: MutationScope): Promise<void> {
  const { tx, campaign } = scope;
  const now = ctx.now();
  await tx
    .update(campaigns)
    .set({ status: 'active', round: 1, startedAt: now, roundStartedAt: now, selectionDeadline: null })
    .where(eq(campaigns.id, campaign.id));
  await tx
    .update(members)
    .set({ draftList: [], tokens: refillTokens(campaign.rules, 0) })
    .where(eq(members.campaignId, campaign.id));
  for (const m of scope.members) m.tokens = refillTokens(campaign.rules, 0);
  scope.campaign = { ...campaign, status: 'active', round: 1, roundStartedAt: now, selectionDeadline: null };
}
