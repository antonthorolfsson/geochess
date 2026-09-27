import type { Dataset, Territory, TerritoryId } from './dataset';

/** Fast lookups over a dataset. Build once per dataset version and reuse. */
export interface DatasetIndex {
  readonly dataset: Dataset;
  readonly ids: readonly TerritoryId[];
  readonly byId: ReadonlyMap<TerritoryId, Territory>;
  /** Land and sea-lane neighbors. */
  neighbors(id: TerritoryId): readonly TerritoryId[];
}

export function indexDataset(dataset: Dataset): DatasetIndex {
  const byId = new Map(dataset.territories.map((t) => [t.id, t]));
  const adjacency = new Map(dataset.territories.map((t) => [t.id, [...t.land, ...t.sea]]));
  return {
    dataset,
    ids: dataset.territories.map((t) => t.id),
    byId,
    neighbors: (id) => adjacency.get(id) ?? [],
  };
}

export function getTerritory(idx: DatasetIndex, id: TerritoryId): Territory {
  const t = idx.byId.get(id);
  if (!t) throw new Error(`Unknown territory: ${id}`);
  return t;
}

export function areAdjacent(idx: DatasetIndex, a: TerritoryId, b: TerritoryId): boolean {
  return idx.neighbors(a).includes(b);
}

/** True if `id` borders (by land or sea lane) any territory in `set`. */
export function bordersAny(idx: DatasetIndex, id: TerritoryId, set: ReadonlySet<TerritoryId>): boolean {
  return idx.neighbors(id).some((n) => set.has(n));
}

/** Territories reachable from `start` while staying inside `allowed` (which should contain `start`). */
export function reachableWithin(
  idx: DatasetIndex,
  start: TerritoryId,
  allowed: ReadonlySet<TerritoryId>,
): Set<TerritoryId> {
  const seen = new Set<TerritoryId>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const n of idx.neighbors(id)) {
      if (allowed.has(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

/**
 * Structural problems with a dataset's adjacency graph. An empty list means the graph is valid:
 * every edge points at a known territory, edges are symmetric, land and sea lists are disjoint,
 * every territory has a neighbor, and the whole map is connected.
 */
export function validateGraph(dataset: Dataset): string[] {
  const problems: string[] = [];
  const idx = indexDataset(dataset);
  if (idx.byId.size !== dataset.territories.length) problems.push('Duplicate territory ids');

  for (const t of dataset.territories) {
    for (const [kind, list] of [
      ['land', t.land],
      ['sea', t.sea],
    ] as const) {
      for (const n of list) {
        const other = idx.byId.get(n);
        if (!other) problems.push(`${t.id}: unknown ${kind} neighbor ${n}`);
        else if (!other[kind].includes(t.id)) problems.push(`${t.id} -> ${n}: ${kind} edge is not symmetric`);
        if (n === t.id) problems.push(`${t.id}: borders itself`);
      }
    }
    const overlap = t.land.filter((n) => t.sea.includes(n));
    if (overlap.length > 0) problems.push(`${t.id}: both land and sea neighbor of ${overlap.join(', ')}`);
    if (t.land.length + t.sea.length === 0) problems.push(`${t.id}: has no neighbors`);
  }

  const first = idx.ids[0];
  if (first !== undefined) {
    const reached = reachableWithin(idx, first, new Set(idx.ids));
    if (reached.size !== idx.ids.length) {
      const missing = idx.ids.filter((id) => !reached.has(id));
      problems.push(`Map is not connected; unreachable from ${first}: ${missing.join(', ')}`);
    }
  }
  return problems;
}
