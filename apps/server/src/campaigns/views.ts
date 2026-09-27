import {
  draftRoundOf,
  parseRules,
  pickerAt,
  totalDraftPicks,
  type CampaignSummary,
  type CampaignView,
  type EventView,
  type InvitePreview,
} from '@empire/rules';
import { and, asc, count, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { AppContext } from '../context';
import { campaigns, events, games, holdings, members, users, wars } from '../db/schema';
import { notFound } from '../lib/errors';
import { relevantWars, trucesFrom, type GameRow } from '../wars/board';
import { toWarView } from '../wars/views';

const RECENT_EVENTS = 150;
/** Resolved wars included in a campaign view, most recent first. */
const RECENT_WARS = 30;

type EventRow = typeof events.$inferSelect;
type CampaignRow = typeof campaigns.$inferSelect;

export function toEventView(row: EventRow): EventView {
  return {
    id: row.id,
    round: row.round,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
    type: row.type,
    payload: row.payload,
  } as EventView;
}

function currentPicker(c: CampaignRow): string | null {
  return c.status === 'draft' && c.draftOrder?.length ? pickerAt(c.draftOrder, c.pickIndex) : null;
}

/** Everything a member needs to render a campaign. Non-members get a 404. */
export async function campaignView(ctx: AppContext, campaignId: string, viewerId: string): Promise<CampaignView> {
  return ctx.db.transaction(
    async (tx) => {
      const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
      const memberRows = await tx
        .select({
          userId: members.userId,
          name: users.name,
          lichessUsername: users.lichessUsername,
          color: members.color,
          autodraft: members.autodraft,
          tokens: members.tokens,
          joinedAt: members.joinedAt,
        })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(eq(members.campaignId, campaignId))
        .orderBy(asc(members.joinedAt));
      const viewer = memberRows.find((m) => m.userId === viewerId);
      if (!row || !viewer) throw notFound('Campaign not found.');
      const c = { ...row, rules: parseRules(row.rules) };
      // Draft lists and auto-draft settings are private: only the viewer's own are read.
      const [own] = await tx
        .select({ draftList: members.draftList, autodraftFallback: members.autodraftFallback })
        .from(members)
        .where(and(eq(members.campaignId, campaignId), eq(members.userId, viewerId)));

      const holdingRows = await tx
        .select({ territoryId: holdings.territoryId, ownerId: holdings.ownerId, acquiredRound: holdings.acquiredRound })
        .from(holdings)
        .where(eq(holdings.campaignId, campaignId));
      const eventRows = await tx
        .select()
        .from(events)
        .where(eq(events.campaignId, campaignId))
        .orderBy(desc(events.id))
        .limit(RECENT_EVENTS);

      const unresolved = await tx
        .select()
        .from(wars)
        .where(and(eq(wars.campaignId, campaignId), ne(wars.status, 'resolved')))
        .orderBy(desc(wars.declaredAt));
      const resolved = await tx
        .select()
        .from(wars)
        .where(and(eq(wars.campaignId, campaignId), eq(wars.status, 'resolved')))
        .orderBy(desc(wars.resolvedAt))
        .limit(RECENT_WARS);
      const warRows = [...unresolved, ...resolved];
      const gameRows = warRows.length
        ? await tx
            .select()
            .from(games)
            .where(
              inArray(
                games.warId,
                warRows.map((w) => w.id),
              ),
            )
            .orderBy(asc(games.createdAt))
        : [];
      const gamesByWar = new Map<string, GameRow[]>();
      for (const g of gameRows) gamesByWar.set(g.warId, [...(gamesByWar.get(g.warId) ?? []), g]);

      const order = c.draftOrder;
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        round: c.round,
        hostId: c.hostId,
        rules: c.rules,
        datasetVersion: c.datasetVersion,
        inviteCode: c.inviteCode,
        createdAt: c.createdAt.toISOString(),
        members: memberRows.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() })),
        holdings: Object.fromEntries(holdingRows.map((h) => [h.territoryId, h.ownerId])),
        draft: order?.length
          ? {
              order,
              pickIndex: c.pickIndex,
              totalPicks: totalDraftPicks(ctx.datasets.get(c.datasetVersion)),
              round: draftRoundOf(c.pickIndex, order.length),
              currentPicker: currentPicker(c),
            }
          : null,
        myDraftList: own?.draftList ?? [],
        myAutodraftFallback: own?.autodraftFallback ?? 'best',
        events: eventRows.reverse().map(toEventView),
        wars: warRows.map((w) => toWarView(w, gamesByWar.get(w.id) ?? [])),
        truces: trucesFrom(c, await relevantWars(tx, c)),
        acquired: Object.fromEntries(
          holdingRows.filter((h) => h.acquiredRound > 0).map((h) => [h.territoryId, h.acquiredRound]),
        ),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

export async function listCampaigns(ctx: AppContext, userId: string): Promise<CampaignSummary[]> {
  const rows = await ctx.db
    .select({ c: campaigns, myColor: members.color })
    .from(members)
    .innerJoin(campaigns, eq(campaigns.id, members.campaignId))
    .where(eq(members.userId, userId))
    .orderBy(desc(campaigns.createdAt));
  if (rows.length === 0) return [];
  const counts = await ctx.db
    .select({ campaignId: members.campaignId, n: count() })
    .from(members)
    .where(
      inArray(
        members.campaignId,
        rows.map((r) => r.c.id),
      ),
    )
    .groupBy(members.campaignId);
  const countById = new Map(counts.map((r) => [r.campaignId, r.n]));
  const attention = await attentionCounts(
    ctx,
    userId,
    rows.map((r) => r.c.id),
  );
  return rows.map(({ c, myColor }) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    round: c.round,
    hostId: c.hostId,
    memberCount: countById.get(c.id) ?? 0,
    maxPlayers: c.rules.maxPlayers,
    myColor,
    currentPicker: currentPicker(c),
    attention: attention.get(c.id) ?? 0,
    createdAt: c.createdAt.toISOString(),
  }));
}

/** Per campaign: wars waiting for the player's answer, plus games waiting for their move. */
async function attentionCounts(ctx: AppContext, userId: string, campaignIds: string[]): Promise<Map<string, number>> {
  const answers = await ctx.db
    .select({ campaignId: wars.campaignId, n: count() })
    .from(wars)
    .where(
      and(
        inArray(wars.campaignId, campaignIds),
        or(
          and(eq(wars.status, 'declared'), eq(wars.defenderId, userId)),
          and(eq(wars.status, 'countered'), eq(wars.attackerId, userId)),
        ),
      ),
    )
    .groupBy(wars.campaignId);
  const moves = await ctx.db
    .select({ campaignId: games.campaignId, n: count() })
    .from(games)
    .where(
      and(
        inArray(games.campaignId, campaignIds),
        eq(games.status, 'playing'),
        or(
          and(eq(games.whiteId, userId), sql`jsonb_array_length(${games.moves}) % 2 = 0`),
          and(eq(games.blackId, userId), sql`jsonb_array_length(${games.moves}) % 2 = 1`),
        ),
      ),
    )
    .groupBy(games.campaignId);
  const out = new Map<string, number>();
  for (const { campaignId, n } of [...answers, ...moves]) out.set(campaignId, (out.get(campaignId) ?? 0) + n);
  return out;
}

export async function invitePreview(ctx: AppContext, code: string, viewerId: string | null): Promise<InvitePreview> {
  const [row] = await ctx.db
    .select({ c: campaigns, hostName: users.name })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.hostId))
    .where(eq(campaigns.inviteCode, code));
  if (!row) throw notFound('This invite link is no longer valid.');
  const memberIds = await ctx.db
    .select({ userId: members.userId })
    .from(members)
    .where(eq(members.campaignId, row.c.id));
  return {
    campaign: {
      id: row.c.id,
      name: row.c.name,
      hostName: row.hostName,
      status: row.c.status,
      memberCount: memberIds.length,
      maxPlayers: row.c.rules.maxPlayers,
    },
    isMember: viewerId !== null && memberIds.some((m) => m.userId === viewerId),
  };
}
