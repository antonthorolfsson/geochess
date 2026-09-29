import { describe, expect, it } from 'vitest';
import { seededRandom } from './generate';
import { buildMap, type Place } from './test-maps';
import { pathThrough } from './world';

/** Every simple path from `a` to `b` within `set`, by brute force. */
function simplePaths(
  neighbors: (id: string) => readonly string[],
  set: ReadonlySet<string>,
  a: string,
  b: string,
): string[][] {
  const out: string[][] = [];
  const walk = (path: string[]) => {
    const at = path.at(-1)!;
    if (at === b) {
      out.push(path);
      return;
    }
    for (const n of neighbors(at)) if (set.has(n) && !path.includes(n)) walk([...path, n]);
  };
  if (set.has(a) && set.has(b)) walk([a]);
  return out;
}

describe('a chain through a conquest', () => {
  it('is found exactly when some unbroken chain passes through one, and is a real chain', () => {
    const random = seededRandom(20260929);
    let found = 0;
    for (let trial = 0; trial < 400; trial++) {
      // Nine countries with random borders.
      const ids = Array.from({ length: 9 }, (_, i) => `N${i}`);
      const places: Record<string, Place> = {};
      for (const id of ids) places[id] = { v: 1, land: [] };
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) if (random() < 0.3) places[ids[i]!]!.land!.push(ids[j]!);
      }
      const idx = buildMap(places);
      const set = new Set(ids.filter(() => random() < 0.8));
      const through = new Set(ids.filter(() => random() < 0.25));
      const [a, b] = [ids[0]!, ids[8]!];
      const expected = simplePaths((id) => idx.neighbors(id), set, a, b).some((p) => p.some((id) => through.has(id)));
      const chain = pathThrough(idx, set, a, b, through);
      expect(chain !== null, `trial ${trial}`).toBe(expected);
      if (!chain) continue;
      found++;
      expect(chain[0]).toBe(a);
      expect(chain.at(-1)).toBe(b);
      expect(new Set(chain).size).toBe(chain.length);
      expect(chain.every((id) => set.has(id))).toBe(true);
      expect(chain.some((id) => through.has(id))).toBe(true);
      for (let i = 1; i < chain.length; i++) expect(idx.neighbors(chain[i - 1]!)).toContain(chain[i]);
    }
    expect(found).toBeGreaterThan(40);
  });
});
