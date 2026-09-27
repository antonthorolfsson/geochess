import { accordsInForce, activeTruces, activeWar, renunciationsFrom, type Truce, type WarBoard } from '@empire/rules';
import { and, eq, gte, ne, or } from 'drizzle-orm';
import type { CampaignRow } from '../campaigns/mutate';
import type { AppContext } from '../context';
import type { Tx } from '../db/client';
import { holdings, wars, type games } from '../db/schema';
import { warAccords } from '../diplomacy/accords';

export type WarRow = typeof wars.$inferSelect;
export type GameRow = typeof games.$inferSelect;

/** Wars that still matter: unresolved ones, and ones resolved recently enough to hold a truce. */
export async function relevantWars(db: Tx | AppContext['db'], campaign: CampaignRow): Promise<WarRow[]> {
  return db
    .select()
    .from(wars)
    .where(
      and(
        eq(wars.campaignId, campaign.id),
        or(ne(wars.status, 'resolved'), gte(wars.resolvedRound, campaign.round - campaign.rules.war.truceRounds)),
      ),
    );
}

export function trucesFrom(campaign: CampaignRow, rows: readonly WarRow[]): Truce[] {
  const resolved = rows.flatMap((w) =>
    w.status === 'resolved' && w.outcome && w.resolvedRound !== null
      ? [{ attackerId: w.attackerId, defenderId: w.defenderId, outcome: w.outcome, resolvedRound: w.resolvedRound }]
      : [],
  );
  return activeTruces(campaign.rules, campaign.round, resolved);
}

/** Everything the war rules need about a campaign right now. */
export async function loadBoard(ctx: AppContext, tx: Tx, campaign: CampaignRow): Promise<WarBoard> {
  const rows = await tx
    .select({ territoryId: holdings.territoryId, ownerId: holdings.ownerId, acquiredRound: holdings.acquiredRound })
    .from(holdings)
    .where(eq(holdings.campaignId, campaign.id));
  const warRows = await relevantWars(tx, campaign);
  const accordRows = await warAccords(tx, campaign);
  return {
    idx: ctx.datasets.get(campaign.datasetVersion),
    rules: campaign.rules,
    round: campaign.round,
    holdings: new Map(rows.map((r) => [r.territoryId, { ownerId: r.ownerId, acquiredRound: r.acquiredRound }])),
    wars: warRows.filter((w) => w.status !== 'resolved').map(activeWar),
    truces: trucesFrom(campaign, warRows),
    accords: accordsInForce(accordRows, campaign.round),
    renunciations: renunciationsFrom(accordRows, campaign.round),
  };
}
