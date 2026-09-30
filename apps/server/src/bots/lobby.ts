/**
 * Bots in the lobby: the host adds them, each with a chess level, and can change a level until the
 * draft starts. Each bot is a user of its own, a member of this one campaign; removing it (the
 * host's "Remove", `removeMember`) or deleting the campaign deletes it too.
 */
import { nextBotName } from '@empire/rules';
import { and, eq, inArray } from 'drizzle-orm';
import { mutate, nextSeatColor, requireHost, requireLobby, requireMember } from '../campaigns/mutate';
import type { AppContext } from '../context';
import type { Tx } from '../db/client';
import { members, users } from '../db/schema';
import { badRequest } from '../lib/errors';
import { isBotId, newBotId } from './ids';

export async function addBot(
  ctx: AppContext,
  campaignId: string,
  hostId: string,
  level: number,
): Promise<{ userId: string }> {
  return mutate(ctx, campaignId, async (scope) => {
    requireHost(scope, hostId, 'add bots');
    requireLobby(scope, 'Bots can only be added before the draft starts.');
    const color = nextSeatColor(scope);
    const taken = await scope.tx
      .select({ name: users.name })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.campaignId, campaignId));
    const name = nextBotName(taken.map((t) => t.name));
    const userId = newBotId(() => ctx.random());
    await scope.tx.insert(users).values({ id: userId, name });
    // Bots draft automatically, like a player on auto-draft (see `pickFor`).
    await scope.tx.insert(members).values({ campaignId, userId, color, autodraft: true, botLevel: level });
    await scope.log.add({ type: 'member.joined', payload: { userId, name, bot: { level } } }, hostId, 0);
    return { userId };
  });
}

export async function setBotLevel(
  ctx: AppContext,
  campaignId: string,
  hostId: string,
  botId: string,
  level: number,
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireHost(scope, hostId, 'change bots');
    requireLobby(scope, 'Bot levels are locked once the draft starts.');
    const bot = requireMember(scope, botId);
    if (bot.botLevel === null || !isBotId(botId)) throw badRequest('That player is not a bot.', 'not-a-bot');
    await scope.tx
      .update(members)
      .set({ botLevel: level })
      .where(and(eq(members.campaignId, campaignId), eq(members.userId, botId)));
  });
}

/** Deletes bots' users once nothing refers to them (their membership, or their whole campaign, is gone). */
export async function deleteBotUsers(tx: Tx, userIds: readonly string[]): Promise<void> {
  const bots = userIds.filter(isBotId);
  if (bots.length > 0) await tx.delete(users).where(inArray(users.id, bots));
}
