import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexDataset, type Dataset, type DatasetIndex } from '@empire/rules';

const cache = new Map<string, DatasetIndex>();

/** A dataset built by @empire/data, read the way the server reads it; the latest by default. */
export function loadDataset(version?: string): DatasetIndex {
  const resolve = (file: string) => fileURLToPath(import.meta.resolve(`@empire/data/datasets/${file}`));
  const index = JSON.parse(readFileSync(resolve('index.json'), 'utf8')) as { latest: string; versions: string[] };
  const v = version ?? index.latest;
  let idx = cache.get(v);
  if (!idx) {
    if (!index.versions.includes(v)) throw new Error(`Unknown dataset version: ${v}`);
    idx = indexDataset(JSON.parse(readFileSync(resolve(`${v}/territories.json`), 'utf8')) as Dataset);
    cache.set(v, idx);
  }
  return idx;
}
