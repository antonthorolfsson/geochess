import type { LonLat } from '@empire/rules';
import { geoArea, geoCentroid, geoNaturalEarth1 } from 'd3-geo';
import type { Polygon } from 'geojson';
import { feature, quantize } from 'topojson-client';
import { filter, presimplify, simplify } from 'topojson-simplify';
import type { GeometryCollection, Objects, Topology } from 'topojson-specification';
import { polygonsOf, ringAreaKm2, type TopoArea, type World } from './geometry';
import { round, type Ring } from './types';

export interface MapSettings {
  /** Visvalingam threshold: triangle area in px² on a 2400 px wide Natural Earth world map. */
  minWeightPx2: number;
  /** Islands at least this large (before simplification) always survive, with at least 4 corners. */
  keepIslandKm2: number;
  /** TopoJSON quantization (grid steps across the bounding box). */
  quantization: number;
}

export interface MapResult {
  topology: Topology;
  json: string;
  points: { before: number; after: number };
  /** `keptWhole`: rings that turned inside out when simplified and so keep all their points. */
  rings: { before: number; after: number; protected: number; keptWhole: number };
  windingFixes: string[];
}

const REFERENCE_WIDTH_PX = 2400;
const MIN_CORNERS = 4;

interface RingInfo {
  exterior: boolean;
  areaKm2: number;
  protect: boolean;
}

function ringCoords(topology: Topology, ring: number[]): Ring {
  const out: Ring = [];
  for (const a of ring) {
    const arc = topology.arcs[a < 0 ? ~a : a]!;
    const pts = a < 0 ? [...arc].reverse() : arc;
    pts.forEach((p, k) => {
      if (k > 0 || out.length === 0) out.push([p[0]!, p[1]!]);
    });
  }
  return out;
}

function countPoints(topology: Topology): number {
  return topology.arcs.reduce((n, arc) => n + arc.length, 0);
}

/** Promotes the most significant dropped vertices of a ring until it keeps enough corners. */
function ensureCorners(arcs: number[][][], ring: number[], minWeight: number): void {
  const kept = new Set<string>();
  const dropped: { arc: number[]; w: number; key: string }[] = [];
  for (const a of ring) {
    for (const p of arcs[a < 0 ? ~a : a]!) {
      const key = `${p[0]},${p[1]}`;
      if (p[2]! >= minWeight) kept.add(key);
      else dropped.push({ arc: p, w: p[2]!, key });
    }
  }
  dropped.sort((p, q) => q.w - p.w);
  for (const d of dropped) {
    if (kept.size >= MIN_CORNERS) break;
    if (kept.has(d.key)) continue;
    d.arc[2] = Infinity;
    kept.add(d.key);
  }
}

/**
 * Simplified, quantized TopoJSON for the web client. `representatives` holds, per territory, one
 * vertex of each source piece's largest polygon, so no member island group disappears entirely.
 */
export function buildMap(
  world: World,
  names: ReadonlyMap<string, string>,
  representatives: ReadonlyMap<string, LonLat[]>,
  settings: MapSettings,
): MapResult {
  const projection = geoNaturalEarth1().fitWidth(REFERENCE_WIDTH_PX, { type: 'Sphere' });
  const weight = (t: [[number, number], [number, number], [number, number]]): number => {
    const a = projection(t[0]);
    const b = projection(t[1]);
    const c = projection(t[2]);
    if (!a || !b || !c) return 0;
    return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  };
  const arcCount = world.topology.arcs.length;

  const arcOfVertex = new Map<string, number>();
  world.topology.arcs.forEach((arc, i) => {
    for (const p of arc) {
      const key = `${p[0]},${p[1]}`;
      if (!arcOfVertex.has(key)) arcOfVertex.set(key, i);
    }
  });
  const sharedArc = new Array<boolean>(arcCount).fill(false);
  const arcOwner = new Array<number>(arcCount).fill(-1);
  world.geometries.forEach((g, gi) => {
    for (const polygon of polygonsOf(g)) {
      for (const ring of polygon) {
        for (const a of ring) {
          const idx = a < 0 ? ~a : a;
          if (arcOwner[idx] !== -1 && arcOwner[idx] !== gi) sharedArc[idx] = true;
          arcOwner[idx] = gi;
        }
      }
    }
  });

  // Decide which rings must survive. Keyed by the ring arrays themselves: simplify and filter pass
  // the objects through untouched, so identity lets the filter below find them again.
  const info = new Map<number[], RingInfo>();
  world.geometries.forEach((g, gi) => {
    const id = world.ids[gi]!;
    const reps = new Set(
      (representatives.get(id) ?? []).map((p) => arcOfVertex.get(`${p[0]},${p[1]}`)).filter((a) => a !== undefined),
    );
    let largest: RingInfo | null = null;
    for (const polygon of polygonsOf(g)) {
      polygon.forEach((ring, ri) => {
        const areaKm2 = ringAreaKm2(ringCoords(world.topology, ring));
        const exterior = ri === 0;
        const representative = ring.some((a) => reps.has(a < 0 ? ~a : a));
        const r: RingInfo = {
          exterior,
          areaKm2,
          protect: exterior && (areaKm2 >= settings.keepIslandKm2 || representative),
        };
        info.set(ring, r);
        if (exterior && (!largest || areaKm2 > largest.areaKm2)) largest = r;
      });
    }
    if (largest) (largest as RingInfo).protect = true;
  });

  const minWeight = settings.minWeightPx2;
  const keeps = (ring: number[], r: RingInfo): boolean =>
    r.protect ||
    // Enclave holes and islands shared with another territory must stay in sync on both sides.
    ring.some((a) => sharedArc[a < 0 ? ~a : a]) ||
    (!r.exterior && r.areaKm2 >= settings.keepIslandKm2);
  const protectedRings = [...info].filter(([, r]) => r.protect).map(([ring]) => ring);

  // Thin slivers (barrier islands) can turn inside out when simplified. Such rings keep all their
  // points on the next attempt.
  const keepAll = new Set<number[]>();
  let simplified: Topology<Objects> | null = null;
  for (let attempt = 0; attempt < 4 && !simplified; attempt++) {
    const pre = presimplify(world.topology as Topology<Objects>, weight);
    const arcs = pre.arcs as number[][][];
    for (const ring of protectedRings) ensureCorners(arcs, ring, minWeight);
    for (const ring of keepAll) {
      for (const a of ring) for (const p of arcs[a < 0 ? ~a : a]!) p[2] = Infinity;
    }
    const candidate = simplify(pre, minWeight);
    const flipped = [...info]
      .filter(([ring, r]) => keeps(ring, r) && !keepAll.has(ring))
      .filter(([ring]) => {
        const small = (t: Topology) => geoArea({ type: 'Polygon', coordinates: [ringCoords(t, ring)] }) < 2 * Math.PI;
        return small(world.topology) !== small(candidate);
      });
    if (flipped.length === 0) simplified = candidate;
    for (const [ring] of flipped) keepAll.add(ring);
  }
  if (!simplified) throw new Error('Simplification kept turning rings inside out');

  const kept = filter(simplified, (ring, interior) => {
    const r = info.get(ring as unknown as number[]);
    if (!r || r.exterior === interior) throw new Error('Simplification lost track of a ring');
    return keeps(ring as unknown as number[], r);
  });
  const quantized = quantize(kept, settings.quantization);

  const collection = quantized.objects['territories'] as GeometryCollection;
  const windingFixes: string[] = [];
  const problems: string[] = [];
  let ringsAfter = 0;
  const geometries = collection.geometries.map((g, gi) => {
    const id = world.ids[gi]!;
    if (g.id !== id) problems.push(`geometry ${gi} has id ${String(g.id)}, expected ${id}`);
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') {
      problems.push(`${id}: geometry vanished during simplification`);
      return g;
    }
    const polygons = polygonsOf(g as TopoArea);
    const areaOf = (polygon: number[][]): number =>
      geoArea(feature(quantized, { type: 'Polygon', arcs: polygon }).geometry as Polygon);
    let area = 0;
    const fixed = polygons.map((polygon) => {
      // A polygon wound the wrong way covers the rest of the globe in d3-geo.
      if (areaOf(polygon) > 2 * Math.PI) {
        polygon = polygon.map((ring) => [...ring].reverse().map((a) => ~a));
        const f = feature(quantized, { type: 'Polygon', arcs: polygon }).geometry as Polygon;
        const [lon, lat] = geoCentroid(f);
        const km2 = (areaOf(polygon) * 6371 ** 2).toFixed(1);
        windingFixes.push(`${id} polygon near ${lon.toFixed(2)}, ${lat.toFixed(2)} (${km2} km²)`);
      }
      area += areaOf(polygon);
      return polygon;
    });
    ringsAfter += fixed.reduce((n, p) => n + p.length, 0);
    if (!(area > 0)) problems.push(`${id}: no area left after simplification`);
    if (area >= 2 * Math.PI) problems.push(`${id}: still covers more than a hemisphere (winding)`);
    const out =
      g.type === 'Polygon'
        ? { type: 'Polygon' as const, arcs: fixed[0]! }
        : { type: 'MultiPolygon' as const, arcs: fixed };
    return { ...out, id, properties: { name: names.get(id) ?? id } };
  });
  if (problems.length > 0) throw new Error(`Map geometry problems:\n  - ${problems.join('\n  - ')}`);

  const bbox = world.topology.bbox;
  const topology: Topology = {
    type: 'Topology',
    ...(bbox ? { bbox: bbox.map((v) => round(v, 6)) as typeof bbox } : {}),
    transform: quantized.transform,
    objects: { territories: { type: 'GeometryCollection', geometries } },
    arcs: quantized.arcs,
  };
  const ringsBefore = [...info.keys()].length;
  return {
    topology,
    json: JSON.stringify(topology),
    points: { before: countPoints(world.topology), after: countPoints(quantized) },
    rings: { before: ringsBefore, after: ringsAfter, protected: protectedRings.length, keptWhole: keepAll.size },
    windingFixes,
  };
}
