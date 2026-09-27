import { describe, expect, it } from 'vitest';
import { areAdjacent, indexDataset, reachableWithin, validateGraph } from './graph';
import { lineDataset, makeTerritory } from './test-fixtures';

describe('adjacency', () => {
  const idx = indexDataset(lineDataset());

  it('includes land borders and sea lanes', () => {
    expect(areAdjacent(idx, 'A', 'B')).toBe(true);
    expect(areAdjacent(idx, 'C', 'D')).toBe(true);
    expect(areAdjacent(idx, 'A', 'C')).toBe(false);
  });

  it('finds territories connected within an allowed set', () => {
    expect([...reachableWithin(idx, 'A', new Set(['A', 'B', 'D']))].sort()).toEqual(['A', 'B']);
    expect([...reachableWithin(idx, 'B', new Set(['A', 'B', 'C', 'D']))].sort()).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('validateGraph', () => {
  it('accepts a connected, symmetric map', () => {
    expect(validateGraph(lineDataset())).toEqual([]);
  });

  it('reports asymmetric edges, isolated and unreachable territories', () => {
    const ds = lineDataset();
    ds.territories[0] = makeTerritory('A', 9, ['B', 'F']);
    ds.territories.push(makeTerritory('G', 1));
    const problems = validateGraph(ds);
    expect(problems).toContain('A -> F: land edge is not symmetric');
    expect(problems).toContain('G: has no neighbors');
    expect(problems.some((p) => p.startsWith('Map is not connected') && p.endsWith('G'))).toBe(true);
  });

  it('reports a neighbor listed as both land and sea', () => {
    const ds = lineDataset();
    ds.territories[0] = makeTerritory('A', 9, ['B'], ['B']);
    ds.territories[1] = makeTerritory('B', 5, ['A', 'C'], ['A']);
    expect(validateGraph(ds)).toContain('A: both land and sea neighbor of B');
  });
});
