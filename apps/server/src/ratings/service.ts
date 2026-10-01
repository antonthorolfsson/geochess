import { botLevel, playerRating, type CampaignRules, type LichessRatings, type PlayerRating } from '@empire/rules';
import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { MutationScope } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { members, users } from '../db/schema';

/** Lichess ratings older than this are read again before the draft freezes them. */
export const LICHESS_FRESH_MS = 60 * 60 * 1000;

/**
 * The rating a seat's games are handicapped by (null: none, or handicaps are off). A bot plays at
 * its level's rating, a bot standing in for a player too, since handicaps follow whoever plays. In
 * the lobby a player's rating follows their Lichess ratings and the one they gave; from the draft
 * on it's the one frozen when the draft started.
 */
export function seatRating(
  rules: CampaignRules,
  status: string,
  seat: { botLevel: number | null; rating: PlayerRating | null; claimedRating: number | null },
  lichessRatings: LichessRatings | null,
): PlayerRating | null {
  if (rules.war.handicap === 'off') return null;
  if (seat.botLevel !== null) return { rating: botLevel(seat.botLevel).rating, source: 'bot' };
  if (status !== 'lobby') return seat.rating;
  return playerRating(rules.war, { botLevel: null, lichess: lichessRatings, claimed: seat.claimedRating });
}

/**
 * Reads again from Lichess the ratings of these players that are older than `maxAgeMs` (or never
 * read). Lichess being unreachable leaves the old ones. Returns whether anything was read.
 */
export async function refreshLichessRatings(
  ctx: AppContext,
  userIds: readonly string[],
  maxAgeMs: number,
): Promise<boolean> {
  if (userIds.length === 0) return false;
  const stale = new Date(ctx.now().getTime() - maxAgeMs);
  const due = await ctx.db
    .select({ id: users.id, username: users.lichessUsername })
    .from(users)
    .where(
      and(
        inArray(users.id, [...userIds]),
        isNotNull(users.lichessUsername),
        or(isNull(users.lichessRatingsAt), lt(users.lichessRatingsAt, stale)),
      ),
    );
  const read = await Promise.all(
    due.map(async (u) => {
      const ratings = await ctx.lichess.ratings(u.username!);
      if (!ratings) return false;
      await ctx.db
        .update(users)
        .set({ lichessRatings: ratings, lichessRatingsAt: ctx.now() })
        .where(eq(users.id, u.id));
      return true;
    }),
  );
  return read.some(Boolean);
}

/** Freezes every player's rating for the campaign, as the draft starts. */
export async function freezeRatings(scope: MutationScope): Promise<void> {
  const rules = scope.campaign.rules;
  const rows = await scope.tx
    .select({
      userId: members.userId,
      botLevel: members.botLevel,
      claimedRating: members.claimedRating,
      lichessRatings: users.lichessRatings,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.campaignId, scope.campaign.id));
  // Bots' ratings follow their level: nothing to freeze.
  for (const m of rows.filter((r) => r.botLevel === null)) {
    const rating = seatRating(rules, 'lobby', { ...m, rating: null }, m.lichessRatings);
    await scope.tx
      .update(members)
      .set({ rating })
      .where(and(eq(members.campaignId, scope.campaign.id), eq(members.userId, m.userId)));
  }
}
