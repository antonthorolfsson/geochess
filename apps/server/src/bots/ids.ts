import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { members } from '../db/schema';
import { randomString } from '../lib/ids';
import type { Notifier } from '../notifications/notifier';

/**
 * Bot players' user ids start with this. People's ids are random letters and digits (`newId`) or
 * `dev_` and a name, so no person's id can. A bot standing in for a person plays under the
 * person's id: whether a seat is played by a bot is `members.bot_level`, not the id.
 */
export const BOT_ID_PREFIX = 'bot_';

/** Whether a user is a bot of its own (never a person, even one a bot stands in for). */
export const isBotId = (userId: string): boolean => userId.startsWith(BOT_ID_PREFIX);

/** A new bot's id, from the server's randomness (`ctx.random`, which tests seed). */
export const newBotId = (random: () => number): string => BOT_ID_PREFIX + randomString(12, undefined, random);

/** The players whose seats a bot plays: bots, and people a bot stands in for. */
export const botSeats = (rows: readonly { userId: string; botLevel: number | null }[]): Set<string> =>
  new Set(rows.filter((m) => m.botLevel !== null).map((m) => m.userId));

/** SQL: whether a bot plays this player's seat in this campaign. */
export const playedByBot = (campaignId: AnyColumn, userId: AnyColumn): SQL =>
  sql`exists (select 1 from ${members} where ${members.campaignId} = ${campaignId} and ${members.userId} = ${userId} and ${members.botLevel} is not null)`;

/** Bots have no devices or inboxes: notices to them go nowhere. */
export function skippingBots(notifier: Notifier): Notifier {
  return { send: async (notice) => (isBotId(notice.userId) ? undefined : notifier.send(notice)) };
}
