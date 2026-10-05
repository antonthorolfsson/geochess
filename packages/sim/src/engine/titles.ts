/**
 * Titles, a what-if (`Variant.titles`): points held by whoever leads the table on a real-world
 * figure (population, land area, GDP, military spending), from the moment the draft ends. A title
 * moves when someone else's total passes the holder's; a holder who is only matched keeps it, and
 * when nobody holds it, a lead shared by several players gives it to none of them. Unlike mission
 * points, title points are lost with the title. Each move is marked in the history's awards (plus
 * for the new holder, minus for the old), so points-at-a-time (Kingslayer's leader) counts them.
 */
import type { StatKey, TerritoryId, UserId } from '@empire/rules';
import { nextSeq, note } from './state';
import type { SimState } from './types';

export type TitleHolders = ReadonlyMap<StatKey, UserId | null>;

/** Each player's totals for the titles' figures, unknown figures counting as zero. */
function totals(s: SimState, stats: readonly StatKey[], owners: Iterable<[TerritoryId, UserId]>) {
  const out = new Map<UserId, number[]>(s.players.map((p) => [p.id, stats.map(() => 0)]));
  for (const [id, owner] of owners) {
    const row = out.get(owner);
    const t = s.idx.byId.get(id);
    if (!row || !t) continue;
    stats.forEach((key, i) => (row[i]! += t.stats[key] ?? 0));
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
): Map<StatKey, UserId | null> {
  const stats = s.cfg.variant?.titles?.stats ?? [];
  const sums = totals(s, stats, owners);
  const out = new Map<StatKey, UserId | null>();
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
export const titlesOf = (s: SimState, userId: UserId): StatKey[] =>
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
