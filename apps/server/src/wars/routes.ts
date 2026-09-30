import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session';
import type { AppContext } from '../context';
import { parse } from '../lib/http';
import { gameAction, gameView, playMove } from './games';
import { answerPeace, proposePeace, withdrawPeace } from './peace';
import { declareWar, fortifyCountry, nextRound, recallWar, replyToWar, respondToWar } from './service';
import { passTurn } from './turns';
import { warView } from './views';

const id = z.string().min(1).max(40);
const territory = z.string().min(1).max(40);
const stake = z.array(territory).min(1).max(200);

const campaignParams = z.object({ id });
const warParams = z.object({ id, warId: id });
const offerParams = z.object({ id, warId: id, offerId: id });
const gameParams = z.object({ gameId: id });

const declareInput = z.object({
  targetId: territory,
  launchId: territory,
  stake,
  reserves: z.array(territory).max(200).optional(),
});

const fortifyInput = z.object({ territoryId: territory });

const passInput = z.object({ userId: id });

const tokens = z.number().int().min(0).max(99);
const peaceInput = z.object({
  terms: z.object({
    toAttacker: z.array(territory).max(200),
    toDefender: z.array(territory).max(200),
    tokensToAttacker: tokens,
    tokensToDefender: tokens,
    accordRounds: z.number().int().min(1).max(99).nullable(),
  }),
});

const peaceAnswerInput = z.object({ answer: z.enum(['accept', 'decline']) });

const responseInput = z.discriminatedUnion('response', [
  z.object({ response: z.literal('accept') }),
  z.object({ response: z.literal('raise'), territoryId: territory.optional() }),
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

  app.get('/api/campaigns/:id/wars/:warId', async (req) => {
    const user = requireUser(req);
    const params = parse(warParams, req.params);
    return warView(ctx, params.id, params.warId, user.id);
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

  app.post('/api/campaigns/:id/wars/:warId/recall', async (req) => {
    const user = requireUser(req);
    const params = parse(warParams, req.params);
    await recallWar(ctx, params.id, params.warId, user.id);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/wars/:warId/peace', async (req, reply) => {
    const user = requireUser(req);
    const params = parse(warParams, req.params);
    reply.code(201);
    return proposePeace(ctx, params.id, params.warId, user.id, parse(peaceInput, req.body));
  });

  app.post('/api/campaigns/:id/wars/:warId/peace/:offerId/answer', async (req) => {
    const user = requireUser(req);
    const params = parse(offerParams, req.params);
    const { answer } = parse(peaceAnswerInput, req.body);
    await answerPeace(ctx, params.id, params.warId, params.offerId, user.id, answer);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/wars/:warId/peace/:offerId/withdraw', async (req) => {
    const user = requireUser(req);
    const params = parse(offerParams, req.params);
    await withdrawPeace(ctx, params.id, params.warId, params.offerId, user.id);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/fortify', async (req) => {
    const user = requireUser(req);
    const params = parse(campaignParams, req.params);
    const { territoryId } = parse(fortifyInput, req.body);
    return fortifyCountry(ctx, params.id, user.id, territoryId);
  });

  app.post('/api/campaigns/:id/turn/pass', async (req) => {
    const user = requireUser(req);
    const params = parse(campaignParams, req.params);
    await passTurn(ctx, params.id, user.id, parse(passInput, req.body));
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
