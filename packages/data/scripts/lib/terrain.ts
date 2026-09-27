import type { Terrain } from '@empire/rules';
import type { Adjacency } from './adjacency';
import type { CanonConfig, TerrainConfig } from './config';

function checkIds(ids: ReadonlySet<string>, list: readonly string[], where: string): Set<string> {
  for (const id of list) if (!ids.has(id)) throw new Error(`${where}: unknown territory ${id}`);
  return new Set(list);
}

export interface TerrainResult {
  terrain: Map<string, Terrain[]>;
  autoIslands: string[];
  notes: string[];
}

/** Islands: no land neighbors (automatic), adjusted by include/exclude. Mountains: hand-picked. */
export function computeTerrain(ids: readonly string[], land: Adjacency, cfg: TerrainConfig): TerrainResult {
  const known = new Set(ids);
  const include = checkIds(known, cfg.islandInclude, 'terrain.yaml island.include');
  const exclude = checkIds(known, cfg.islandExclude, 'terrain.yaml island.exclude');
  const mountains = checkIds(known, cfg.mountains, 'terrain.yaml mountains');
  const notes: string[] = [];
  const autoIslands = ids.filter((id) => (land.get(id)?.size ?? 0) === 0);
  for (const id of include) {
    if (autoIslands.includes(id)) notes.push(`terrain.yaml island.include ${id} is redundant (no land neighbors)`);
    if (exclude.has(id)) throw new Error(`terrain.yaml: ${id} is both included and excluded as an island`);
  }
  for (const id of exclude) {
    if (!autoIslands.includes(id)) notes.push(`terrain.yaml island.exclude ${id} is redundant (has land neighbors)`);
  }
  const terrain = new Map<string, Terrain[]>();
  for (const id of ids) {
    const t: Terrain[] = [];
    if ((autoIslands.includes(id) || include.has(id)) && !exclude.has(id)) t.push('island');
    if (mountains.has(id)) t.push('mountains');
    terrain.set(id, t);
  }
  return { terrain, autoIslands, notes };
}

/** Regions always get a dot; other territories below the area threshold do too. */
export function computeMicro(
  items: readonly { id: string; kind: string; areaKm2: number }[],
  cfg: CanonConfig['micro'],
): Map<string, boolean> {
  const known = new Set(items.map((t) => t.id));
  const include = checkIds(known, cfg.include, 'canon.yaml micro.include');
  const exclude = checkIds(known, cfg.exclude, 'canon.yaml micro.exclude');
  return new Map(
    items.map((t) => [
      t.id,
      (t.kind === 'region' || t.areaKm2 < cfg.areaKm2 || include.has(t.id)) && !exclude.has(t.id),
    ]),
  );
}
