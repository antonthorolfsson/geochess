/**
 * What mission evaluators look at, and the graph arithmetic they share: holdings against the
 * baseline, connected blocks, and how many conquests it takes to reach a set of targets.
 */
import type { GameEndReason } from '../chess';
import type { StatKey, TerritoryId } from '../dataset';
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
  /** The round it was declared in. */
  declaredRound: number;
  /** The round it ended in. */
  round: number;
  /** Where its declaration falls in the campaign's history (the event id of `war.declared`). */
  declaredSeq: number;
  /** Its place in the campaign's history (the event id of its resolution). */
  seq: number;
  /** How the game that decided it ended; null when no game did (tribute, a withdrawal, a concession). */
  endReason: GameEndReason | null;
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
  /** Who renounced it, if it was broken. */
  brokenBy: UserId | null;
}

/** Where each war round began in the campaign's history (round 1 onwards). */
export interface RoundStart {
  round: number;
  seq: number;
}

/** Points awarded for a mission, and where in the campaign's history. */
export interface AwardMark {
  userId: UserId;
  points: number;
  seq: number;
}

export interface MissionHistory {
  /** Resolved wars, oldest first. */
  wars: readonly MissionWar[];
  accords: readonly AccordSpan[];
  roundStarts: readonly RoundStart[];
  /** Oldest first. */
  awards: readonly AwardMark[];
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

export const EMPTY_HISTORY: MissionHistory = { wars: [], accords: [], roundStarts: [], awards: [] };

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

/** A real-world figure summed over some countries, counting unknown figures as zero. */
export function statOfSet(idx: DatasetIndex, ids: Iterable<TerritoryId>, key: StatKey): number {
  let sum = 0;
  for (const id of ids) sum += idx.byId.get(id)?.stats[key] ?? 0;
  return sum;
}

/** The round underway at a point in the campaign's history: 0 before round 1 (the draft). */
export function roundAt(history: MissionHistory, seq: number): number {
  let round = 0;
  for (const r of history.roundStarts) if (r.seq < seq && r.round > round) round = r.round;
  return round;
}

/** The round underway now: the last one to start, 0 before round 1. */
export const currentRound = (history: MissionHistory) => roundAt(history, Infinity);

/** Every player's victory points at a point in the campaign's history. */
export function pointsAt(world: MissionWorld, seq: number): Map<UserId, number> {
  const points = new Map(world.players.map((p) => [p, 0]));
  for (const a of world.history.awards) {
    if (a.seq < seq && points.has(a.userId)) points.set(a.userId, points.get(a.userId)! + a.points);
  }
  return points;
}

/**
 * Who led the race at a point in the campaign's history: the most victory points, then the most
 * valuable empire (several players when they're level). The map then is today's with the transfers
 * of every war that ended since undone.
 */
export function leadersAt(world: MissionWorld, seq: number): UserId[] {
  const owners = new Map(world.owners);
  const since = world.history.wars.filter((w) => w.seq > seq).sort((a, b) => b.seq - a.seq);
  for (const w of since) for (const t of [...w.transfers].reverse()) owners.set(t.territoryId, t.from);
  const points = pointsAt(world, seq);
  const value = new Map(world.players.map((p) => [p, 0]));
  for (const [id, owner] of owners) {
    if (value.has(owner)) value.set(owner, value.get(owner)! + (world.idx.byId.get(id)?.value ?? 0));
  }
  const rank = (p: UserId): [number, number] => [points.get(p)!, value.get(p)!];
  const ahead = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];
  let best: [number, number] | null = null;
  for (const p of world.players) if (!best || ahead(rank(p), best) > 0) best = rank(p);
  return world.players.filter((p) => best !== null && ahead(rank(p), best) === 0);
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
 * A chain from `a` to `b` through `set` that passes through at least one country of `through`
 * (both ends included, no country twice), or null. A country of `through` lies on such a chain
 * when it has two routes within `set`, one to each end, that share no other country: two units of
 * flow from it to the ends, each country carrying at most one. Candidates are tried nearest the
 * ends first, so the chain found is a short one.
 */
export function pathThrough(
  idx: DatasetIndex,
  set: ReadonlySet<TerritoryId>,
  a: TerritoryId,
  b: TerritoryId,
  through: ReadonlySet<TerritoryId>,
): TerritoryId[] | null {
  if (!set.has(a) || !set.has(b)) return null;
  if (through.has(a) || through.has(b)) return pathWithin(idx, set, a, b);
  const fromA = hopsWithin(idx, set, a);
  const fromB = hopsWithin(idx, set, b);
  const candidates = [...through]
    .filter((id) => set.has(id) && fromA.has(id) && fromB.has(id))
    .sort((x, y) => fromA.get(x)! + fromB.get(x)! - (fromA.get(y)! + fromB.get(y)!) || (x < y ? -1 : 1));
  for (const via of candidates) {
    const legs = disjointLegs(idx, set, via, a, b);
    if (legs) return [...legs[0].reverse(), ...legs[1].slice(1)];
  }
  return null;
}

/** Steps from `from` to every country reachable within `set`. */
function hopsWithin(idx: DatasetIndex, set: ReadonlySet<TerritoryId>, from: TerritoryId): Map<TerritoryId, number> {
  const dist = new Map<TerritoryId, number>([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const n of idx.neighbors(id)) {
      if (set.has(n) && !dist.has(n)) {
        dist.set(n, dist.get(id)! + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

/**
 * Two routes within `set` from `via`, one ending at `a` and one at `b`, sharing no country but
 * `via`: a unit-capacity flow on the countries split in two (in and out), found by augmenting
 * paths. Each route starts at `via`. Null if there aren't two.
 */
function disjointLegs(
  idx: DatasetIndex,
  set: ReadonlySet<TerritoryId>,
  via: TerritoryId,
  a: TerritoryId,
  b: TerritoryId,
): [TerritoryId[], TerritoryId[]] | null {
  const ids = [...set].sort();
  const index = new Map(ids.map((id, i) => [id, i]));
  // Node 2i is country i's way in, 2i + 1 its way out; the sink is the last node.
  const sink = 2 * ids.length;
  const to: number[] = [];
  const cap: number[] = [];
  const edges: number[][] = Array.from({ length: sink + 1 }, () => []);
  const link = (u: number, v: number) => {
    edges[u]!.push(to.length);
    to.push(v);
    cap.push(1);
    edges[v]!.push(to.length);
    to.push(u);
    cap.push(0);
  };
  const viaIndex = index.get(via)!;
  ids.forEach((id, i) => {
    if (i !== viaIndex) link(2 * i, 2 * i + 1);
    for (const n of idx.neighbors(id)) {
      const j = index.get(n);
      if (j !== undefined && j !== viaIndex) link(2 * i + 1, 2 * j);
    }
  });
  link(2 * index.get(a)! + 1, sink);
  link(2 * index.get(b)! + 1, sink);
  const source = 2 * viaIndex + 1;
  for (let found = 0; found < 2; found++) {
    const prevEdge = new Map<number, number>([[source, -1]]);
    const queue = [source];
    for (let i = 0; i < queue.length && !prevEdge.has(sink); i++) {
      for (const e of edges[queue[i]!]!) {
        if (cap[e]! > 0 && !prevEdge.has(to[e]!)) {
          prevEdge.set(to[e]!, e);
          queue.push(to[e]!);
        }
      }
    }
    if (!prevEdge.has(sink)) return null;
    for (let v = sink; v !== source;) {
      const e = prevEdge.get(v)!;
      cap[e] = cap[e]! - 1;
      cap[e ^ 1] = cap[e ^ 1]! + 1;
      v = to[e ^ 1]!;
    }
  }
  // Follow the flow out of `via`: each unit is one route, ending next to the sink at `a` or `b`.
  const legs: TerritoryId[][] = [];
  for (const first of edges[source]!) {
    if (first % 2 !== 0 || cap[first] !== 0) continue;
    const route = [via];
    let node = to[first]!;
    while (node !== sink) {
      if (node % 2 === 0) route.push(ids[node / 2]!);
      const next = edges[node]!.find((e) => e % 2 === 0 && cap[e] === 0);
      if (next === undefined) return null;
      cap[next] = -1;
      node = to[next]!;
    }
    legs.push(route);
  }
  if (legs.length !== 2) return null;
  const toA = legs.find((l) => l.at(-1) === a);
  const toB = legs.find((l) => l.at(-1) === b);
  return toA && toB ? [toA, toB] : null;
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
