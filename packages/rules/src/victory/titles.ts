/**
 * Titles: a point each for leading the table on population, land, the economy (nominal GDP) and
 * military might, from mission rules version 5. Whoever leads on a figure when round 1 starts holds
 * its title; it moves the moment someone's total passes the holder's, points and all. A holder who
 * is only matched keeps it, and a lead shared by players who don't hold it goes to nobody.
 */
import type { TerritoryId } from '../dataset';
import type { UserId } from '../draft';
import type { DatasetIndex } from '../graph';

export const TITLE_KINDS = ['population', 'land', 'economy', 'military'] as const;
export type TitleKind = (typeof TITLE_KINDS)[number];

export interface TitleInfo {
  kind: TitleKind;
  /** "Largest Population". */
  name: string;
  /** What is counted, as in "the most …". */
  measure: string;
}

export const TITLES: Record<TitleKind, TitleInfo> = {
  population: { kind: 'population', name: 'Largest Population', measure: 'people' },
  land: { kind: 'land', name: 'Largest Territory', measure: 'land area' },
  economy: { kind: 'economy', name: 'Largest Economy', measure: 'GDP' },
  military: { kind: 'military', name: 'Greatest Military Might', measure: 'military might' },
};

/** Military might is counted per million of the world's; shown per thousand (`mightText`). */
export const MIGHT_SCALE = 1_000_000;

const mightCache = new WeakMap<DatasetIndex, ReadonlyMap<TerritoryId, number>>();

/**
 * Military might: each country's share of the world's military spending and its share of the
 * world's armed forces, averaged, both counted by their square roots so that no superpower owns the
 * title (the USA has 37% of the world's spending, but 5.6% of its might). Whole numbers per million
 * of the world, so empires always add up to exactly the same totals. Unknown figures count as zero.
 * The simulator chose this over the plain shares (docs/balance-report.md, "Titles").
 */
export function militaryMight(idx: DatasetIndex): ReadonlyMap<TerritoryId, number> {
  const cached = mightCache.get(idx);
  if (cached) return cached;
  const spend = new Map(idx.ids.map((id) => [id, Math.sqrt(idx.byId.get(id)!.stats.militarySpendingUsd ?? 0)]));
  const forces = new Map(idx.ids.map((id) => [id, Math.sqrt(idx.byId.get(id)!.stats.armedForces ?? 0)]));
  const total = (m: Map<TerritoryId, number>) => [...m.values()].reduce((a, b) => a + b, 0) || 1;
  const [s, f] = [total(spend), total(forces)];
  const might = new Map(
    idx.ids.map((id) => [id, Math.round(MIGHT_SCALE * (0.5 * (spend.get(id)! / s) + 0.5 * (forces.get(id)! / f)))]),
  );
  mightCache.set(idx, might);
  return might;
}

/** One country's figure for a title: people, km², US dollars of GDP, or might (unknown: zero). */
export function titleFigure(idx: DatasetIndex, kind: TitleKind, id: TerritoryId): number {
  const t = idx.byId.get(id);
  if (!t) return 0;
  switch (kind) {
    case 'population':
      return t.stats.population ?? 0;
    case 'land':
      return t.stats.areaKm2 ?? 0;
    case 'economy':
      return t.stats.gdpNominalUsd ?? 0;
    case 'military':
      return militaryMight(idx).get(id) ?? 0;
  }
}

/** Each player's totals for each title, from who holds what. */
export function titleTotals(
  idx: DatasetIndex,
  owners: Iterable<readonly [TerritoryId, UserId]>,
  players: readonly UserId[],
  kinds: readonly TitleKind[] = TITLE_KINDS,
): Map<TitleKind, Map<UserId, number>> {
  const out = new Map(kinds.map((k) => [k, new Map(players.map((p) => [p, 0]))]));
  for (const [id, owner] of owners) {
    for (const k of kinds) {
      const row = out.get(k)!;
      if (row.has(owner)) row.set(owner, row.get(owner)! + titleFigure(idx, k, id));
    }
  }
  return out;
}

/**
 * Who holds a title given everyone's totals and who held it: the holder keeps it while nobody has
 * more; otherwise the one player with the most has it, and nobody if several share the lead (or
 * nobody has any).
 */
export function nextHolder(totals: ReadonlyMap<UserId, number>, holder: UserId | null): UserId | null {
  let top = 0;
  for (const v of totals.values()) top = Math.max(top, v);
  if (top <= 0) return null;
  if (holder !== null && totals.get(holder) === top) return holder;
  const leaders = [...totals].filter(([, v]) => v === top);
  return leaders.length === 1 ? leaders[0]![0] : null;
}

export type TitleHolders = Partial<Record<TitleKind, UserId | null>>;

/** Who holds each title now, given who held them. */
export function titleHolders(
  idx: DatasetIndex,
  owners: Iterable<readonly [TerritoryId, UserId]>,
  players: readonly UserId[],
  current: TitleHolders,
  kinds: readonly TitleKind[] = TITLE_KINDS,
): Record<TitleKind, UserId | null> {
  const totals = titleTotals(idx, owners, players, kinds);
  const out = {} as Record<TitleKind, UserId | null>;
  for (const k of kinds) out[k] = nextHolder(totals.get(k)!, current[k] ?? null);
  return out;
}

/** The titles a player holds. */
export const titlesHeldBy = (holders: TitleHolders, userId: UserId): TitleKind[] =>
  TITLE_KINDS.filter((k) => holders[k] === userId);

/** Military might as players read it: per thousand of the world's, one decimal. */
export const mightText = (might: number) => (might / (MIGHT_SCALE / 1000)).toFixed(1);
