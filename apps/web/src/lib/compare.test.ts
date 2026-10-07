import {
  indexDataset,
  type ChessProfile,
  type Dataset,
  type FactTable,
  type WarRecord,
  type WarTally,
} from '@empire/rules';
import { lineDataset, makeTerritory } from '@empire/rules/testing';
import { describe, expect, it } from 'vitest';
import { amountOf, chessResults, leaderOf, score, shareRow, warResults, worldAmount } from './compare';

/** A9 - B5 - C3 ~ D7 - E2 - F1, with populations of 50, 30, 20, 10 and 5 million, and none for F. */
const POPULATION: Record<string, number | undefined> = { A: 50e6, B: 30e6, C: 20e6, D: 10e6, E: 5e6 };
const base = lineDataset();
const dataset: Dataset = {
  ...base,
  territories: base.territories.map((t) => {
    const territory = makeTerritory(t.id, t.value, t.land, t.sea, POPULATION[t.id]);
    return { ...territory, stats: { ...territory.stats, population: POPULATION[t.id] ?? null } };
  }),
};
const idx = indexDataset(dataset);
const holdings = new Map([
  ['ann', ['C', 'E']],
  ['bo', ['A', 'F']],
  ['cy', []],
]);

const tally = (t: Partial<WarTally> = {}): WarTally => ({
  won: 0,
  lost: 0,
  drawn: 0,
  tribute: 0,
  settled: 0,
  withdrawn: 0,
  opponentBackedDown: 0,
  backedDown: 0,
  cancelled: 0,
  underway: 0,
  ...t,
});

describe('measuring empires', () => {
  it('measure game value, countries and real-world figures', () => {
    expect(amountOf(idx, ['C', 'E'], 'value')).toBe(5);
    expect(amountOf(idx, ['C', 'E'], 'countries')).toBe(2);
    expect(amountOf(idx, ['C', 'E'], 'population')).toBe(25e6);
    // F has no figure, so it adds nothing; an empire with no figures at all has none.
    expect(amountOf(idx, ['A', 'F'], 'population')).toBe(50e6);
    expect(amountOf(idx, ['F'], 'population')).toBeNull();
    expect(amountOf(idx, [], 'value')).toBe(0);
  });

  it('measure the whole map', () => {
    expect(worldAmount(idx, 'value')).toBe(27);
    expect(worldAmount(idx, 'countries')).toBe(6);
    expect(worldAmount(idx, 'population')).toBe(115e6);
  });

  it('split a measure between the empires, in the order given, with the rest unclaimed', () => {
    const row = shareRow(idx, holdings, ['bo', 'ann', 'cy'], 'value');
    expect(row.parts.map((p) => [p.userId, p.amount])).toEqual([
      ['bo', 10],
      ['ann', 5],
      ['cy', 0],
    ]);
    expect(row.parts[0]!.share).toBeCloseTo(10 / 27);
    expect(row.unclaimed).toBeCloseTo(12 / 27);
    const people = shareRow(idx, holdings, ['bo', 'ann', 'cy'], 'population');
    expect(people.parts.map((p) => p.share)).toEqual([50 / 115, 25 / 115, 0]);
    expect(people.parts[2]!.amount).toBeNull();
  });

  it('measure arsenals and energy from their table', () => {
    const facts: FactTable = {
      generatedAt: '2026-10-05T00:00:00.000Z',
      attribution: [],
      sources: {} as FactTable['sources'],
      territories: {
        A: { oilMillionBarrels: { value: 30, year: 2024 } },
        C: { oilMillionBarrels: { value: 10, year: 2016 } },
      },
    };
    expect(amountOf(idx, ['C', 'E'], 'oilMillionBarrels', facts)).toBe(10);
    expect(amountOf(idx, ['C', 'E'], 'oilMillionBarrels')).toBeNull();
    expect(worldAmount(idx, 'oilMillionBarrels', facts)).toBe(40);
    const oil = shareRow(idx, holdings, ['bo', 'ann', 'cy'], 'oilMillionBarrels', facts);
    expect(oil.parts.map((p) => p.share)).toEqual([0.75, 0.25, 0]);
    expect(oil.unclaimed).toBe(0);
  });
});

describe('results', () => {
  it('add up wars attacking and defending', () => {
    const record: WarRecord = {
      attacking: tally({ won: 2, lost: 1, settled: 1, underway: 1 }),
      defending: tally({ won: 1, drawn: 2, tribute: 1, withdrawn: 2, cancelled: 1 }),
      tokensTaken: 0,
      tokensPaid: 0,
      gained: [],
      lost: [],
    };
    expect(warResults(record)).toEqual({ won: 3, drawn: 2, lost: 1, other: 5, underway: 1 });
  });

  it('add up games with either colour, and score them', () => {
    const profile = {
      asWhite: { won: 2, drawn: 1, lost: 0 },
      asBlack: { won: 0, drawn: 1, lost: 2 },
    } as ChessProfile;
    const results = chessResults(profile);
    expect(results).toEqual({ won: 2, drawn: 2, lost: 2 });
    expect(score(results)).toBe(0.5);
    expect(score({ won: 0, drawn: 0, lost: 0 })).toBeNull();
  });
});

describe('leaders', () => {
  it('name whoever has the most, everyone level sharing it', () => {
    expect(
      leaderOf([
        { userId: 'ann', amount: 3 },
        { userId: 'bo', amount: 5 },
        { userId: 'cy', amount: 5 },
      ]),
    ).toEqual({ userIds: ['bo', 'cy'], amount: 5 });
  });

  it('break ties with a second number', () => {
    expect(
      leaderOf([
        { userId: 'ann', amount: 0.75, then: 4 },
        { userId: 'bo', amount: 0.75, then: 8 },
      ]),
    ).toEqual({ userIds: ['bo'], amount: 0.75 });
  });

  it('name nobody when nobody has any', () => {
    expect(leaderOf([{ userId: 'ann', amount: null }])).toBeNull();
    expect(leaderOf([{ userId: 'ann', amount: 0 }])).toBeNull();
    expect(leaderOf([{ userId: 'ann', amount: 0 }], { zero: true })).toEqual({ userIds: ['ann'], amount: 0 });
  });
});
