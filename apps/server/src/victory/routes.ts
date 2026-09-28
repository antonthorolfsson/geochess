import { PUBLIC_MISSION_KINDS } from '@empire/rules';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session';
import type { AppContext } from '../context';
import { parse } from '../lib/http';
import { rerollPublicMission, setPublicMissions } from './lobby';
import { chooseSecret, proceedWithoutSecrets } from './selection';

const id = z.string().min(1).max(40);
const campaignParams = z.object({ id });
const slotParams = z.object({ id, slot: z.coerce.number().int().min(0).max(7) });

export function registerVictoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** The player chooses their secret mission. Only their own options can be chosen. */
  app.post('/api/campaigns/:id/secret', async (req) => {
    const user = requireUser(req);
    const params = parse(campaignParams, req.params);
    const { optionId } = parse(z.object({ optionId: z.string().min(1).max(8) }), req.body);
    await chooseSecret(ctx, params.id, user.id, optionId);
    return { ok: true };
  });

  /** The host picks the public missions (fresh targets are generated), in the lobby. */
  app.put('/api/campaigns/:id/victory/missions', async (req) => {
    const user = requireUser(req);
    const params = parse(campaignParams, req.params);
    const { kinds } = parse(z.object({ kinds: z.array(z.enum(PUBLIC_MISSION_KINDS)).min(1).max(8) }), req.body);
    await setPublicMissions(ctx, params.id, user.id, kinds);
    return { ok: true };
  });

  /** The host draws new targets for one public mission, in the lobby. */
  app.post('/api/campaigns/:id/victory/missions/:slot/reroll', async (req) => {
    const user = requireUser(req);
    const params = parse(slotParams, req.params);
    await rerollPublicMission(ctx, params.id, user.id, params.slot);
    return { ok: true };
  });

  /** The host goes on without secret missions for players nothing fitted. */
  app.post('/api/campaigns/:id/victory/proceed', async (req) => {
    const user = requireUser(req);
    await proceedWithoutSecrets(ctx, parse(campaignParams, req.params).id, user.id);
    return { ok: true };
  });
}
