/** Small maps and worlds for the victory tests. Not exported from the package. */
import type { Continent, Dataset, Terrain, Territory, TerritoryId } from '../dataset';
import { indexDataset, type DatasetIndex } from '../graph';
import { makeTerritory } from '../test-fixtures';
import { EMPTY_HISTORY, type MissionHistory, type MissionWorld } from './world';

export interface Place {
  v: number;
  land?: string[];
  sea?: string[];
  c?: Continent;
  sub?: string;
  terrain?: Terrain[];
  micro?: boolean;
  /** Longitude and latitude of the label point. */
  at?: [number, number];
  /** Population, area in km² and nominal GDP, for the missions and tiebreaks that count them. */
  people?: number;
  area?: number;
  gdp?: number;
}

/** A dataset from a list of places; borders are made symmetric. */
export function buildMap(places: Record<string, Place>): DatasetIndex {
  const land = new Map<string, Set<string>>();
  const sea = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, a: string, b: string) => {
    if (!m.has(a)) m.set(a, new Set());
    m.get(a)!.add(b);
  };
  for (const [id, p] of Object.entries(places)) {
    for (const n of p.land ?? []) {
      add(land, id, n);
      add(land, n, id);
    }
    for (const n of p.sea ?? []) {
      add(sea, id, n);
      add(sea, n, id);
    }
  }
  const territories: Territory[] = Object.entries(places)
    .map(([id, p]) => {
      const t = makeTerritory(id, p.v, [...(land.get(id) ?? [])], [...(sea.get(id) ?? [])], p.people);
      return {
        ...t,
        continent: p.c ?? 'europe',
        subregion: p.sub ?? 'Test',
        terrain: p.terrain ?? [],
        micro: p.micro ?? false,
        anchor: p.at ?? [0, 0],
        stats: { ...t.stats, areaKm2: p.area ?? null, gdpNominalUsd: p.gdp ?? null },
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const seaLanes: Dataset['seaLanes'] = [];
  for (const [a, ns] of sea) {
    for (const b of ns) if (a < b) seaLanes.push({ a, b, from: [0, 0], to: [1, 1], km: 100, manual: false });
  }
  return indexDataset({
    version: 'victory-test',
    generatedAt: '2026-01-01T00:00:00.000Z',
    attribution: [],
    territories,
    seaLanes,
  });
}

/**
 * A world where `owners` hold what they hold now. The baseline defaults to the same holdings (the
 * draft just ended); `players` defaults to everyone named.
 */
export function makeWorld(
  idx: DatasetIndex,
  owners: Record<TerritoryId, string>,
  opts: { baseline?: Record<TerritoryId, string>; history?: Partial<MissionHistory>; players?: string[] } = {},
): MissionWorld {
  const baseline = new Map<string, Set<TerritoryId>>();
  for (const [id, owner] of Object.entries(opts.baseline ?? owners)) {
    if (!baseline.has(owner)) baseline.set(owner, new Set());
    baseline.get(owner)!.add(id);
  }
  const players = opts.players ?? [...new Set([...Object.values(owners), ...baseline.keys()])].sort();
  return {
    idx,
    players,
    owners: new Map(Object.entries(owners)),
    baseline,
    history: { ...EMPTY_HISTORY, ...opts.history },
  };
}

/** Every id in `ids` owned by `owner`. */
export const all = (owner: string, ...ids: string[]) => Object.fromEntries(ids.map((id) => [id, owner]));
