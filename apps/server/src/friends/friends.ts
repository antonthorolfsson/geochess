/**
 * Friends: the people a player can invite to campaigns. Everyone who drafts a campaign together
 * becomes friends (bots aside), and a player's friend link makes a friend of whoever opens it.
 * Friendship goes both ways: a row each way, and removing a friend deletes both. Friends aren't
 * campaign state, so none of this takes a campaign lock.
 */
import type { FriendLinkPreview } from '@empire/rules';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { isBotId } from '../bots/ids';
import type { AppContext } from '../context';
import type { Db, Tx } from '../db/client';
import { friends, users } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { newInviteCode } from '../lib/ids';

/** Makes friends of every person among `userIds`, each with each; returns the people. */
export async function befriend(tx: Tx | Db, userIds: readonly string[]): Promise<string[]> {
  const people = [...new Set(userIds)].filter((id) => !isBotId(id));
  const rows = people.flatMap((userId) =>
    people.filter((friendId) => friendId !== userId).map((friendId) => ({ userId, friendId })),
  );
  if (rows.length > 0) await tx.insert(friends).values(rows).onConflictDoNothing();
  return people;
}

/** Which of `candidates` are the player's friends. */
export async function friendsAmong(tx: Tx | Db, userId: string, candidates: readonly string[]): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const rows = await tx
    .select({ friendId: friends.friendId })
    .from(friends)
    .where(and(eq(friends.userId, userId), inArray(friends.friendId, [...candidates])));
  return new Set(rows.map((r) => r.friendId));
}

/** The code of the player's friend link, made the first time it's asked for. */
export async function friendCode(db: Db, userId: string): Promise<string> {
  const read = async () => {
    const [row] = await db.select({ code: users.friendCode }).from(users).where(eq(users.id, userId));
    if (!row) throw notFound('Player not found.');
    return row.code;
  };
  const code = await read();
  if (code) return code;
  // Two first looks at once make one code between them.
  await db
    .update(users)
    .set({ friendCode: newInviteCode() })
    .where(and(eq(users.id, userId), isNull(users.friendCode)));
  return (await read())!;
}

/** A new friend link; the old one stops working. */
export async function resetFriendLink(ctx: AppContext, userId: string): Promise<string> {
  const code = newInviteCode();
  await ctx.db.update(users).set({ friendCode: code }).where(eq(users.id, userId));
  return code;
}

async function linkOwner(db: Db, code: string): Promise<{ id: string; name: string }> {
  const [owner] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.friendCode, code));
  if (!owner) throw notFound('This friend link is no longer valid.');
  return owner;
}

export async function friendLinkPreview(
  ctx: AppContext,
  code: string,
  viewerId: string | null,
): Promise<FriendLinkPreview> {
  const owner = await linkOwner(ctx.db, code);
  const self = owner.id === viewerId;
  const already = viewerId !== null && !self && (await friendsAmong(ctx.db, viewerId, [owner.id])).size > 0;
  return { name: owner.name, self, friends: already };
}

/** Opening someone's friend link makes the two friends. */
export async function addFriendByLink(
  ctx: AppContext,
  code: string,
  userId: string,
): Promise<{ userId: string; name: string }> {
  const owner = await linkOwner(ctx.db, code);
  if (owner.id === userId) {
    throw badRequest('This is your own friend link. Send it to the people you want to add.', 'own-link');
  }
  await befriend(ctx.db, [userId, owner.id]);
  ctx.hub.send([userId, owner.id], { type: 'friends.changed' });
  return { userId: owner.id, name: owner.name };
}

/** Ends a friendship for both players. Drafting a campaign together again makes them friends again. */
export async function removeFriend(ctx: AppContext, userId: string, friendId: string): Promise<void> {
  await ctx.db
    .delete(friends)
    .where(
      or(
        and(eq(friends.userId, userId), eq(friends.friendId, friendId)),
        and(eq(friends.userId, friendId), eq(friends.friendId, userId)),
      ),
    );
  ctx.hub.send([userId, friendId], { type: 'friends.changed' });
}
