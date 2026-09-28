/**
 * What mission evaluators look at, and the graph arithmetic they share: holdings against the
 * baseline, connected blocks, and how many conquests it takes to reach a set of targets.
 */
import type { TerritoryId } from '../dataset';
import type { UserId } from '../draft';
import type { DatasetIndex } from '../graph';
import type { Transfer, WarOutcome } from '../war';

/** A war that has ended, as the battle missions count it. */
export interface MissionWar {
  id: string;
  attackerId: UserId;
  defenderId: UserId;
  /** The country the attack was launched from. */
  launchId: TerritoryId;
  /** The country fought over in the end (after any redirect). */
  targetId: TerritoryId;
  outcome: WarOutcome;
  transfers: readonly Transfer[];
  /** The round it ended in. */
  round: number;
  /** Its place in the campaign's history (the event id of its resolution). */
  seq: number;
}

/**
 * A signed accord as a stretch of the campaign's history, from the event that signed it to the
 * one that ended it (null while in force). A renewal ends the accord it replaces at the moment the
 * new one begins, so the two join up.
 */
export interface AccordSpan {
  id: string;
  players: readonly [UserId, UserId];
  from: number;
  to: number | null;
}

/** Where each war round began in the campaign's history (round 1 onwards). */
export interface RoundStart {
  round: number;
  seq: number;
}

export interface MissionHistory {
  /** Resolved wars, oldest first. */
  wars: readonly MissionWar[];
  accords: readonly AccordSpan[];
  roundStarts: readonly RoundStart[];
}

/** Everything a mission evaluation needs: the map, who holds what, and what has happened. */
export interface MissionWorld {
  idx: DatasetIndex;
  /** Every member. */
  players: readonly UserId[];
  owners: ReadonlyMap<TerritoryId, UserId>;
  /** Each player's holdings when the draft finished. */
  baseline: ReadonlyMap<UserId, ReadonlySet<TerritoryId>>;
  history: MissionHistory;
}

export const EMPTY_HISTORY: MissionHistory = { wars: [], accords: [], roundStarts: [] };

export function heldBy(owners: ReadonlyMap<TerritoryId, UserId>, userId: UserId): Set<TerritoryId> {
  const out = new Set<TerritoryId>();
  for (const [id, owner] of owners) if (owner === userId) out.add(id);
  return out;
}

export function valueOfSet(idx: DatasetIndex, ids: Iterable<TerritoryId>): number {
  let sum = 0;
  for (const id of ids) sum += idx.byId.get(id)?.value ?? 0;
  return sum;
}

/** The world with some countries changed hands. */
export function withTransfers(world: MissionWorld, transfers: readonly Transfer[]): MissionWorld {
  if (transfers.length === 0) return world;
  const owners = new Map(world.owners);
  for (const t of transfers) owners.set(t.territoryId, t.to);
  return { ...world, owners };
}

/** Connected blocks of `set` (by land or sea lane), each sorted, largest first then by id. */
export function components(idx: DatasetIndex, set: ReadonlySet<TerritoryId>): TerritoryId[][] {
  const seen = new Set<TerritoryId>();
  const out: TerritoryId[][] = [];
  for (const start of [...set].sort()) {
    if (seen.has(start)) continue;
    const block: TerritoryId[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const id = queue.pop()!;
      block.push(id);
      for (const n of idx.neighbors(id)) {
        if (set.has(n) && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    out.push(block.sort());
  }
  return out.sort((a, b) => b.length - a.length || (a[0]! < b[0]! ? -1 : 1));
}

/** A shortest path from `a` to `b` through `set` (both ends included), or null. */
export function pathWithin(
  idx: DatasetIndex,
  set: ReadonlySet<TerritoryId>,
  a: TerritoryId,
  b: TerritoryId,
): TerritoryId[] | null {
  if (!set.has(a) || !set.has(b)) return null;
  const prev = new Map<TerritoryId, TerritoryId | null>([[a, null]]);
  const queue = [a];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (id === b) break;
    for (const n of [...idx.neighbors(id)].sort()) {
      if (set.has(n) && !prev.has(n)) {
        prev.set(n, id);
        queue.push(n);
      }
    }
  }
  if (!prev.has(b)) return null;
  const path: TerritoryId[] = [];
  for (let at: TerritoryId | null = b; at !== null; at = prev.get(at) ?? null) path.push(at);
  return path.reverse();
}

/**
 * Whether two neighbors only meet across the edge of the map: their label points are more than half
 * the world apart, so on a map centred on Greenwich the link leaves one side and comes back on the
 * other (Russia and the United States across the Bering Strait).
 */
export function crossesMapEdge(idx: DatasetIndex, a: TerritoryId, b: TerritoryId): boolean {
  const [x] = idx.byId.get(a)!.anchor;
  const [y] = idx.byId.get(b)!.anchor;
  return Math.abs(x - y) > 180;
}

/**
 * Steps between two countries by land or sea lane, ignoring ownership. With `onMap`, links that
 * cross the edge of the map don't count.
 */
export function hopDistances(
  idx: DatasetIndex,
  from: TerritoryId,
  opts: { onMap?: boolean } = {},
): Map<TerritoryId, number> {
  const dist = new Map<TerritoryId, number>([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const n of idx.neighbors(id)) {
      if (opts.onMap && crossesMapEdge(idx, id, n)) continue;
      if (!dist.has(n)) {
        dist.set(n, dist.get(id)! + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

export interface CaptureCosts {
  /** Conquests needed to reach and take each country (0 for countries already held). */
  cost: Map<TerritoryId, number>;
  prev: Map<TerritoryId, TerritoryId | null>;
}

/**
 * How many conquests it takes to reach each country from `held`: entering a held country is free,
 * entering any other costs one (a 0-1 breadth-first search). Countries in `blocked` can't be
 * crossed or taken. Starts from `sources` (by default all of `held`).
 */
export function captureCosts(
  idx: DatasetIndex,
  held: ReadonlySet<TerritoryId>,
  opts: { sources?: Iterable<TerritoryId>; blocked?: ReadonlySet<TerritoryId> } = {},
): CaptureCosts {
  const cost = new Map<TerritoryId, number>();
  const prev = new Map<TerritoryId, TerritoryId | null>();
  // A bucket queue: each step costs 0 or 1, so countries settle in order of cost.
  const buckets: TerritoryId[][] = [];
  for (const id of [...(opts.sources ?? held)].sort()) {
    if (opts.blocked?.has(id)) continue;
    const c = held.has(id) ? 0 : 1;
    if ((cost.get(id) ?? Infinity) <= c) continue;
    cost.set(id, c);
    prev.set(id, null);
    (buckets[c] ??= []).push(id);
  }
  const done = new Set<TerritoryId>();
  for (let c = 0; c < buckets.length; c++) {
    const bucket = buckets[c];
    if (!bucket) continue;
    for (let i = 0; i < bucket.length; i++) {
      const id = bucket[i]!;
      if (done.has(id) || cost.get(id) !== c) continue;
      done.add(id);
      for (const n of [...idx.neighbors(id)].sort()) {
        if (opts.blocked?.has(n) || done.has(n)) continue;
        const next = c + (held.has(n) ? 0 : 1);
        if (next < (cost.get(n) ?? Infinity)) {
          cost.set(n, next);
          prev.set(n, id);
          (buckets[next] ??= []).push(n);
        }
      }
    }
  }
  return { cost, prev };
}

/** The route `captureCosts` found to `to`, from where it started. */
export function routeTo(costs: CaptureCosts, to: TerritoryId): TerritoryId[] {
  if (!costs.prev.has(to)) return [];
  const route: TerritoryId[] = [];
  for (let at: TerritoryId | null = to; at !== null; at = costs.prev.get(at) ?? null) route.push(at);
  return route.reverse();
}

/**
 * Countries a player could take in one war: held by another player and bordering one of theirs.
 * Tokens, truces, locks and accords are ignored: they delay an attack, they don't rule it out.
 */
export function frontier(
  idx: DatasetIndex,
  owners: ReadonlyMap<TerritoryId, UserId>,
  held: ReadonlySet<TerritoryId>,
): TerritoryId[] {
  const out = new Set<TerritoryId>();
  for (const id of held) {
    for (const n of idx.neighbors(id)) {
      if (held.has(n) || out.has(n)) continue;
      if (owners.get(n) !== undefined) out.add(n);
    }
  }
  return [...out].sort();
}

export interface AcquisitionPlan {
  /** Every country to conquer, in order: targets and the countries in the way. */
  conquests: TerritoryId[];
  /** The targets among them. */
  targets: TerritoryId[];
}

/**
 * A greedy estimate of the conquests needed to hold `need` of `targets`, starting from `held`:
 * repeatedly take the cheapest target to reach, with everything on the way. Targets already held
 * count. Null if they can't be reached. A heuristic, not a proof of the minimum.
 */
export function acquisitionPlan(
  idx: DatasetIndex,
  held: ReadonlySet<TerritoryId>,
  targets: readonly TerritoryId[],
  need: number,
  opts: { blocked?: ReadonlySet<TerritoryId> } = {},
): AcquisitionPlan | null {
  const current = new Set(held);
  const conquests: TerritoryId[] = [];
  const taken: TerritoryId[] = [];
  let have = targets.filter((t) => current.has(t)).length;
  while (have < need) {
    if (current.size === 0) return null;
    const costs = captureCosts(idx, current, { blocked: opts.blocked });
    // The cheapest target to reach; among equals the least valuable (the easiest fight), then by id.
    let best: { id: TerritoryId; cost: number; value: number } | null = null;
    for (const t of targets) {
      if (current.has(t)) continue;
      const c = costs.cost.get(t);
      if (c === undefined) continue;
      const v = idx.byId.get(t)?.value ?? 0;
      if (!best || c < best.cost || (c === best.cost && (v < best.value || (v === best.value && t < best.id)))) {
        best = { id: t, cost: c, value: v };
      }
    }
    if (best === null) return null;
    for (const id of routeTo(costs, best.id)) {
      if (current.has(id)) continue;
      current.add(id);
      conquests.push(id);
    }
    taken.push(best.id);
    have = targets.filter((t) => current.has(t)).length;
  }
  return { conquests, targets: taken };
}

/** Where on Earth a country is, as a unit vector, for bearings between regions. */
function unitVector([lon, lat]: readonly [number, number]): [number, number, number] {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

/** The middle of a group of countries (by their label points), as longitude and latitude. */
export function centroid(idx: DatasetIndex, ids: Iterable<TerritoryId>): [number, number] | null {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const id of ids) {
    const t = idx.byId.get(id);
    if (!t) continue;
    const [a, b, c] = unitVector(t.anchor);
    x += a;
    y += b;
    z += c;
    n++;
  }
  if (n === 0) return null;
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
  return [lon, lat];
}

/** The initial compass bearing from one point to another, in degrees from north. */
export function bearing(from: readonly [number, number], to: readonly [number, number]): number {
  const [l1, p1] = [(from[0] * Math.PI) / 180, (from[1] * Math.PI) / 180];
  const [l2, p2] = [(to[0] * Math.PI) / 180, (to[1] * Math.PI) / 180];
  const y = Math.sin(l2 - l1) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** The smaller angle between two bearings. */
export const angleBetween = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
