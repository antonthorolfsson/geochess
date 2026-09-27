import { indexDataset, type Dataset } from '@empire/rules';
import { lineDataset, makeTerritory } from '@empire/rules/testing';
import { describe, expect, it } from 'vitest';
import { empireFigures, formatShare, totalOf, valueRank } from './empire';

/** A9 - B5 - C3 ~ D7 - E2 - F1, with populations of 50, 30, 20, 10, 5 and 1 million. */
const POPULATION: Record<string, number> = { A: 50e6, B: 30e6, C: 20e6, D: 10e6, E: 5e6, F: 1e6 };
const base = lineDataset();
const dataset: Dataset = {
  ...base,
  territories: base.territories.map((t) => ({
    ...makeTerritory(t.id, t.value, t.land, t.sea, POPULATION[t.id]),
    statMeta: { ...t.statMeta, population: { year: 2025, estimated: t.id === 'E', source: 'test' } },
  })),
};
const idx = indexDataset(dataset);
const holdings = new Map([
  ['ann', ['C', 'E']],
  ['bo', ['A']],
  ['cy', []],
]);

describe('empire figures', () => {
  it('total a figure, with its share of the world', () => {
    const { population } = empireFigures(idx, holdings, 'ann');
    expect(population.total).toBe(25e6);
    expect(population.share).toBeCloseTo(25 / 116);
    expect(population.estimated).toBe(1);
    expect(population.missing).toBe(0);
  });

  it('rank the empire among the world’s countries, naming its neighbours but not its own countries', () => {
    const { population } = empireFigures(idx, holdings, 'ann');
    expect(population.worldRank).toBe(3);
    expect(population.above?.id).toBe('B');
    // C (20 million) is part of the empire, so the next country down is D.
    expect(population.below?.id).toBe('D');
    const bo = empireFigures(idx, holdings, 'bo').population;
    expect([bo.worldRank, bo.above, bo.below?.id]).toEqual([1, null, 'B']);
  });

  it('rank the empire among the campaign’s empires', () => {
    expect(empireFigures(idx, holdings, 'ann').population.empireRank).toBe(2);
    expect(empireFigures(idx, holdings, 'bo').population.empireRank).toBe(1);
  });

  it('leave figures nobody has blank', () => {
    const { gdpNominalUsd } = empireFigures(idx, holdings, 'ann');
    expect(gdpNominalUsd).toMatchObject({ total: null, missing: 2, share: null, worldRank: null, empireRank: null });
    expect(empireFigures(idx, holdings, 'cy').population).toMatchObject({ total: null, missing: 0 });
    expect(totalOf(idx, ['A', 'nowhere'], 'population')).toBe(50e6);
  });

  it('place empires by game value, ties sharing a place', () => {
    // Ann: C3 + E2 = 5; Bo: A9; Cy: nothing.
    expect(valueRank(idx, holdings, 'ann')).toEqual({ rank: 2, of: 3 });
    expect(valueRank(idx, new Map([...holdings, ['cy', ['B']]]), 'cy')).toEqual({ rank: 2, of: 3 });
  });

  it('write shares of the world', () => {
    expect([formatShare(0.1234), formatShare(0.0004), formatShare(0)]).toEqual(['12.3%', '<0.1%', '0.0%']);
  });
});
