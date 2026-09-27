import { STAT_KEYS, type DatasetIndex, type StatKey, type Territory, type TerritoryId } from '@empire/rules';

/** An empire's total of one real-world figure, and how it compares. */
export interface EmpireFigure {
  key: StatKey;
  /** Sum over the countries that have the figure; null when none of them has it. */
  total: number | null;
  /** Countries without the figure. */
  missing: number;
  /** Countries whose figure is an estimate. */
  estimated: number;
  /** Share of the world's total, from 0 to 1. */
  share: number | null;
  /** Where the empire would rank among the world's countries. */
  worldRank: number | null;
  /** The real countries either side of it in that ranking, leaving out its own. */
  above: Territory | null;
  below: Territory | null;
  /** Where it ranks among the campaign's empires, 1 being the largest. */
  empireRank: number | null;
}

/** Every territory with the figure, largest first, per dataset. */
const rankings = new WeakMap<DatasetIndex, Map<StatKey, Territory[]>>();

function ranking(idx: DatasetIndex, key: StatKey): Territory[] {
  let byKey = rankings.get(idx);
  if (!byKey) rankings.set(idx, (byKey = new Map()));
  let list = byKey.get(key);
  if (!list) {
    list = idx.dataset.territories
      .filter((t) => t.stats[key] !== null)
      .sort((a, b) => b.stats[key]! - a.stats[key]! || a.name.localeCompare(b.name));
    byKey.set(key, list);
  }
  return list;
}

/** The sum of a figure over some countries, or null when none of them has it. */
export function totalOf(idx: DatasetIndex, ids: readonly TerritoryId[], key: StatKey): number | null {
  let total: number | null = null;
  for (const id of ids) {
    const figure = idx.byId.get(id)?.stats[key];
    if (figure !== null && figure !== undefined) total = (total ?? 0) + figure;
  }
  return total;
}

/** Each real-world figure for one empire: its total, share of the world and rankings. */
export function empireFigures(
  idx: DatasetIndex,
  holdingsByUser: ReadonlyMap<string, readonly TerritoryId[]>,
  userId: string,
): Record<StatKey, EmpireFigure> {
  const ids = holdingsByUser.get(userId) ?? [];
  const own = new Set(ids);
  const entries = STAT_KEYS.map((key): [StatKey, EmpireFigure] => {
    const total = totalOf(idx, ids, key);
    const territories = ids.flatMap((id) => idx.byId.get(id) ?? []);
    const world = idx.dataset.territories.reduce((sum, t) => sum + (t.stats[key] ?? 0), 0);
    const ranked = ranking(idx, key);
    let worldRank: number | null = null;
    let above: Territory | null = null;
    let below: Territory | null = null;
    if (total !== null) {
      const bigger = ranked.filter((t) => t.stats[key]! > total);
      worldRank = bigger.length + 1;
      above = bigger.filter((t) => !own.has(t.id)).at(-1) ?? null;
      below = ranked.find((t) => t.stats[key]! <= total && !own.has(t.id)) ?? null;
    }
    const others = [...holdingsByUser.keys()]
      .filter((u) => u !== userId)
      .map((u) => totalOf(idx, holdingsByUser.get(u)!, key));
    return [
      key,
      {
        key,
        total,
        missing: territories.filter((t) => t.stats[key] === null).length,
        estimated: territories.filter((t) => t.stats[key] !== null && t.statMeta[key].estimated).length,
        share: total !== null && world > 0 ? total / world : null,
        worldRank,
        above,
        below,
        empireRank: total === null ? null : others.filter((o) => o !== null && o > total).length + 1,
      },
    ];
  });
  return Object.fromEntries(entries) as Record<StatKey, EmpireFigure>;
}

/** An empire's place by game value among the campaign's empires: 1 for the largest, ties sharing a place. */
export function valueRank(
  idx: DatasetIndex,
  holdingsByUser: ReadonlyMap<string, readonly TerritoryId[]>,
  userId: string,
) {
  const value = (u: string) => (holdingsByUser.get(u) ?? []).reduce((s, id) => s + (idx.byId.get(id)?.value ?? 0), 0);
  const mine = value(userId);
  return { rank: [...holdingsByUser.keys()].filter((u) => value(u) > mine).length + 1, of: holdingsByUser.size };
}

/** A share of the world as a percentage: "12.3%", "<0.1%". */
export function formatShare(share: number): string {
  if (share > 0 && share < 0.001) return '<0.1%';
  return `${(share * 100).toFixed(1)}%`;
}
