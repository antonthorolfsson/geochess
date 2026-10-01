import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session';
import { acceptInvitation } from '../campaigns/service';
import type { AppContext } from '../context';
import { parse } from '../lib/http';
import { addFriendByLink, friendLinkPreview, removeFriend, resetFriendLink } from './friends';
import { cancelInvitation, declineInvitation, inviteFriends, inviteInput } from './invitations';
import { friendsView, invitationsFor } from './views';

const userParams = z.object({ userId: z.string().min(1).max(80) });
const codeParams = z.object({ code: z.string().min(1).max(40) });
const campaignParams = z.object({ campaignId: z.string().min(1).max(40) });
const idParams = z.object({ id: z.string().min(1).max(40) });
const memberParams = z.object({ id: z.string().min(1).max(40), userId: z.string().min(1).max(80) });

export function registerFriendRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/friends', async (req) => friendsView(ctx, requireUser(req).id));

  app.delete('/api/friends/:userId', async (req) => {
    const user = requireUser(req);
    const { userId } = parse(userParams, req.params);
    await removeFriend(ctx, user.id, userId);
    return { ok: true };
  });

  app.post('/api/friends/link/reset', async (req) => {
    const user = requireUser(req);
    return { friendCode: await resetFriendLink(ctx, user.id) };
  });

  // Like a campaign invite, a friend link says whose it is before signing in.
  app.get('/api/friend-links/:code', async (req) => {
    const { code } = parse(codeParams, req.params);
    return friendLinkPreview(ctx, code, req.user?.id ?? null);
  });

  app.post('/api/friend-links/:code', async (req) => {
    const user = requireUser(req);
    const { code } = parse(codeParams, req.params);
    return addFriendByLink(ctx, code, user.id);
  });

  app.get('/api/invitations', async (req) => invitationsFor(ctx, requireUser(req).id));

  app.post('/api/invitations/:campaignId/join', async (req) => {
    const user = requireUser(req);
    const { campaignId } = parse(campaignParams, req.params);
    return acceptInvitation(ctx, campaignId, user.id);
  });

  app.post('/api/invitations/:campaignId/decline', async (req) => {
    const user = requireUser(req);
    const { campaignId } = parse(campaignParams, req.params);
    await declineInvitation(ctx, campaignId, user.id);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/invitations', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const { userIds } = parse(z.object({ userIds: inviteInput.min(1) }), req.body);
    return inviteFriends(ctx, id, user.id, userIds);
  });

  app.delete('/api/campaigns/:id/invitations/:userId', async (req) => {
    const user = requireUser(req);
    const { id, userId } = parse(memberParams, req.params);
    await cancelInvitation(ctx, id, user.id, userId);
    return { ok: true };
  });
}
