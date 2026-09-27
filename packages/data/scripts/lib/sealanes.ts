import type { LonLat } from '@empire/rules';
import { geoContains, geoDistance, geoInterpolate } from 'd3-geo';
import type { Adjacency, Coast } from './adjacency';
import type { PairSpec, SeaLaneConfig } from './config';
import { EARTH_RADIUS_KM, pairKey, round, type BBox, type MultiPolygonCoords, type PolygonCoords } from './types';

export interface LaneRecord {
  a: string;
  b: string;
  from: LonLat;
  to: LonLat;
  km: number;
  manual: boolean;
  /** Closer point pairs skipped because the segment crossed a third territory. */
  skipped: number;
  /** Territory whose land blocked the closest point pair, if any. */
  blockedBy: string | null;
  reason: string | null;
}

export interface SeaLaneResult {
  lanes: LaneRecord[];
  /** Pairs within the threshold whose every connecting segment crossed a third territory. */
  blocked: { a: string; b: string; km: number; blockedBy: string }[];
  removed: (PairSpec & { km: number })[];
  notes: string[];
}

/** How finely lane segments are sampled when checking whether they cross land. */
const SAMPLE_KM = 1;

// Points are compared as unit vectors: chord distance works across the antimeridian and near poles.
interface Vectors {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
}

function toVectors(coast: Coast): Vectors {
  const n = coast.lon.length;
  const v: Vectors = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const lon = (coast.lon[i]! * Math.PI) / 180;
    const lat = (coast.lat[i]! * Math.PI) / 180;
    v.x[i] = Math.cos(lat) * Math.cos(lon);
    v.y[i] = Math.cos(lat) * Math.sin(lon);
    v.z[i] = Math.sin(lat);
  }
  return v;
}

function chordToKm(chord2: number): number {
  return 2 * Math.asin(Math.min(1, Math.sqrt(chord2) / 2)) * EARTH_RADIUS_KM;
}

/** Polygons of every territory, bucketed by 1° cells, for point-in-land tests. */
class LandIndex {
  private readonly polygons: { owner: number; bbox: BBox; coords: PolygonCoords }[] = [];
  private readonly cells = new Map<number, number[]>();

  constructor(territories: readonly MultiPolygonCoords[]) {
    territories.forEach((mp, owner) => {
      for (const coords of mp) {
        const outer = coords[0] ?? [];
        let w = Infinity;
        let s = Infinity;
        let e = -Infinity;
        let n = -Infinity;
        for (const [lon, lat] of outer) {
          w = Math.min(w, lon);
          e = Math.max(e, lon);
          s = Math.min(s, lat);
          n = Math.max(n, lat);
        }
        const index = this.polygons.length;
        this.polygons.push({ owner, bbox: [w, s, e, n], coords });
        for (let x = Math.floor(w); x <= Math.floor(e); x++) {
          for (let y = Math.floor(s); y <= Math.floor(n); y++) {
            const key = LandIndex.key(x, y);
            const bucket = this.cells.get(key);
            if (bucket) bucket.push(index);
            else this.cells.set(key, [index]);
          }
        }
      }
    });
  }

  private static key(x: number, y: number): number {
    return (x + 180) * 1000 + (y + 90);
  }

  /** Owner of the land at `point`, ignoring territories in `except`; null over sea. */
  ownerAt(point: LonLat, except: ReadonlySet<number>): number | null {
    const [lon, lat] = point;
    for (const i of this.cells.get(LandIndex.key(Math.floor(lon), Math.floor(lat))) ?? []) {
      const p = this.polygons[i]!;
      if (except.has(p.owner)) continue;
      const [w, s, e, n] = p.bbox;
      if (lon < w || lon > e || lat < s || lat > n) continue;
      if (geoContains({ type: 'Polygon', coordinates: p.coords }, point)) return p.owner;
    }
    return null;
  }
}

function crossing(land: LandIndex, from: LonLat, to: LonLat, except: ReadonlySet<number>): number | null {
  const km = geoDistance(from, to) * EARTH_RADIUS_KM;
  const steps = Math.max(2, Math.ceil(km / SAMPLE_KM));
  const at = geoInterpolate(from, to);
  for (let s = 1; s < steps; s++) {
    const hit = land.ownerAt(at(s / steps), except);
    if (hit !== null) return hit;
  }
  return null;
}

function point(coast: Coast, i: number): LonLat {
  return [coast.lon[i]!, coast.lat[i]!];
}

function laneKm(from: LonLat, to: LonLat): number {
  return round(geoDistance(from, to) * EARTH_RADIUS_KM, 1);
}

interface Candidate {
  /** Point in the territory with the lower index (= lower id; ids are sorted). */
  pa: number;
  pb: number;
  d2: number;
}

/** Lanes between non-neighbors whose coastlines come within the threshold, avoiding third-party land. */
function autoLanes(
  ids: readonly string[],
  coast: Coast,
  vec: Vectors,
  land: Adjacency,
  landIndex: LandIndex,
  thresholdKm: number,
): { lanes: LaneRecord[]; blocked: SeaLaneResult['blocked'] } {
  const chordMax = 2 * Math.sin(thresholdKm / EARTH_RADIUS_KM / 2);
  const chordMax2 = chordMax * chordMax;
  const cell = chordMax;
  const offset = Math.ceil(1 / cell) + 2;
  const span = 2 * offset + 1;
  const cellKey = (ix: number, iy: number, iz: number): number =>
    ((ix + offset) * span + iy + offset) * span + iz + offset;
  const cellOf = (i: number): [number, number, number] => [
    Math.floor(vec.x[i]! / cell),
    Math.floor(vec.y[i]! / cell),
    Math.floor(vec.z[i]! / cell),
  ];

  const grid = new Map<number, number[]>();
  for (let i = 0; i < coast.lon.length; i++) {
    const key = cellKey(...cellOf(i));
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  const landNeighbor = ids.map((id) => new Set([...(land.get(id) ?? [])].map((n) => ids.indexOf(n))));
  const candidates = new Map<string, Candidate[]>();
  const nearest = new Map<number, { j: number; d2: number }>();
  for (let i = 0; i < coast.lon.length; i++) {
    const t = coast.owner[i]!;
    const [cx, cy, cz] = cellOf(i);
    nearest.clear();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(cellKey(cx + dx, cy + dy, cz + dz)) ?? []) {
            const u = coast.owner[j]!;
            if (u === t || landNeighbor[t]!.has(u)) continue;
            const ddx = vec.x[i]! - vec.x[j]!;
            const ddy = vec.y[i]! - vec.y[j]!;
            const ddz = vec.z[i]! - vec.z[j]!;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 > chordMax2) continue;
            const best = nearest.get(u);
            if (!best || d2 < best.d2) nearest.set(u, { j, d2 });
          }
        }
      }
    }
    // Each point contributes its nearest partner in every nearby territory: the closest pair plus
    // alternatives along the whole shared stretch of sea, used when the closest one crosses land.
    for (const [u, { j, d2 }] of nearest) {
      const key = pairKey(ids[t]!, ids[u]!);
      const c = t < u ? { pa: i, pb: j, d2 } : { pa: j, pb: i, d2 };
      const list = candidates.get(key);
      if (list) list.push(c);
      else candidates.set(key, [c]);
    }
  }

  const lanes: LaneRecord[] = [];
  const blocked: SeaLaneResult['blocked'] = [];
  for (const list of candidates.values()) {
    list.sort((p, q) => p.d2 - q.d2 || p.pa - q.pa || p.pb - q.pb);
    const first = list[0]!;
    const ta = coast.owner[first.pa]!;
    const tb = coast.owner[first.pb]!;
    const except = new Set([ta, tb]);
    let firstBlocker: number | null = null;
    let skipped = 0;
    let accepted: Candidate | null = null;
    const tried = new Set<string>();
    for (const c of list) {
      const key = `${c.pa}:${c.pb}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const hit = crossing(landIndex, point(coast, c.pa), point(coast, c.pb), except);
      if (hit === null) {
        accepted = c;
        break;
      }
      firstBlocker ??= hit;
      skipped++;
    }
    const a = ids[ta]!;
    const b = ids[tb]!;
    if (!accepted) {
      blocked.push({ a, b, km: round(chordToKm(first.d2), 1), blockedBy: ids[firstBlocker!]! });
      continue;
    }
    const from = point(coast, accepted.pa);
    const to = point(coast, accepted.pb);
    lanes.push({
      a,
      b,
      from,
      to,
      km: laneKm(from, to),
      manual: false,
      skipped,
      blockedBy: firstBlocker === null ? null : ids[firstBlocker]!,
      reason: null,
    });
  }
  return { lanes, blocked };
}

/** Coastline vertex of territory `t` nearest to `p`. */
function nearestVertex(coast: Coast, vec: Vectors, t: number, [lon, lat]: LonLat): number | null {
  const l = (lon * Math.PI) / 180;
  const f = (lat * Math.PI) / 180;
  const x = Math.cos(f) * Math.cos(l);
  const y = Math.cos(f) * Math.sin(l);
  const z = Math.sin(f);
  let best: number | null = null;
  let bestDot = -Infinity;
  for (const i of coast.byOwner[t] ?? []) {
    const dot = x * vec.x[i]! + y * vec.y[i]! + z * vec.z[i]!;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

/** Closest pair of coastline points between two territories, with no threshold or crossing check. */
function closestPair(coast: Coast, vec: Vectors, ta: number, tb: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bestDot = -Infinity;
  for (const i of coast.byOwner[ta] ?? []) {
    const xi = vec.x[i]!;
    const yi = vec.y[i]!;
    const zi = vec.z[i]!;
    for (const j of coast.byOwner[tb] ?? []) {
      const dot = xi * vec.x[j]! + yi * vec.y[j]! + zi * vec.z[j]!;
      if (dot > bestDot) {
        bestDot = dot;
        best = [i, j];
      }
    }
  }
  return best;
}

/**
 * Endpoints for a manual lane: the closest coastline pair, unless hints pin one or both ends, in
 * which case each hinted end snaps to its territory's nearest coastline vertex and an unhinted end
 * takes the vertex nearest to the other end.
 */
function hintedPair(
  coast: Coast,
  vec: Vectors,
  ta: number,
  tb: number,
  nearA: LonLat | undefined,
  nearB: LonLat | undefined,
): [number, number] | null {
  if (!nearA && !nearB) return closestPair(coast, vec, ta, tb);
  const i = nearA ? nearestVertex(coast, vec, ta, nearA) : null;
  const j = nearB ? nearestVertex(coast, vec, tb, nearB) : null;
  const a = i ?? (j === null ? null : nearestVertex(coast, vec, ta, point(coast, j)));
  const b = j ?? (a === null ? null : nearestVertex(coast, vec, tb, point(coast, a)));
  return a === null || b === null ? null : [a, b];
}

export function seaLanes(
  ids: readonly string[],
  territories: readonly MultiPolygonCoords[],
  coast: Coast,
  land: Adjacency,
  config: SeaLaneConfig,
): SeaLaneResult {
  const vec = toVectors(coast);
  const landIndex = new LandIndex(territories);
  const auto = autoLanes(ids, coast, vec, land, landIndex, config.thresholdKm);
  const notes: string[] = [];
  const byKey = new Map(auto.lanes.map((l) => [pairKey(l.a, l.b), l]));
  const index = new Map(ids.map((id, i) => [id, i]));
  const check = (id: string, where: string): number => {
    const i = index.get(id);
    if (i === undefined) throw new Error(`sea-lanes.yaml ${where}: unknown territory ${id}`);
    return i;
  };

  const removed: SeaLaneResult['removed'] = [];
  for (const r of config.remove) {
    check(r.a, 'remove');
    check(r.b, 'remove');
    const key = pairKey(r.a, r.b);
    const lane = byKey.get(key);
    if (!lane) {
      notes.push(`remove ${r.a}–${r.b} matched no automatic lane (stale entry?)`);
      continue;
    }
    byKey.delete(key);
    removed.push({ ...r, km: lane.km });
  }

  for (const add of config.add) {
    const ia = check(add.a, 'add');
    const ib = check(add.b, 'add');
    if (land.get(add.a)?.has(add.b)) {
      throw new Error(`sea-lanes.yaml add: ${add.a}–${add.b} already share a land border`);
    }
    const key = pairKey(add.a, add.b);
    if (byKey.has(key)) {
      notes.push(
        add.near.size > 0
          ? `add ${add.a}–${add.b} redraws an automatic lane by hand`
          : `add ${add.a}–${add.b} is also found automatically; kept as manual`,
      );
    }
    const [ta, tb] = ia < ib ? [ia, ib] : [ib, ia];
    const pair = hintedPair(coast, vec, ta, tb, add.near.get(ids[ta]!), add.near.get(ids[tb]!));
    if (!pair) throw new Error(`sea-lanes.yaml add: ${add.a}–${add.b}: a territory has no coastline`);
    const from = point(coast, pair[0]);
    const to = point(coast, pair[1]);
    byKey.set(key, {
      a: ids[ta]!,
      b: ids[tb]!,
      from,
      to,
      km: laneKm(from, to),
      manual: true,
      skipped: 0,
      blockedBy: null,
      reason: add.reason,
    });
  }

  const lanes = [...byKey.values()]
    .map((l) => ({ ...l, from: roundPoint(l.from), to: roundPoint(l.to) }))
    .sort((p, q) => (p.a === q.a ? (p.b < q.b ? -1 : 1) : p.a < q.a ? -1 : 1));
  auto.blocked.sort((p, q) => (p.a === q.a ? (p.b < q.b ? -1 : 1) : p.a < q.a ? -1 : 1));
  return { lanes, blocked: auto.blocked, removed, notes };
}

function roundPoint([lon, lat]: LonLat): LonLat {
  return [round(lon, 4), round(lat, 4)];
}
