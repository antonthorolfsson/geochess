import type { LonLat } from '@empire/rules';

export type BBox = [west: number, south: number, east: number, north: number];
/** A closed ring: the first and last positions are equal. */
export type Ring = LonLat[];
/** Exterior ring first, then holes. Exterior rings run clockwise, as d3-geo expects. */
export type PolygonCoords = Ring[];
export type MultiPolygonCoords = PolygonCoords[];

export const EARTH_RADIUS_KM = 6371.0088;

/** Unordered pair key with the ids sorted, e.g. "FRA|GBR". */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
