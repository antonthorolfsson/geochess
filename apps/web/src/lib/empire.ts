import {
  FACT_KEYS,
  factOf,
  STAT_KEYS,
  type DatasetIndex,
  type FactKey,
  type FactTable,
  type StatKey,
  type Territory,
  type TerritoryId,
} from '@empire/rules';

/** A real-world figure: one of the dataset's, or one of the arsenals and energy table's. */
export type FigureKey = StatKey | FactKey;

const isStatKey = (key: FigureKey): key is StatKey => (STAT_KEYS as readonly string[]).includes(key);

/** A territory's figure, or null when it has none (or the table it's in hasn't loaded). */
export function figureOf(t: Territory, key: FigureKey, facts: FactTable | null = null): number | null {
  return isStatKey(key) ? t.stats[key] : factOf(facts, t.id, key);
}

/** An empire's total of one real-world figure, and how it compares. */
export interface EmpireFigure {
  key: FigureKey;
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

/** Every territory with the figure, largest first, per dataset (and figures table). */
const rankings = new WeakMap<DatasetIndex, Map<FigureKey, Territory[]>>();
const factRankings = new WeakMap<FactTable, WeakMap<DatasetIndex, Map<FigureKey, Territory[]>>>();

function ranking(idx: DatasetIndex, key: FigureKey, facts: FactTable | null): Territory[] {
  if (!isStatKey(key) && !facts) return [];
  let byIdx = rankings;
  if (!isStatKey(key)) {
    byIdx = factRankings.get(facts!) ?? new WeakMap();
    factRankings.set(facts!, byIdx);
  }
  let byKey = byIdx.get(idx);
  if (!byKey) byIdx.set(idx, (byKey = new Map()));
  let list = byKey.get(key);
  if (!list) {
    list = idx.dataset.territories
      .filter((t) => figureOf(t, key, facts) !== null)
      .sort((a, b) => figureOf(b, key, facts)! - figureOf(a, key, facts)! || a.name.localeCompare(b.name));
    byKey.set(key, list);
  }
  return list;
}

/** The sum of a figure over some countries, or null when none of them has it. */
export function totalOf(
  idx: DatasetIndex,
  ids: readonly TerritoryId[],
  key: FigureKey,
  facts: FactTable | null = null,
): number | null {
  let total: number | null = null;
  for (const id of ids) {
    const t = idx.byId.get(id);
    const figure = t ? figureOf(t, key, facts) : null;
    if (figure !== null) total = (total ?? 0) + figure;
  }
  return total;
}

/**
 * Each real-world figure for one empire: its total, share of the world and rankings. The arsenals
 * and energy figures need their table; without it they have no total.
 */
export function empireFigures(
  idx: DatasetIndex,
  holdingsByUser: ReadonlyMap<string, readonly TerritoryId[]>,
  userId: string,
  facts: FactTable | null = null,
): Record<FigureKey, EmpireFigure> {
  const ids = holdingsByUser.get(userId) ?? [];
  const own = new Set(ids);
  const territories = ids.flatMap((id) => idx.byId.get(id) ?? []);
  const entries = [...STAT_KEYS, ...FACT_KEYS].map((key): [FigureKey, EmpireFigure] => {
    const of = (t: Territory) => figureOf(t, key, facts);
    const total = totalOf(idx, ids, key, facts);
    const world = idx.dataset.territories.reduce((sum, t) => sum + (of(t) ?? 0), 0);
    const ranked = ranking(idx, key, facts);
    let worldRank: number | null = null;
    let above: Territory | null = null;
    let below: Territory | null = null;
    if (total !== null) {
      const bigger = ranked.filter((t) => of(t)! > total);
      worldRank = bigger.length + 1;
      above = bigger.filter((t) => !own.has(t.id)).at(-1) ?? null;
      below = ranked.find((t) => of(t)! <= total && !own.has(t.id)) ?? null;
    }
    const others = [...holdingsByUser.keys()]
      .filter((u) => u !== userId)
      .map((u) => totalOf(idx, holdingsByUser.get(u)!, key, facts));
    return [
      key,
      {
        key,
        total,
        missing: territories.filter((t) => of(t) === null).length,
        estimated: isStatKey(key)
          ? territories.filter((t) => t.stats[key] !== null && t.statMeta[key].estimated).length
          : 0,
        share: total !== null && world > 0 ? total / world : null,
        worldRank,
        above,
        below,
        empireRank: total === null ? null : others.filter((o) => o !== null && o > total).length + 1,
      },
    ];
  });
  return Object.fromEntries(entries) as Record<FigureKey, EmpireFigure>;
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
