import { geoArea } from 'd3-geo';
import type { FeatureCollection, MultiPolygon } from 'geojson';
import { merge } from 'topojson-client';
import { topology } from 'topojson-server';
import type {
  GeometryCollection,
  MultiPolygon as TopoMultiPolygon,
  Polygon as TopoPolygon,
  Topology,
} from 'topojson-specification';
import type { Piece } from './canon';
import { EARTH_RADIUS_KM, type MultiPolygonCoords, type PolygonCoords, type Ring } from './types';

export type TopoArea = TopoPolygon | TopoMultiPolygon;

export function polygonAreaKm2(polygon: PolygonCoords): number {
  return geoArea({ type: 'Polygon', coordinates: polygon }) * EARTH_RADIUS_KM ** 2;
}

export function multiPolygonAreaKm2(coords: MultiPolygonCoords): number {
  return coords.reduce((sum, p) => sum + polygonAreaKm2(p), 0);
}

/** Unsigned spherical area of a single ring, independent of its winding. */
export function ringAreaKm2(ring: Ring): number {
  const a = geoArea({ type: 'Polygon', coordinates: [ring] });
  return Math.min(a, 4 * Math.PI - a) * EARTH_RADIUS_KM ** 2;
}

/**
 * Dissolves each territory's pieces into one MultiPolygon. The pieces go through a shared topology
 * first so that borders between pieces of the same territory (Somalia/Somaliland, Italy/San Marino)
 * disappear instead of being drawn as coastline.
 */
export function dissolve(pieces: readonly Piece[]): Map<string, MultiPolygonCoords> {
  const fc: FeatureCollection<MultiPolygon> = {
    type: 'FeatureCollection',
    features: pieces.map((p) => ({
      type: 'Feature',
      id: p.key,
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: p.polygons },
    })),
  };
  // No quantization: the NE borders match exactly, and any snapping here would move coastlines.
  const topo = topology({ pieces: fc });
  const collection = topo.objects['pieces'] as GeometryCollection;
  const byTerritory = new Map<string, TopoArea[]>();
  collection.geometries.forEach((g, i) => {
    const piece = pieces[i];
    if (!piece || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) {
      throw new Error(`Unexpected geometry for piece ${piece?.key ?? i}`);
    }
    byTerritory.set(piece.territoryId, [...(byTerritory.get(piece.territoryId) ?? []), g]);
  });

  const out = new Map<string, MultiPolygonCoords>();
  for (const [id, geoms] of byTerritory) {
    const merged = merge(topo, geoms).coordinates as MultiPolygonCoords;
    const before = pieces
      .filter((p) => p.territoryId === id)
      .reduce((sum, p) => sum + multiPolygonAreaKm2(p.polygons), 0);
    const after = multiPolygonAreaKm2(merged);
    if (Math.abs(after - before) > Math.max(1, before * 1e-4)) {
      throw new Error(`Dissolving ${id} changed its area from ${before.toFixed(1)} to ${after.toFixed(1)} km²`);
    }
    out.set(id, merged);
  }
  return out;
}

export interface WorldTerritory {
  id: string;
  name: string;
  coords: MultiPolygonCoords;
}

/** The unsimplified world topology: one geometry per territory, sorted by id. */
export interface World {
  topology: Topology;
  ids: string[];
  geometries: TopoArea[];
}

export function buildWorld(territories: readonly WorldTerritory[]): World {
  const sorted = [...territories].sort((a, b) => (a.id < b.id ? -1 : 1));
  const fc: FeatureCollection<MultiPolygon> = {
    type: 'FeatureCollection',
    features: sorted.map((t) => ({
      type: 'Feature',
      id: t.id,
      properties: { name: t.name },
      geometry: { type: 'MultiPolygon', coordinates: t.coords },
    })),
  };
  const topo = topology({ territories: fc });
  const collection = topo.objects['territories'] as GeometryCollection;
  const geometries = collection.geometries.map((g, i) => {
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') throw new Error(`Territory ${sorted[i]?.id} has no area`);
    return g;
  });
  return { topology: topo, ids: sorted.map((t) => t.id), geometries };
}

/** Rings of a topology geometry as arc-index lists, polygon by polygon. */
export function polygonsOf(g: TopoArea): number[][][] {
  return g.type === 'Polygon' ? [g.arcs] : g.arcs;
}
