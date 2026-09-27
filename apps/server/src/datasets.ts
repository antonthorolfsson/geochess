import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexDataset, type Dataset, type DatasetIndex } from '@empire/rules';

/** Versioned country datasets. Campaigns keep the version they started with. */
export interface DatasetProvider {
  latestVersion(): string;
  get(version: string): DatasetIndex;
}

/** Reads datasets built by @empire/data from disk, caching each version once loaded. */
export function fileDatasetProvider(): DatasetProvider {
  const resolve = (file: string) => fileURLToPath(import.meta.resolve(`@empire/data/datasets/${file}`));
  const index = JSON.parse(readFileSync(resolve('index.json'), 'utf8')) as { latest: string; versions: string[] };
  const cache = new Map<string, DatasetIndex>();
  return {
    latestVersion: () => index.latest,
    get(version) {
      let idx = cache.get(version);
      if (!idx) {
        if (!index.versions.includes(version)) throw new Error(`Unknown dataset version: ${version}`);
        idx = indexDataset(JSON.parse(readFileSync(resolve(`${version}/territories.json`), 'utf8')) as Dataset);
        cache.set(version, idx);
      }
      return idx;
    },
  };
}

export function staticDatasetProvider(datasets: Dataset[]): DatasetProvider {
  const byVersion = new Map(datasets.map((d) => [d.version, indexDataset(d)]));
  const latest = datasets.at(-1);
  if (!latest) throw new Error('No datasets');
  return {
    latestVersion: () => latest.version,
    get(version) {
      const idx = byVersion.get(version);
      if (!idx) throw new Error(`Unknown dataset version: ${version}`);
      return idx;
    },
  };
}
