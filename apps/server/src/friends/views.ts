import { parseRules, type FriendsView, type InvitationView, type InvitedView } from '@empire/rules';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AppContext } from '../context';
import type { Tx } from '../db/client';
import { campaigns, friends, invitations, members, users } from '../db/schema';
import { friendCode } from './friends';

/** The player's friends by name, each with the campaigns the two are in, and their friend link. */
export async function friendsView(ctx: AppContext, userId: string): Promise<FriendsView> {
  const rows = await ctx.db
    .select({ userId: users.id, name: users.name, lichessUsername: users.lichessUsername })
    .from(friends)
    .innerJoin(users, eq(users.id, friends.friendId))
    .where(eq(friends.userId, userId));
  const theirs = alias(members, 'theirs');
  const shared = rows.length
    ? await ctx.db
        .select({ friendId: theirs.userId, campaignId: members.campaignId })
        .from(members)
        .innerJoin(theirs, eq(theirs.campaignId, members.campaignId))
        .innerJoin(campaigns, eq(campaigns.id, members.campaignId))
        .where(
          and(
            eq(members.userId, userId),
            inArray(
              theirs.userId,
              rows.map((r) => r.userId),
            ),
          ),
        )
        .orderBy(desc(campaigns.createdAt))
    : [];
  const campaignIds = new Map<string, string[]>();
  for (const s of shared) campaignIds.set(s.friendId, [...(campaignIds.get(s.friendId) ?? []), s.campaignId]);
  return {
    friends: rows
      .map((r) => ({ ...r, campaignIds: campaignIds.get(r.userId) ?? [] }))
      .sort(
        (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.userId.localeCompare(b.userId),
      ),
    friendCode: await friendCode(ctx.db, userId),
  };
}

/** The player's open invitations, newest first: lobbies only, since the draft closes them. */
export async function invitationsFor(ctx: AppContext, userId: string): Promise<InvitationView[]> {
  const inviter = alias(users, 'inviter');
  const host = alias(users, 'host');
  const rows = await ctx.db
    .select({
      campaignId: campaigns.id,
      name: campaigns.name,
      rules: campaigns.rules,
      hostName: host.name,
      invitedBy: { userId: inviter.id, name: inviter.name },
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .innerJoin(campaigns, eq(campaigns.id, invitations.campaignId))
    .innerJoin(inviter, eq(inviter.id, invitations.invitedBy))
    .innerJoin(host, eq(host.id, campaigns.hostId))
    .where(and(eq(invitations.userId, userId), eq(campaigns.status, 'lobby')))
    .orderBy(desc(invitations.createdAt));
  if (rows.length === 0) return [];
  const seated = await ctx.db
    .select({ campaignId: members.campaignId, name: users.name })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      inArray(
        members.campaignId,
        rows.map((r) => r.campaignId),
      ),
    )
    .orderBy(asc(members.joinedAt));
  return rows.map(({ rules: stored, createdAt, ...r }) => {
    const rules = parseRules(stored);
    return {
      ...r,
      players: seated.filter((s) => s.campaignId === r.campaignId).map((s) => s.name),
      maxPlayers: rules.maxPlayers,
      pace: rules.war.pace,
      createdAt: createdAt.toISOString(),
    };
  });
}

/** Who is invited to a lobby and hasn't answered, for the campaign view. */
export async function invitedTo(tx: Tx, campaignId: string): Promise<InvitedView[]> {
  return tx
    .select({ userId: invitations.userId, name: users.name, invitedBy: invitations.invitedBy })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.userId))
    .where(eq(invitations.campaignId, campaignId))
    .orderBy(asc(invitations.createdAt), asc(users.name));
}
