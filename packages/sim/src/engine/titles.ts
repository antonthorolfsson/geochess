/**
 * Titles, a what-if (`Variant.titles`): points held by whoever leads the table on a real-world
 * figure (population, land area, GDP, military spending), from the moment the draft ends. A title
 * moves when someone else's total passes the holder's; a holder who is only matched keeps it, and
 * when nobody holds it, a lead shared by several players gives it to none of them. Unlike mission
 * points, title points are lost with the title. Each move is marked in the history's awards (plus
 * for the new holder, minus for the old), so points-at-a-time (Kingslayer's leader) counts them.
 */
import type { DatasetIndex, StatKey, TerritoryId, UserId } from '@empire/rules';
import { nextSeq, note } from './state';
import type { SimState } from './types';

/**
 * Military might, a figure made up for titles so that one country can't own the title (the USA has
 * 37% of the world's military spending, but 5% of its soldiers): each country's share of the
 * world's military spending and of its armed forces, averaged and counted per 1,000 of the world.
 * - `mightBlend`: the shares as they are.
 * - `mightSqrt`: shares of the square roots, which flattens the giants (the top country has 5.6%).
 * - `mightMixed`: the square root of spending, armed forces as they are (China, the USA and India
 *   about level at 7% each).
 * Unknown figures count as zero.
 */
export const MIGHT_KEYS = ['mightBlend', 'mightSqrt', 'mightMixed'] as const;
export type MightKey = (typeof MIGHT_KEYS)[number];
export type TitleStat = StatKey | MightKey;

const MIGHT: Record<MightKey, [(x: number) => number, (x: number) => number]> = {
  mightBlend: [(x) => x, (x) => x],
  mightSqrt: [Math.sqrt, Math.sqrt],
  mightMixed: [Math.sqrt, (x) => x],
};

const mightCache = new WeakMap<DatasetIndex, Map<MightKey, Map<TerritoryId, number>>>();

/** A military might figure for every country of the map. */
export function mightOf(idx: DatasetIndex, key: MightKey): Map<TerritoryId, number> {
  let byKey = mightCache.get(idx);
  if (!byKey) mightCache.set(idx, (byKey = new Map()));
  let out = byKey.get(key);
  if (out) return out;
  const [fs, ff] = MIGHT[key];
  const spend = new Map(idx.ids.map((id) => [id, fs(idx.byId.get(id)!.stats.militarySpendingUsd ?? 0)]));
  const forces = new Map(idx.ids.map((id) => [id, ff(idx.byId.get(id)!.stats.armedForces ?? 0)]));
  const sum = (m: Map<TerritoryId, number>) => [...m.values()].reduce((a, b) => a + b, 0) || 1;
  const [S, F] = [sum(spend), sum(forces)];
  out = new Map(idx.ids.map((id) => [id, 1000 * (0.5 * (spend.get(id)! / S) + 0.5 * (forces.get(id)! / F))]));
  byKey.set(key, out);
  return out;
}

const isMight = (key: TitleStat): key is MightKey => (MIGHT_KEYS as readonly string[]).includes(key);

export type TitleHolders = ReadonlyMap<TitleStat, UserId | null>;

/** Each player's totals for the titles' figures, unknown figures counting as zero. */
function totals(s: SimState, stats: readonly TitleStat[], owners: Iterable<[TerritoryId, UserId]>) {
  const figure = stats.map((key) => {
    if (isMight(key)) {
      const might = mightOf(s.idx, key);
      return (id: TerritoryId) => might.get(id) ?? 0;
    }
    return (id: TerritoryId) => s.idx.byId.get(id)?.stats[key] ?? 0;
  });
  const out = new Map<UserId, number[]>(s.players.map((p) => [p.id, stats.map(() => 0)]));
  for (const [id, owner] of owners) {
    const row = out.get(owner);
    if (!row || !s.idx.byId.has(id)) continue;
    figure.forEach((f, i) => (row[i]! += f(id)));
  }
  return out;
}

const ownersOf = (s: SimState): Iterable<[TerritoryId, UserId]> =>
  [...s.holdings].map(([id, h]): [TerritoryId, UserId] => [id, h.ownerId]);

/** Who would hold each title with this map, given who holds them now. */
export function titleHoldersFor(
  s: SimState,
  owners: Iterable<[TerritoryId, UserId]>,
  current: TitleHolders = s.titles,
): Map<TitleStat, UserId | null> {
  const stats = s.cfg.variant?.titles?.stats ?? [];
  const sums = totals(s, stats, owners);
  const out = new Map<TitleStat, UserId | null>();
  stats.forEach((key, i) => {
    let top = -Infinity;
    for (const row of sums.values()) top = Math.max(top, row[i]!);
    const leaders = [...sums].filter(([, row]) => row[i] === top).map(([id]) => id);
    const holder = current.get(key) ?? null;
    if (holder !== null && leaders.includes(holder)) out.set(key, holder);
    else out.set(key, leaders.length === 1 && top > 0 ? leaders[0]! : null);
  });
  return out;
}

/** Title points a player holds under these holders. */
export function titlePointsOf(s: SimState, holders: TitleHolders, userId: UserId): number {
  const per = s.cfg.variant?.titles?.points ?? 0;
  let n = 0;
  for (const holder of holders.values()) if (holder === userId) n += per;
  return n;
}

/** Titles a player holds now. */
export const titlesOf = (s: SimState, userId: UserId): TitleStat[] =>
  [...s.titles].filter(([, holder]) => holder === userId).map(([key]) => key);

/** Moves titles to whoever leads now, adjusting points. Whether any moved. */
export function settleTitles(s: SimState): boolean {
  const cfg = s.cfg.variant?.titles;
  if (!cfg) return false;
  const next = titleHoldersFor(s, ownersOf(s));
  let moved = false;
  for (const [key, holder] of next) {
    const before = s.titles.get(key) ?? null;
    if (holder === before) continue;
    moved = true;
    const seq = nextSeq(s);
    if (before !== null) {
      s.points.set(before, (s.points.get(before) ?? 0) - cfg.points);
      s.history.awards.push({ userId: before, points: -cfg.points, seq });
    }
    if (holder !== null) {
      s.points.set(holder, (s.points.get(holder) ?? 0) + cfg.points);
      s.history.awards.push({ userId: holder, points: cfg.points, seq });
    }
    s.titles.set(key, holder);
    if (s.round > 1 || before !== null) s.titleMoves++;
    note(s, () => `Most ${key}: ${before ?? 'nobody'} → ${holder ?? 'nobody'}`);
  }
  return moved;
}
