import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session';
import type { AppContext } from '../context';
import { campaigns, members } from '../db/schema';
import { notFound } from '../lib/errors';
import { parse } from '../lib/http';
import { refreshLichessRatings } from './service';

const idParams = z.object({ id: z.string().min(1).max(40) });
/** A player's Lichess ratings are read again at most this often on their asking. */
const REFRESH_MS = 10 * 60 * 1000;

export function registerRatingRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Reads the player's Lichess ratings again, for a lobby's handicaps. Ratings don't change the
   * campaign, so this skips the campaign lock; if they changed, the lobbies the player is in hear.
   */
  app.post('/api/campaigns/:id/rating/refresh', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [member] = await ctx.db
      .select({ status: campaigns.status })
      .from(members)
      .innerJoin(campaigns, eq(campaigns.id, members.campaignId))
      .where(and(eq(members.campaignId, id), eq(members.userId, user.id)));
    if (!member) throw notFound('Campaign not found.');
    const refreshed = member.status === 'lobby' && (await refreshLichessRatings(ctx, [user.id], REFRESH_MS));
    if (refreshed) await announceToLobbies(ctx, user.id);
    return { refreshed };
  });
}

/** Tells everyone in the player's lobbies that the campaign view changed (ratings show there live). */
export async function announceToLobbies(ctx: AppContext, userId: string): Promise<void> {
  const lobbies = await ctx.db
    .select({ id: campaigns.id })
    .from(members)
    .innerJoin(campaigns, eq(campaigns.id, members.campaignId))
    .where(and(eq(members.userId, userId), eq(campaigns.status, 'lobby')));
  for (const { id } of lobbies) {
    const rows = await ctx.db.select({ userId: members.userId }).from(members).where(eq(members.campaignId, id));
    ctx.hub.send(
      rows.map((r) => r.userId),
      { type: 'campaign.changed', campaignId: id },
    );
  }
}
