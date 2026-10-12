import type { EventView, TerritoryId, Transfer } from '@empire/rules';
import type { CampaignModel } from './campaign';

/**
 * Countries changing hands in a war, as the map plays it: the winner's color crawls over them from
 * where the war was fought, the attacker's from the country they attacked from, the defender's from
 * the country they defended.
 */
export interface MapConquest {
  /** Unique: each conquest plays once. */
  key: string;
  /** The winner's empire color, and the color the countries had before. */
  color: number;
  previous: number;
  /** Each country taken, in the order they fall. */
  steps: ConquestStep[];
  /** The viewer's own war: if none of it is in view when it plays, the map shows it first. */
  frame: boolean;
}

export interface ConquestStep {
  id: TerritoryId;
  /** The country the color crosses in from: over their border, or by the sea lane between them. Null for none. */
  from: TerritoryId | null;
  /** 0 for the countries that fall first, 1 for those that fall from them, and so on. */
  wave: number;
}

/**
 * The order countries fall in as a winner's color spreads over them from `source`: first those that
 * border it, then those that border those, and so on. A country that borders none of them comes
 * from a neighbor the winner already `held`, or else from the source, across the map.
 */
export function conquestSteps(
  neighbors: (id: TerritoryId) => readonly TerritoryId[],
  source: TerritoryId | null,
  taken: readonly TerritoryId[],
  held: (id: TerritoryId) => boolean,
): ConquestStep[] {
  const left = new Set(taken);
  const steps: ConquestStep[] = [];
  let frontier = source ? [source] : [];
  for (let wave = 0; frontier.length > 0 && left.size > 0; wave++) {
    const next: TerritoryId[] = [];
    for (const from of frontier) {
      for (const id of neighbors(from)) {
        if (!left.delete(id)) continue;
        steps.push({ id, from, wave });
        next.push(id);
      }
    }
    frontier = next;
  }
  for (const id of taken) {
    if (!left.has(id)) continue;
    steps.push({ id, from: neighbors(id).find(held) ?? source, wave: 0 });
  }
  return steps;
}

/**
 * The conquests in a batch of campaign events, read against the campaign as it stood before them
 * (the push arrives ahead of the refetch): one for each way countries went in each war resolved.
 */
export function conquestsFrom(model: CampaignModel, events: readonly EventView[]): MapConquest[] {
  const me = model.me.userId;
  const out: MapConquest[] = [];
  for (const e of events) {
    if (e.type !== 'war.resolved' || e.payload.transfers.length === 0) continue;
    const war = model.campaign.wars.find((w) => w.id === e.payload.warId);
    // Usually one way, from the loser to the winner; peace terms can send countries both ways.
    const ways = new Map<string, Transfer[]>();
    for (const t of e.payload.transfers) {
      const way = `${t.from}>${t.to}`;
      ways.set(way, [...(ways.get(way) ?? []), t]);
    }
    for (const [way, transfers] of ways) {
      const { from: loserId, to: winnerId } = transfers[0]!;
      const winner = model.membersById.get(winnerId);
      const loser = model.membersById.get(loserId);
      if (!winner || !loser) continue;
      const source = !war
        ? null
        : winnerId === war.attackerId
          ? war.launchId
          : winnerId === war.defenderId
            ? war.targetId
            : null;
      out.push({
        key: `${e.id}:${way}`,
        color: winner.color,
        previous: loser.color,
        steps: conquestSteps(
          model.idx.neighbors,
          source,
          transfers.map((t) => t.territoryId),
          (id) => model.owners.get(id) === winnerId,
        ),
        frame: winnerId === me || loserId === me,
      });
    }
  }
  return out;
}
