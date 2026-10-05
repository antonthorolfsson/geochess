/**
 * Titles: points held by whoever leads the table on a figure, from round 1, moving with the lead
 * (`@empire/rules` `titles.ts` has the rule). Campaigns on mission rules version 5 play the catalog's
 * titles, as the server does (`settleTitles` in apps/server/src/victory/settle.ts); a what-if can
 * play others (`Variant.titles`), or none. Each move is marked in the history's awards (minus for
 * the old holder, plus for the new), so points-at-a-time (Kingslayer's leader) counts them.
 */
import {
  TITLE_KINDS,
  nextHolder,
  titleFigure,
  type DatasetIndex,
  type StatKey,
  type TerritoryId,
  type TitleKind,
  type UserId,
} from '@empire/rules';
import { nextSeq, note } from './state';
import type { SimState } from './types';

/**
 * Military might as the what-ifs tried it (docs/balance-report.md, "Military might instead of
 * military spending"): each country's share of the world's military spending and of its armed
 * forces, averaged, per 1,000 of the world.
 * - `mightBlend`: the shares as they are.
 * - `mightSqrt`: shares of the square roots (what version 5 plays, as `military`).
 * - `mightMixed`: the square root of spending, armed forces as they are.
 * Unknown figures count as zero.
 */
export const MIGHT_KEYS = ['mightBlend', 'mightSqrt', 'mightMixed'] as const;
export type MightKey = (typeof MIGHT_KEYS)[number];
/** What a title can count: the catalog's titles, a dataset figure, or a might the what-ifs tried. */
export type TitleStat = TitleKind | StatKey | MightKey;

const MIGHT: Record<MightKey, [(x: number) => number, (x: number) => number]> = {
  mightBlend: [(x) => x, (x) => x],
  mightSqrt: [Math.sqrt, Math.sqrt],
  mightMixed: [Math.sqrt, (x) => x],
};

const mightCache = new WeakMap<DatasetIndex, Map<MightKey, Map<TerritoryId, number>>>();

function mightOf(idx: DatasetIndex, key: MightKey): Map<TerritoryId, number> {
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

const isKind = (key: TitleStat): key is TitleKind => (TITLE_KINDS as readonly string[]).includes(key);
const isMight = (key: TitleStat): key is MightKey => (MIGHT_KEYS as readonly string[]).includes(key);

function figureOf(idx: DatasetIndex, key: TitleStat): (id: TerritoryId) => number {
  if (isKind(key)) return (id) => titleFigure(idx, key, id);
  if (isMight(key)) {
    const might = mightOf(idx, key);
    return (id) => might.get(id) ?? 0;
  }
  return (id) => idx.byId.get(id)?.stats[key] ?? 0;
}

/** The titles a campaign plays: the variant's (null: none), else its mission rules version's. */
export function titleRules(s: SimState): { stats: readonly TitleStat[]; points: number } | null {
  const variant = s.cfg.variant?.titles;
  if (variant !== undefined) return variant;
  return s.mr.titles ? { stats: s.mr.titles.kinds, points: s.mr.titles.points } : null;
}

export type TitleHolders = ReadonlyMap<TitleStat, UserId | null>;

/** Who would hold each title with this map, given who holds them now. */
export function titleHoldersFor(
  s: SimState,
  owners: Iterable<readonly [TerritoryId, UserId]>,
  current: TitleHolders = s.titles,
): Map<TitleStat, UserId | null> {
  const stats = titleRules(s)?.stats ?? [];
  const figures = stats.map((key) => figureOf(s.idx, key));
  const sums = stats.map(() => new Map(s.players.map((p) => [p.id, 0])));
  for (const [id, owner] of owners) {
    figures.forEach((f, i) => {
      const row = sums[i]!;
      if (row.has(owner)) row.set(owner, row.get(owner)! + f(id));
    });
  }
  return new Map(stats.map((key, i) => [key, nextHolder(sums[i]!, current.get(key) ?? null)]));
}

/** Title points a player holds under these holders. */
export function titlePointsOf(s: SimState, holders: TitleHolders, userId: UserId): number {
  const per = titleRules(s)?.points ?? 0;
  let n = 0;
  for (const holder of holders.values()) if (holder === userId) n += per;
  return n;
}

/** Titles a player holds now. */
export const titlesOf = (s: SimState, userId: UserId): TitleStat[] =>
  [...s.titles].filter(([, holder]) => holder === userId).map(([key]) => key);

/** Moves titles to whoever leads now, adjusting points. Whether any moved. */
export function settleTitles(s: SimState): boolean {
  const cfg = titleRules(s);
  if (!cfg) return false;
  const owners = [...s.holdings].map(([id, h]): [TerritoryId, UserId] => [id, h.ownerId]);
  const next = titleHoldersFor(s, owners);
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
