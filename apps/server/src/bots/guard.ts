import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { games, members } from '../db/schema';
import { HttpError } from '../lib/errors';
import { isBotId } from './ids';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** What a player may still do while a bot plays their empire: talk, and take the empire back. */
const ALLOWED = new Set([
  '/api/campaigns/:id/messages',
  '/api/campaigns/:id/messages/:messageId',
  '/api/campaigns/:id/chat/read',
  '/api/campaigns/:id/players/:userId/stand-in',
]);

/**
 * While a bot stands in for a player, the player's own requests to act in that campaign are
 * refused, so the two never play the same seat at once. The bot acts under the player's id, but
 * through the services directly, not these routes.
 */
export function registerStandInGuard(app: FastifyInstance, ctx: AppContext): void {
  app.addHook('preHandler', async (req) => {
    if (SAFE_METHODS.has(req.method) || !req.user || isBotId(req.user.id)) return;
    const route = req.routeOptions.url ?? '';
    if (ALLOWED.has(route)) return;
    const params = req.params as { id?: unknown; gameId?: unknown };
    let campaignId: string | undefined;
    if (route.startsWith('/api/campaigns/:id/') && typeof params.id === 'string') campaignId = params.id;
    else if (route.startsWith('/api/games/:gameId/') && typeof params.gameId === 'string') {
      const [game] = await ctx.db
        .select({ campaignId: games.campaignId })
        .from(games)
        .where(eq(games.id, params.gameId));
      campaignId = game?.campaignId;
    }
    if (!campaignId) return;
    const [seat] = await ctx.db
      .select({ botLevel: members.botLevel })
      .from(members)
      .where(and(eq(members.campaignId, campaignId), eq(members.userId, req.user.id)));
    if (seat?.botLevel != null) {
      throw new HttpError(403, 'A bot is playing your empire. Take it back to play yourself.', 'stood-in');
    }
  });
}
