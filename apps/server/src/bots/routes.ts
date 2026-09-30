import { botLevelSchema } from '@empire/rules';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session';
import type { AppContext } from '../context';
import { parse } from '../lib/http';
import { addBot, setBotLevel } from './lobby';
import { handToBot, takeBack } from './standins';

const idParams = z.object({ id: z.string().min(1).max(40) });
const botParams = idParams.extend({ botId: z.string().min(1).max(40) });
const playerParams = idParams.extend({ userId: z.string().min(1).max(40) });
const levelInput = z.object({ level: botLevelSchema });

/**
 * Removing a bot is the host's usual `POST /api/campaigns/:id/kick`. A bot stands in for a player
 * through `…/players/:userId/stand-in`: the host puts one in (`PUT`), and the host or the player
 * takes the empire back (`DELETE`).
 */
export function registerBotRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/campaigns/:id/bots', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const { level } = parse(levelInput, req.body);
    reply.code(201);
    return addBot(ctx, id, user.id, level);
  });

  app.patch('/api/campaigns/:id/bots/:botId', async (req) => {
    const user = requireUser(req);
    const { id, botId } = parse(botParams, req.params);
    const { level } = parse(levelInput, req.body);
    await setBotLevel(ctx, id, user.id, botId, level);
    return { ok: true };
  });

  app.put('/api/campaigns/:id/players/:userId/stand-in', async (req) => {
    const user = requireUser(req);
    const { id, userId } = parse(playerParams, req.params);
    const { level } = parse(levelInput, req.body);
    await handToBot(ctx, id, user.id, userId, level);
    return { ok: true };
  });

  app.delete('/api/campaigns/:id/players/:userId/stand-in', async (req) => {
    const user = requireUser(req);
    const { id, userId } = parse(playerParams, req.params);
    await takeBack(ctx, id, user.id, userId);
    return { ok: true };
  });
}
