import type { Dataset, TerritoryId } from '@empire/rules';
import { geoGraticule10, geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

/** Map width in viewBox units; the height follows from the projection. */
export const W = 1000;
const PAD = 4;

export type Bounds = [[number, number], [number, number]];

export interface Shape {
  id: TerritoryId;
  name: string;
  value: number;
  micro: boolean;
  d: string;
  bounds: Bounds;
  anchor: [number, number];
}

export function buildGeometry(topo: Topology, dataset: Dataset) {
  const object = topo.objects.territories as GeometryCollection<{ name: string }>;
  const projection = geoNaturalEarth1().fitWidth(W - 2 * PAD, { type: 'Sphere' });
  // Antarctica isn't played, so crop the map just south of Cape Horn.
  const north = projection([0, 84.5])![1];
  const south = projection([0, -57])![1];
  const [tx, ty] = projection.translate();
  projection.translate([tx + PAD, ty - north + PAD]);
  const H = Math.ceil(south - north + 2 * PAD);
  const path = geoPath(projection);

  const territories = new Map(dataset.territories.map((t) => [t.id, t]));
  const shapes: Shape[] = [];
  const features = new Map<TerritoryId, GeoPermissibleObjects>();
  for (const f of feature(topo, object).features) {
    const t = territories.get(String(f.id));
    if (!t) continue;
    features.set(t.id, f);
    shapes.push({
      id: t.id,
      name: t.name,
      value: t.value,
      micro: t.micro,
      d: path(f) ?? '',
      bounds: path.bounds(f),
      anchor: (projection(t.anchor) ?? path.centroid(f)) as [number, number],
    });
  }

  // The same projection cut to a box, for the part of a territory inside it.
  const clip = geoNaturalEarth1().scale(projection.scale()).translate(projection.translate());
  const clipPath = geoPath(clip);
  const mainlands = new Map<TerritoryId, GeoPermissibleObjects>();
  /** A territory's largest piece of land: mainland Russia, the lower 48 of the United States. */
  const mainland = (id: TerritoryId): GeoPermissibleObjects | undefined => {
    const f = features.get(id);
    if (!f || !('geometry' in f) || f.geometry?.type !== 'MultiPolygon') return f;
    let best = mainlands.get(id);
    if (!best) {
      let most = -1;
      for (const coordinates of f.geometry.coordinates) {
        const piece: GeoPermissibleObjects = { type: 'Polygon', coordinates };
        const area = path.area(piece);
        if (area > most) [best, most] = [piece, area];
      }
      mainlands.set(id, best!);
    }
    return best;
  };

  return {
    H,
    shapes,
    byId: new Map(shapes.map((s) => [s.id, s])),
    ocean: path({ type: 'Sphere' }) ?? '',
    graticule: path(geoGraticule10()) ?? '',
    borders: path(mesh(topo, object, (a, b) => a !== b)) ?? '',
    coast: path(mesh(topo, object, (a, b) => a === b)) ?? '',
    lanes: dataset.seaLanes.map((l) => ({
      a: l.a,
      b: l.b,
      d: path({ type: 'LineString', coordinates: [l.from, l.to] }) ?? '',
    })),
    /** The bounds of the part of a territory (or of its mainland) inside `box`; null if none of it is. */
    partWithin(id: TerritoryId, box: Bounds, mainlandOnly = false): Bounds | null {
      const shape = mainlandOnly ? mainland(id) : features.get(id);
      if (!shape) return null;
      clip.clipExtent(box);
      const bounds = clipPath.bounds(shape);
      return Number.isFinite(bounds[0][0]) ? bounds : null;
    },
  };
}

export type Geometry = ReturnType<typeof buildGeometry>;

export function union(boxes: Bounds[]): Bounds | null {
  if (boxes.length === 0) return null;
  let [[x0, y0], [x1, y1]] = boxes[0]!;
  for (const [[a0, b0], [a1, b1]] of boxes) {
    x0 = Math.min(x0, a0);
    y0 = Math.min(y0, b0);
    x1 = Math.max(x1, a1);
    y1 = Math.max(y1, b1);
  }
  return [
    [x0, y0],
    [x1, y1],
  ];
}

const area = ([[x0, y0], [x1, y1]]: Bounds) => (x1 - x0) * (y1 - y0);

/**
 * What to frame to show several territories at once, such as a mission's targets.
 *
 * A territory that sprawls far past the others is framed only where it comes near them: Russia
 * among the countries around the Baltic, or the United States (Alaska, Hawaii and the Aleutians
 * over the date line) beside Chile. Its whole box, most of the map's width for both, would show
 * the whole world. It sprawls when its box is wider than a quarter of the map and larger than the
 * others' put together, so Great Powers (the United States, China and Russia) still shows all
 * three.
 */
export function frameAround(geo: Geometry, ids: readonly TerritoryId[]): Bounds | null {
  const shapes = [...new Set(ids)].flatMap((id) => geo.byId.get(id) ?? []);
  const boxes = shapes.map((s) => s.bounds);
  const all = union(boxes);
  if (shapes.length < 2) return all;
  const sprawls = boxes.map(
    (box, i) => box[1][0] - box[0][0] > W / 4 && area(box) > area(union(boxes.filter((_, j) => j !== i))!),
  );
  const core = union(boxes.filter((_, i) => !sprawls[i]));
  if (!core) return all;

  // Within reach of the others: their frame grown by a quarter of its size, doubled as needed.
  const [[x0, y0], [x1, y1]] = core;
  const dx = Math.max((x1 - x0) / 4, 10);
  const dy = Math.max((y1 - y0) / 4, 10);
  const reach = (n: number): Bounds => [
    [x0 - dx * 2 ** n, y0 - dy * 2 ** n],
    [x1 + dx * 2 ** n, y1 + dy * 2 ** n],
  ];
  const parts: Bounds[] = [core];
  shapes.forEach(({ id }, i) => {
    if (!sprawls[i]) return;
    const near = geo.partWithin(id, reach(0));
    if (near) parts.push(near);
    // And its mainland, as far as the reach must stretch to meet it: beside Chile, the lower 48
    // rather than the islands of Hawaii, which lie nearer.
    for (let n = 0; n <= 12; n++) {
      const mainland = geo.partWithin(id, reach(n), true);
      if (mainland) {
        parts.push(mainland);
        break;
      }
    }
  });
  return union(parts);
}
