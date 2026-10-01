/**
 * Invitations to a campaign's lobby. Any member invites their friends (the host also when creating
 * the campaign), and each friend joins or declines from their home screen. Invitations are
 * campaign state, since members see who is invited, so they change through `mutate()`; the invited
 * player, not a member yet, hears of it through `friends.changed`.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { mutate, requireLobby, requireMember, userName, type MutationScope } from '../campaigns/mutate';
import type { AppContext } from '../context';
import type { Tx } from '../db/client';
import { invitations } from '../db/schema';
import { badRequest, conflict, forbidden } from '../lib/errors';
import type { Notice } from '../notifications/notifier';
import { friendsAmong } from './friends';

/** Friends to invite, at most 50 in one request. */
export const inviteInput = z.array(z.string().min(1).max(80)).max(50);

/**
 * Invites the inviter's friends among `userIds` to the lobby, skipping players already seated or
 * invited; returns the newly invited. Anyone who isn't the inviter's friend is refused.
 */
export async function addInvitations(
  tx: Tx,
  campaignId: string,
  inviterId: string,
  userIds: readonly string[],
  seated: readonly string[],
): Promise<string[]> {
  const wanted = [...new Set(userIds)].filter((id) => id !== inviterId && !seated.includes(id));
  if (wanted.length === 0) return [];
  const mine = await friendsAmong(tx, inviterId, wanted);
  if (wanted.some((id) => !mine.has(id))) throw badRequest('You can only invite your friends.', 'not-a-friend');
  const rows = await tx
    .insert(invitations)
    .values(wanted.map((userId) => ({ campaignId, userId, invitedBy: inviterId })))
    .onConflictDoNothing()
    .returning({ userId: invitations.userId });
  return rows.map((r) => r.userId);
}

/** Worth an email when push reaches nothing: an invitation waits for an answer. */
export function invitationNotice(campaign: { id: string; name: string }, inviterName: string, userId: string): Notice {
  return {
    userId,
    title: `${inviterName} invited you to ${campaign.name}`,
    body: 'Join or decline on your Geo Chess home screen.',
    url: '/',
    tag: `invitation-${campaign.id}`,
    email: true,
  };
}

export async function inviteFriends(
  ctx: AppContext,
  campaignId: string,
  inviterId: string,
  userIds: readonly string[],
): Promise<{ invited: string[] }> {
  return mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, inviterId);
    requireLobby(scope, 'Invitations close when the draft starts.');
    if (scope.members.length >= scope.campaign.rules.maxPlayers) throw conflict('This campaign is full.', 'full');
    const invited = await addInvitations(
      scope.tx,
      campaignId,
      inviterId,
      userIds,
      scope.members.map((m) => m.userId),
    );
    if (invited.length === 0) {
      scope.notifyOnly([]);
      return { invited };
    }
    const name = await userName(scope.tx, inviterId);
    for (const userId of invited) scope.notify(invitationNotice(scope.campaign, name, userId));
    scope.afterCommit(() => ctx.hub.send(invited, { type: 'friends.changed' }));
    return { invited };
  });
}

/** The invited player says no. Members see the invitation go; nobody is told. */
export async function declineInvitation(ctx: AppContext, campaignId: string, userId: string): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    if (await removeInvitation(scope.tx, campaignId, userId)) {
      scope.afterCommit(() => ctx.hub.send([userId], { type: 'friends.changed' }));
    } else {
      // Nothing changed, so nobody hears of it.
      scope.notifyOnly([]);
    }
  });
}

/** The member who sent an invitation, or the host, calls it off. */
export async function cancelInvitation(
  ctx: AppContext,
  campaignId: string,
  actorId: string,
  userId: string,
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireMember(scope, actorId);
    const [open] = await scope.tx
      .select({ invitedBy: invitations.invitedBy })
      .from(invitations)
      .where(and(eq(invitations.campaignId, campaignId), eq(invitations.userId, userId)));
    if (!open) {
      scope.notifyOnly([]);
      return;
    }
    if (open.invitedBy !== actorId && scope.campaign.hostId !== actorId) {
      throw forbidden('Only the host or the player who sent an invitation can call it off.');
    }
    await removeInvitation(scope.tx, campaignId, userId);
    scope.afterCommit(() => ctx.hub.send([userId], { type: 'friends.changed' }));
  });
}

/** Whether the player has an open invitation to the campaign. */
export async function isInvited(tx: Tx, campaignId: string, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ userId: invitations.userId })
    .from(invitations)
    .where(and(eq(invitations.campaignId, campaignId), eq(invitations.userId, userId)));
  return Boolean(row);
}

/** Removes an invitation (answered, declined or called off); whether there was one. */
export async function removeInvitation(tx: Tx, campaignId: string, userId: string): Promise<boolean> {
  const rows = await tx
    .delete(invitations)
    .where(and(eq(invitations.campaignId, campaignId), eq(invitations.userId, userId)))
    .returning({ userId: invitations.userId });
  return rows.length > 0;
}

/** The draft starting closes every invitation to the lobby. */
export async function closeInvitations(ctx: AppContext, scope: MutationScope): Promise<void> {
  const closed = await scope.tx
    .delete(invitations)
    .where(eq(invitations.campaignId, scope.campaign.id))
    .returning({ userId: invitations.userId });
  if (closed.length > 0) {
    scope.afterCommit(() =>
      ctx.hub.send(
        closed.map((r) => r.userId),
        { type: 'friends.changed' },
      ),
    );
  }
}
