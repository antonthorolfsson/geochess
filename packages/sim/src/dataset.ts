import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexDataset, type Dataset, type DatasetIndex } from '@empire/rules';
import { applyValueCurve } from './value-curves';

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

/** The dataset a campaign plays: the latest, with its value curve if it has one. */
export function datasetFor(values: string | null): DatasetIndex {
  if (values === null) return loadDataset();
  const key = `latest:${values}`;
  let idx = cache.get(key);
  if (!idx) {
    idx = applyValueCurve(loadDataset(), values);
    cache.set(key, idx);
  }
  return idx;
}
