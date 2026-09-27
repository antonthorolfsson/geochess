import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session';
import type { AppContext } from '../context';
import { parse } from '../lib/http';
import { statsView } from './service';

const campaignParams = z.object({ id: z.string().min(1).max(40) });

export function registerStatsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/campaigns/:id/stats', async (req) => {
    const user = requireUser(req);
    const { id } = parse(campaignParams, req.params);
    return statsView(ctx, id, user.id);
  });
}
