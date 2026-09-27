import { AUTODRAFT_FALLBACKS, DRAFT_LIST_LIMIT, campaignNameSchema } from '@empire/rules';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session';
import type { AppContext } from '../context';
import { parse } from '../lib/http';
import {
  createCampaign,
  deleteCampaign,
  endDraft,
  joinCampaign,
  makePick,
  removeMember,
  resetInvite,
  setDraftList,
  startDraft,
  updateCampaign,
  updateMembership,
} from './service';
import { campaignView, invitePreview, listCampaigns } from './views';

const idParams = z.object({ id: z.string().min(1).max(40) });
const codeParams = z.object({ code: z.string().min(1).max(40) });
/** Partial rules; the service merges them over the current (or default) rules and validates. */
const rulesInput = z.record(z.string(), z.unknown());

export function registerCampaignRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/campaigns', async (req) => listCampaigns(ctx, requireUser(req).id));

  app.post('/api/campaigns', async (req, reply) => {
    const user = requireUser(req);
    const input = parse(z.object({ name: campaignNameSchema, rules: rulesInput.optional() }), req.body);
    reply.code(201);
    return createCampaign(ctx, user.id, input);
  });

  app.get('/api/campaigns/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    return campaignView(ctx, id, user.id);
  });

  app.patch('/api/campaigns/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const input = parse(z.object({ name: campaignNameSchema.optional(), rules: rulesInput.optional() }), req.body);
    await updateCampaign(ctx, id, user.id, input);
    return { ok: true };
  });

  app.delete('/api/campaigns/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await deleteCampaign(ctx, id, user.id);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/invite/reset', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    return { inviteCode: await resetInvite(ctx, id, user.id) };
  });

  app.patch('/api/campaigns/:id/me', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const input = parse(
      z.object({
        color: z.number().int().min(0).optional(),
        autodraft: z.boolean().optional(),
        autodraftFallback: z.enum(AUTODRAFT_FALLBACKS).optional(),
      }),
      req.body,
    );
    await updateMembership(ctx, id, user.id, input);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/leave', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await removeMember(ctx, id, user.id, user.id);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/kick', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const { userId } = parse(z.object({ userId: z.string().min(1) }), req.body);
    await removeMember(ctx, id, user.id, userId);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/draft/start', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await startDraft(ctx, id, user.id);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/draft/pick', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const { territoryId } = parse(z.object({ territoryId: z.string().min(1).max(40) }), req.body);
    await makePick(ctx, id, user.id, territoryId);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/draft/autopick', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await makePick(ctx, id, user.id, null);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/draft/end', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await endDraft(ctx, id, user.id);
    return { ok: true };
  });

  app.put('/api/campaigns/:id/draft/list', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const { territoryIds } = parse(
      z.object({ territoryIds: z.array(z.string().max(40)).max(DRAFT_LIST_LIMIT * 2) }),
      req.body,
    );
    return { territoryIds: await setDraftList(ctx, id, user.id, territoryIds) };
  });

  app.get('/api/invites/:code', async (req) => {
    const { code } = parse(codeParams, req.params);
    return invitePreview(ctx, code, req.user?.id ?? null);
  });

  app.post('/api/invites/:code/join', async (req) => {
    const user = requireUser(req);
    const { code } = parse(codeParams, req.params);
    return joinCampaign(ctx, code, user.id);
  });
}
