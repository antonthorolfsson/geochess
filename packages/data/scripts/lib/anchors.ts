import type { LonLat } from '@empire/rules';
import { geoAzimuthalEqualArea, geoCentroid } from 'd3-geo';
import polylabel from 'polylabel';
import { polygonAreaKm2 } from './geometry';
import { EARTH_RADIUS_KM, round, type MultiPolygonCoords } from './types';

/**
 * Pole of inaccessibility of the largest polygon. polylabel is planar, so the polygon is first
 * projected with an equal-area azimuthal projection centred on it (units: km); running it on raw
 * lon/lat would pull labels toward the poles in Canada, Russia or Greenland.
 */
export function anchorOf(coords: MultiPolygonCoords): LonLat {
  let largest = coords[0];
  let largestArea = -1;
  for (const polygon of coords) {
    const a = polygonAreaKm2(polygon);
    if (a > largestArea) {
      largest = polygon;
      largestArea = a;
    }
  }
  if (!largest) throw new Error('anchorOf: empty geometry');
  const [lon0, lat0] = geoCentroid({ type: 'Polygon', coordinates: largest });
  const projection = geoAzimuthalEqualArea().rotate([-lon0, -lat0]).scale(EARTH_RADIUS_KM).translate([0, 0]);
  const rings = largest.map((ring) => ring.map((p) => projection(p) as [number, number]));
  const precision = Math.max(0.1, Math.sqrt(largestArea) / 500);
  const label = polylabel(rings, precision);
  const lonLat = projection.invert?.([label[0], label[1]]);
  if (!lonLat) throw new Error('anchorOf: projection is not invertible');
  return [round(lonLat[0], 3), round(lonLat[1], 3)];
}
