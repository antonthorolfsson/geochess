/**
 * Bots standing in for players. When a player goes quiet, the host can hand their empire to a
 * bot, which plays it (answers, moves, rounds) until the player takes it back or the host hands
 * it back. The seat stays the player's: their countries, wars, accords, secret mission and points,
 * and their user id, which the bot acts under. Meanwhile the player's own requests to act are
 * refused (`registerStandInGuard`), chat aside, and notices to them are held back, since the bot
 * deals with what they're about.
 */
import { and, eq } from 'drizzle-orm';
import { advanceDraft } from '../campaigns/service';
import { mutate, requireHost, requireMember, userName } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { members } from '../db/schema';
import { badRequest, conflict } from '../lib/errors';
import { isBotId } from './ids';

const tag = (campaignId: string) => `standin:${campaignId}`;

export async function handToBot(
  ctx: AppContext,
  campaignId: string,
  hostId: string,
  userId: string,
  level: number,
): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    requireHost(scope, hostId, 'hand an empire to a bot');
    const player = requireMember(scope, userId);
    const { status, round } = scope.campaign;
    if (status === 'lobby') {
      throw conflict('Until the draft starts, remove the player and add a bot instead.', 'not-started');
    }
    if (status === 'finished') throw conflict('The campaign is over.', 'finished');
    if (userId === hostId) throw badRequest('You can’t hand your own empire to a bot.', 'own-empire');
    if (isBotId(userId)) throw badRequest('That player is a bot.', 'a-bot');
    if (player.botLevel !== null) throw conflict('A bot is already playing this empire.', 'stood-in');
    // The round's accords and fortifying were the player's to do: the bot starts on them next round.
    await scope.tx
      .update(members)
      .set({ botLevel: level, botRound: round })
      .where(and(eq(members.campaignId, campaignId), eq(members.userId, userId)));
    player.botLevel = level;
    player.botRound = round;
    await scope.log.add({ type: 'standin.began', payload: { userId, level } }, hostId, round);
    // Sent once the change is in, since notices to a seat a bot plays are otherwise held back.
    const host = await userName(scope.tx, hostId);
    scope.afterCommit(() =>
      ctx.notifier.send({
        userId,
        title: 'A bot is playing your empire',
        body: `${host} handed your empire to a level ${level} bot while you’re away. Take it back whenever you like.`,
        url: `/c/${campaignId}`,
        tag: tag(campaignId),
      }),
    );
    // On the player's turn in the draft, the bot picks at once.
    if (status === 'draft') await advanceDraft(ctx, scope);
  });
}

/** The player takes their empire back, or the host hands it back to them. */
export async function takeBack(ctx: AppContext, campaignId: string, actorId: string, userId: string): Promise<void> {
  await mutate(ctx, campaignId, async (scope) => {
    const player = requireMember(scope, userId);
    if (actorId !== userId) requireHost(scope, actorId, 'hand an empire back');
    if (player.botLevel === null || isBotId(userId)) throw conflict('No bot is playing this empire.', 'not-stood-in');
    await scope.tx
      .update(members)
      .set({ botLevel: null })
      .where(and(eq(members.campaignId, campaignId), eq(members.userId, userId)));
    player.botLevel = null;
    await scope.log.add({ type: 'standin.ended', payload: { userId } }, actorId, scope.campaign.round);
    if (actorId !== userId) {
      scope.notify({
        userId,
        title: 'Your empire is yours again',
        body: `${await userName(scope.tx, actorId)} handed your empire back from its bot.`,
        url: `/c/${campaignId}`,
        tag: tag(campaignId),
      });
    }
  });
}
