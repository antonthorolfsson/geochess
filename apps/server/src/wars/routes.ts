import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session';
import type { AppContext } from '../context';
import { parse } from '../lib/http';
import { gameAction, gameView, playMove } from './games';
import { declareWar, nextRound, replyToWar, respondToWar } from './service';

const id = z.string().min(1).max(40);
const territory = z.string().min(1).max(40);
const stake = z.array(territory).min(1).max(200);

const campaignParams = z.object({ id });
const warParams = z.object({ id, warId: id });
const gameParams = z.object({ gameId: id });

const declareInput = z.object({ targetId: territory, launchId: territory, stake });

const responseInput = z.discriminatedUnion('response', [
  z.object({ response: z.literal('accept') }),
  z.object({ response: z.literal('raise') }),
  z.object({ response: z.literal('redirect'), targetId: territory }),
  z.object({
    response: z.literal('tribute'),
    territoryId: territory.optional(),
    tokens: z.number().int().min(1).max(99).optional(),
  }),
]);

const replyInput = z.discriminatedUnion('reply', [
  z.object({ reply: z.literal('accept'), stake: stake.optional() }),
  z.object({ reply: z.literal('withdraw') }),
  z.object({ reply: z.literal('refuse') }),
]);

const moveInput = z.object({
  uci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/, 'Moves are written in UCI, like e2e4.'),
  ply: z.number().int().min(0).max(5000),
});

const drawInput = z.object({ action: z.enum(['offer', 'accept', 'decline']) });

export function registerWarRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/campaigns/:id/wars', async (req, reply) => {
    const user = requireUser(req);
    const params = parse(campaignParams, req.params);
    const input = parse(declareInput, req.body);
    reply.code(201);
    return declareWar(ctx, params.id, user.id, input);
  });

  app.post('/api/campaigns/:id/wars/:warId/respond', async (req) => {
    const user = requireUser(req);
    const params = parse(warParams, req.params);
    await respondToWar(ctx, params.id, params.warId, user.id, parse(responseInput, req.body));
    return { ok: true };
  });

  app.post('/api/campaigns/:id/wars/:warId/reply', async (req) => {
    const user = requireUser(req);
    const params = parse(warParams, req.params);
    await replyToWar(ctx, params.id, params.warId, user.id, parse(replyInput, req.body));
    return { ok: true };
  });

  app.post('/api/campaigns/:id/round/next', async (req) => {
    const user = requireUser(req);
    await nextRound(ctx, parse(campaignParams, req.params).id, user.id);
    return { ok: true };
  });

  app.get('/api/games/:gameId', async (req) => {
    const user = requireUser(req);
    return gameView(ctx, parse(gameParams, req.params).gameId, user.id);
  });

  app.post('/api/games/:gameId/move', async (req) => {
    const user = requireUser(req);
    const { gameId } = parse(gameParams, req.params);
    return playMove(ctx, gameId, user.id, parse(moveInput, req.body));
  });

  app.post('/api/games/:gameId/resign', async (req) => {
    const user = requireUser(req);
    return gameAction(ctx, parse(gameParams, req.params).gameId, user.id, 'resign');
  });

  app.post('/api/games/:gameId/draw', async (req) => {
    const user = requireUser(req);
    const { gameId } = parse(gameParams, req.params);
    const { action } = parse(drawInput, req.body);
    return gameAction(ctx, gameId, user.id, `${action}-draw`);
  });
}
