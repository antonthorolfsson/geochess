import { colorToMove, type GameSummary, type GameView, type PeaceOfferView, type WarView } from '@empire/rules';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { AppContext } from '../context';
import type { Db, Tx } from '../db/client';
import { games, members, peaceOffers, wars } from '../db/schema';
import { notFound } from '../lib/errors';
import type { GameRow, PeaceOfferRow, WarRow } from './board';

export function toGameSummary(game: GameRow): GameSummary {
  return {
    id: game.id,
    armageddon: game.armageddon,
    whiteId: game.whiteId,
    blackId: game.blackId,
    status: game.status,
    result: game.result,
    reason: game.reason,
  };
}

/** A game as of `now`: the clock of the side to move has kept running since the last move. */
export function toGameView(game: GameRow, now: Date): GameView {
  let clocks = game.clocks;
  if (clocks && game.status === 'playing' && game.lastMoveAt) {
    const turn = colorToMove(game.moves.length);
    const running = Math.max(0, now.getTime() - game.lastMoveAt.getTime());
    clocks = { ...clocks, [turn]: Math.max(0, clocks[turn] - running) };
  }
  return {
    ...toGameSummary(game),
    warId: game.warId,
    campaignId: game.campaignId,
    timeControl: game.timeControl,
    moves: game.moves,
    clocks,
    startsAt: game.startsAt?.toISOString() ?? null,
    deadline: game.deadline?.toISOString() ?? null,
    drawOfferBy: game.drawOfferBy,
    serverNow: now.toISOString(),
  };
}

/**
 * One war, for members: the campaign view carries only unresolved and recent wars, so older ones
 * (linked from dispatches and empire pages) are read on their own.
 */
export async function warView(ctx: AppContext, campaignId: string, warId: string, viewerId: string): Promise<WarView> {
  const [member] = await ctx.db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.campaignId, campaignId), eq(members.userId, viewerId)));
  const [war] = member
    ? await ctx.db
        .select()
        .from(wars)
        .where(and(eq(wars.id, warId), eq(wars.campaignId, campaignId)))
    : [];
  if (!war) throw notFound('War not found.');
  const rows = await ctx.db.select().from(games).where(eq(games.warId, war.id)).orderBy(asc(games.createdAt));
  return toWarView(war, rows, await peaceOffersFor(ctx.db, campaignId, viewerId, [war.id]));
}

/**
 * The viewer's own peace offers (made or received) in these wars, newest first. Nobody else's:
 * offers are private to the two players at war.
 */
export async function peaceOffersFor(
  db: Tx | Db,
  campaignId: string,
  viewerId: string,
  warIds: readonly string[],
): Promise<PeaceOfferRow[]> {
  if (warIds.length === 0) return [];
  return db
    .select()
    .from(peaceOffers)
    .where(
      and(
        eq(peaceOffers.campaignId, campaignId),
        inArray(peaceOffers.warId, [...warIds]),
        or(eq(peaceOffers.proposerId, viewerId), eq(peaceOffers.recipientId, viewerId)),
      ),
    )
    .orderBy(desc(peaceOffers.createdAt));
}

export function toPeaceOfferView(offer: PeaceOfferRow): PeaceOfferView {
  return {
    id: offer.id,
    warId: offer.warId,
    proposerId: offer.proposerId,
    recipientId: offer.recipientId,
    terms: offer.terms,
    status: offer.status,
    createdAt: offer.createdAt.toISOString(),
    respondBy: offer.respondBy?.toISOString() ?? null,
    endedAt: offer.endedAt?.toISOString() ?? null,
  };
}

/**
 * `games` are the war's games in the order they were played; `peace` the viewer's own offers in
 * it (any others are left out here too).
 */
export function toWarView(war: WarRow, games: readonly GameRow[], peace: readonly PeaceOfferRow[] = []): WarView {
  return {
    id: war.id,
    attackerId: war.attackerId,
    defenderId: war.defenderId,
    targetId: war.targetId,
    launchId: war.launchId,
    stake: war.stake,
    redirectedFrom: war.redirectedFrom,
    status: war.status,
    counter: war.counter,
    outcome: war.outcome,
    declaredRound: war.declaredRound,
    resolvedRound: war.resolvedRound,
    respondBy: war.respondBy?.toISOString() ?? null,
    declaredAt: war.declaredAt.toISOString(),
    resolvedAt: war.resolvedAt?.toISOString() ?? null,
    games: games.map(toGameSummary),
    reserves: war.reserves,
    peace: peace.filter((o) => o.warId === war.id).map(toPeaceOfferView),
  };
}
