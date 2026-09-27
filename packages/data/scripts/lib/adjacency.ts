import { neighbors } from 'topojson-client';
import type { PairSpec } from './config';
import { polygonsOf, type World } from './geometry';
import { pairKey } from './types';

export type Adjacency = Map<string, Set<string>>;

export interface LandResult {
  adjacency: Adjacency;
  notes: string[];
}

/** Land borders: territories whose geometries share at least one arc, plus canon overrides. */
export function landBorders(world: World, overrides: { add: PairSpec[]; remove: PairSpec[] }): LandResult {
  const adjacency: Adjacency = new Map(world.ids.map((id) => [id, new Set<string>()]));
  const detected = new Set<string>();
  neighbors(world.geometries).forEach((list, i) => {
    const a = world.ids[i]!;
    for (const j of list) {
      const b = world.ids[j]!;
      adjacency.get(a)!.add(b);
      detected.add(pairKey(a, b));
    }
  });

  const notes: string[] = [];
  const known = (id: string, where: string): boolean => {
    if (adjacency.has(id)) return true;
    throw new Error(`canon.yaml land_borders.${where}: unknown territory ${id}`);
  };
  for (const { a, b, reason } of overrides.add) {
    known(a, 'add');
    known(b, 'add');
    if (detected.has(pairKey(a, b))) notes.push(`land_borders.add ${a}–${b} is redundant: already a land border`);
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
    notes.push(`Added land border ${a}–${b}: ${reason}`);
  }
  for (const { a, b, reason } of overrides.remove) {
    known(a, 'remove');
    known(b, 'remove');
    if (!detected.has(pairKey(a, b))) notes.push(`land_borders.remove ${a}–${b} matched nothing`);
    adjacency.get(a)!.delete(b);
    adjacency.get(b)!.delete(a);
    notes.push(`Removed land border ${a}–${b}: ${reason}`);
  }
  return { adjacency, notes };
}

/** Coastline vertices: points of arcs used by exactly one ring in the whole map. */
export interface Coast {
  lon: number[];
  lat: number[];
  /** Index into `world.ids`. */
  owner: number[];
  /** Point indexes per territory index. */
  byOwner: number[][];
}

export function coastline(world: World): Coast {
  const arcs = world.topology.arcs;
  const uses = new Array<number>(arcs.length).fill(0);
  const ownerOf = new Array<number>(arcs.length).fill(-1);
  world.geometries.forEach((g, gi) => {
    for (const polygon of polygonsOf(g)) {
      for (const ring of polygon) {
        for (const a of ring) {
          const idx = a < 0 ? ~a : a;
          uses[idx] = (uses[idx] ?? 0) + 1;
          ownerOf[idx] = gi;
        }
      }
    }
  });

  const coast: Coast = { lon: [], lat: [], owner: [], byOwner: world.ids.map(() => []) };
  const seen = world.ids.map(() => new Set<string>());
  arcs.forEach((arc, idx) => {
    if (uses[idx] !== 1) return;
    const owner = ownerOf[idx]!;
    for (const p of arc) {
      const lon = p[0]!;
      const lat = p[1]!;
      // Natural Earth cuts polygons at the antimeridian; those cut edges are not real coastline.
      if (Math.abs(lon) === 180) continue;
      const key = `${lon},${lat}`;
      if (seen[owner]!.has(key)) continue;
      seen[owner]!.add(key);
      coast.byOwner[owner]!.push(coast.lon.length);
      coast.lon.push(lon);
      coast.lat.push(lat);
      coast.owner.push(owner);
    }
  });
  return coast;
}
