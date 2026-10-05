import {
  campaignStats,
  type CampaignEvent,
  type CampaignStats,
  type PointsChange,
  type Resolution,
} from '@empire/rules';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context';
import { accords, campaigns, events, games, holdings, members, wars } from '../db/schema';
import { notFound } from '../lib/errors';

type ResolvedPayload = Extract<CampaignEvent, { type: 'war.resolved' }>['payload'];
/** The events that move victory points. */
type PointsEvent = Extract<CampaignEvent, { type: 'mission.awarded' | 'title.changed' }>;

/** Accord statuses that were signed; proposals that came to nothing stay private. */
const SIGNED = ['active', 'kept', 'broken', 'renewed'] as const;

/** Every empire's statistics, worked out from the campaign's history. Members only. */
export async function statsView(ctx: AppContext, campaignId: string, viewerId: string): Promise<CampaignStats> {
  // Read everything in one snapshot, then work the numbers out after the transaction ends.
  const rows = await ctx.db.transaction(
    async (tx) => {
      const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
      const memberRows = await tx
        .select({ userId: members.userId })
        .from(members)
        .where(eq(members.campaignId, campaignId))
        .orderBy(asc(members.joinedAt));
      if (!campaign || !memberRows.some((m) => m.userId === viewerId)) throw notFound('Campaign not found.');

      const holdingRows = await tx
        .select({
          territoryId: holdings.territoryId,
          ownerId: holdings.ownerId,
          acquiredRound: holdings.acquiredRound,
          pickNumber: holdings.pickNumber,
        })
        .from(holdings)
        .where(eq(holdings.campaignId, campaignId));
      const warRows = await tx
        .select({
          id: wars.id,
          attackerId: wars.attackerId,
          defenderId: wars.defenderId,
          status: wars.status,
          outcome: wars.outcome,
        })
        .from(wars)
        .where(eq(wars.campaignId, campaignId));
      const resolvedEvents = await tx
        .select({ round: events.round, payload: events.payload })
        .from(events)
        .where(and(eq(events.campaignId, campaignId), eq(events.type, 'war.resolved')))
        .orderBy(asc(events.id));
      const pointsEvents = await tx
        .select({ round: events.round, type: events.type, payload: events.payload })
        .from(events)
        .where(and(eq(events.campaignId, campaignId), inArray(events.type, ['mission.awarded', 'title.changed'])))
        .orderBy(asc(events.id));
      // By war, which is indexed.
      const gameRows = warRows.length
        ? await tx
            .select({
              id: games.id,
              warId: games.warId,
              whiteId: games.whiteId,
              blackId: games.blackId,
              armageddon: games.armageddon,
              status: games.status,
              result: games.result,
              reason: games.reason,
              moves: games.moves,
              finishedAt: games.finishedAt,
            })
            .from(games)
            .where(
              inArray(
                games.warId,
                warRows.map((w) => w.id),
              ),
            )
            .orderBy(asc(games.createdAt))
        : [];
      const accordRows = await tx
        .select({
          proposerId: accords.proposerId,
          recipientId: accords.recipientId,
          status: accords.status,
          brokenBy: accords.brokenBy,
        })
        .from(accords)
        .where(and(eq(accords.campaignId, campaignId), inArray(accords.status, [...SIGNED])));
      return { campaign, memberRows, holdingRows, warRows, resolvedEvents, pointsEvents, gameRows, accordRows };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );

  const { campaign, holdingRows, warRows } = rows;
  const warById = new Map(warRows.map((w) => [w.id, w]));
  const resolutions = rows.resolvedEvents.flatMap(({ round, payload }): Resolution[] => {
    const p = payload as ResolvedPayload;
    const war = warById.get(p.warId);
    if (!war) return [];
    return [
      {
        warId: p.warId,
        round,
        attackerId: war.attackerId,
        defenderId: war.defenderId,
        outcome: p.outcome,
        transfers: p.transfers,
        tokens: p.tokens ?? 0,
        terms: p.terms ?? null,
      },
    ];
  });
  const pointsChanges = rows.pointsEvents.flatMap(({ round, type, payload }): PointsChange[] => {
    const e = { type, payload } as PointsEvent;
    if (e.type === 'mission.awarded') return [{ round, userId: e.payload.userId, points: e.payload.points }];
    const { from, to, points } = e.payload;
    return [
      ...(from ? [{ round, userId: from, points: -points }] : []),
      ...(to ? [{ round, userId: to, points }] : []),
    ];
  });

  return campaignStats({
    idx: ctx.datasets.get(campaign.datasetVersion),
    memberIds: rows.memberRows.map((m) => m.userId),
    holdings: new Map(holdingRows.map((h) => [h.territoryId, h.ownerId])),
    // A pick number stays on the row when a country changes hands; it's only the owner's own if
    // they drafted it.
    picks: new Map(
      holdingRows.flatMap((h) =>
        h.pickNumber !== null && h.acquiredRound === 0 ? [[h.territoryId, h.pickNumber]] : [],
      ),
    ),
    round: campaign.round,
    resolutions,
    pointsChanges,
    wars: warRows,
    accords: rows.accordRows,
    games: rows.gameRows.map((g) => ({
      ...g,
      plies: g.moves.length,
      finishedAt: g.finishedAt?.toISOString() ?? null,
      opening: ctx.openings.name(g),
    })),
  });
}
