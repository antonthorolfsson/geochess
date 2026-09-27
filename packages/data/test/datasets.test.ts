import { STAT_KEYS, validateGraph, type Dataset } from '@empire/rules';
import { geoArea } from 'd3-geo';
import type { Geometry } from 'geojson';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import { EXPECTED_LAND_BORDERS, EXPECTED_SEA_LANES } from '../scripts/lib/expectations';

const DATASETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'datasets');
const readJson = <T>(...parts: string[]): T => JSON.parse(readFileSync(path.join(DATASETS, ...parts), 'utf8')) as T;

const index = readJson<{ latest: string; versions: string[] }>('index.json');
const dataset = readJson<Dataset>(index.latest, 'territories.json');
const map = readJson<Topology>(index.latest, 'map.topo.json');
const byId = new Map(dataset.territories.map((t) => [t.id, t]));
const sorted = (list: readonly string[]) => [...list].sort();

describe(`dataset ${index.latest} (latest)`, () => {
  it('is listed in the index and knows its version', () => {
    expect(index.versions).toContain(index.latest);
    expect(dataset.version).toBe(index.latest);
    expect(dataset.attribution.some((a) => a.includes('Natural Earth'))).toBe(true);
    expect(dataset.attribution.some((a) => a.includes('World Bank') && a.includes('CC BY 4.0'))).toBe(true);
  });

  it('has a valid adjacency graph', () => {
    expect(validateGraph(dataset)).toEqual([]);
  });

  it('uses well-formed, sorted ids', () => {
    for (const t of dataset.territories) expect(t.id).toMatch(/^[A-Z][A-Z0-9-]{1,19}$/);
    const ids = dataset.territories.map((t) => t.id);
    expect(ids).toEqual(sorted(ids));
    for (const t of dataset.territories) {
      expect(t.land).toEqual(sorted(t.land));
      expect(t.sea).toEqual(sorted(t.sea));
    }
  });

  it('gives every territory an integer value from 1 to 10', () => {
    for (const t of dataset.territories) {
      expect(Number.isInteger(t.value), t.id).toBe(true);
      expect(t.value, t.id).toBeGreaterThanOrEqual(1);
      expect(t.value, t.id).toBeLessThanOrEqual(10);
    }
  });

  it('has statistics metadata for every figure', () => {
    for (const t of dataset.territories) {
      for (const key of STAT_KEYS) {
        expect(t.statMeta[key], `${t.id} ${key}`).toBeDefined();
        expect(t.statMeta[key].source.length, `${t.id} ${key}`).toBeGreaterThan(0);
      }
      expect(t.stats.population, t.id).not.toBeNull();
      expect(t.stats.areaKm2, t.id).not.toBeNull();
    }
  });

  it('has exactly one map geometry per territory', () => {
    const geometries = (map.objects['territories'] as GeometryCollection).geometries;
    expect(Object.keys(map.objects)).toEqual(['territories']);
    expect(geometries.map((g) => g.id)).toEqual(dataset.territories.map((t) => t.id));
    for (const g of geometries) {
      expect((g.properties as { name?: string } | undefined)?.name).toBe(byId.get(String(g.id))?.name);
    }
  });

  it('has map geometries with area, wound the way d3-geo expects', () => {
    const collection = feature(map, map.objects['territories'] as GeometryCollection);
    for (const f of collection.features) {
      const area = geoArea(f as GeoJSON.Feature<Geometry>);
      expect(area, String(f.id)).toBeGreaterThan(0);
      expect(area, String(f.id)).toBeLessThan(2 * Math.PI);
    }
  });

  it('keeps sea lanes and sea lists in sync', () => {
    const lanes = new Set<string>();
    for (const l of dataset.seaLanes) {
      expect(l.a < l.b, `${l.a}–${l.b} ordered`).toBe(true);
      expect(byId.get(l.a)?.sea, `${l.a} lists ${l.b}`).toContain(l.b);
      expect(byId.get(l.b)?.sea, `${l.b} lists ${l.a}`).toContain(l.a);
      expect(l.km).toBeGreaterThanOrEqual(0);
      lanes.add(`${l.a}|${l.b}`);
    }
    const pairs = dataset.seaLanes.map((l) => [l.a, l.b]);
    const byPair = (p: string[], q: string[]) => (p[0] === q[0] ? (p[1]! < q[1]! ? -1 : 1) : p[0]! < q[0]! ? -1 : 1);
    expect(pairs).toEqual([...pairs].sort(byPair));
    for (const t of dataset.territories) {
      for (const n of t.sea) {
        expect(lanes.has(t.id < n ? `${t.id}|${n}` : `${n}|${t.id}`), `${t.id}–${n} lane`).toBe(true);
      }
    }
  });

  it.each(EXPECTED_LAND_BORDERS)('has the land border %s–%s', (a, b) => {
    expect(byId.get(a)?.land).toContain(b);
  });

  it.each(EXPECTED_SEA_LANES)('has the sea lane %s–%s', (a, b) => {
    expect(byId.get(a)?.sea).toContain(b);
  });
});
