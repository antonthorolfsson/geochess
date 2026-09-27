import { STAT_KEYS, type Dataset, type StatKey, type StatMeta, type Territory } from './dataset';

const meta = Object.fromEntries(STAT_KEYS.map((k) => [k, { year: null, estimated: false, source: 'test' }])) as Record<
  StatKey,
  StatMeta
>;

export function makeTerritory(
  id: string,
  value: number,
  land: string[] = [],
  sea: string[] = [],
  population = 1_000_000,
): Territory {
  return {
    id,
    name: `Territory ${id}`,
    kind: 'country',
    members: [],
    continent: 'europe',
    subregion: 'Test',
    value,
    land: [...land].sort(),
    sea: [...sea].sort(),
    terrain: [],
    micro: false,
    anchor: [0, 0],
    stats: {
      population,
      areaKm2: null,
      gdpNominalUsd: null,
      gdpPppUsd: null,
      militarySpendingUsd: null,
      armedForces: null,
    },
    statMeta: meta,
  };
}

/**
 * Two empires facing each other, for war rules. Ids carry their values; `U3` is left for tests
 * that need an unclaimed country.
 *
 *        Q2              R2
 *        |               |
 *   A1 - A2 - A6 ~~~~~~ B7 (island) - B10 (mountains)
 *   |    |               |
 *   B1   A3 - A4 ------ B5
 *   |    |    |          |
 *   +--- B2 --)----------+
 *             U3
 *
 * Land borders: A1-A2, A1-B1, A2-A3, A2-A6, A2-Q2, A3-A4, A3-B2, A4-B5, A4-U3, B1-B2, B2-B5,
 * B5-B7, B7-B10, B10-R2. Sea lane: A6~B7.
 */
export function warDataset(): Dataset {
  const t = (id: string, land: string[], sea: string[] = [], terrain: Territory['terrain'] = []): Territory => ({
    ...makeTerritory(id, Number(id.slice(1)), land, sea),
    terrain,
  });
  return {
    version: 'war-test',
    generatedAt: '2026-01-01T00:00:00.000Z',
    attribution: [],
    territories: [
      t('A1', ['A2', 'B1']),
      t('A2', ['A1', 'A3', 'A6', 'Q2']),
      t('A3', ['A2', 'A4', 'B2']),
      t('A4', ['A3', 'B5', 'U3']),
      t('A6', ['A2'], ['B7']),
      t('B1', ['A1', 'B2']),
      t('B10', ['B7', 'R2'], [], ['mountains']),
      t('B2', ['A3', 'B1', 'B5']),
      t('B5', ['A4', 'B2', 'B7']),
      t('B7', ['B10', 'B5'], ['A6'], ['island']),
      t('Q2', ['A2']),
      t('R2', ['B10']),
      t('U3', ['A4']),
    ],
    seaLanes: [{ a: 'A6', b: 'B7', from: [0, 0], to: [1, 1], km: 100, manual: false }],
  };
}

/**
 * A - B - C ~ D - E - F   ("-" land border, "~" sea lane)
 * values: A9 B5 C3 D7 E2 F1
 */
export function lineDataset(): Dataset {
  return {
    version: 'test',
    generatedAt: '2026-01-01T00:00:00.000Z',
    attribution: [],
    territories: [
      makeTerritory('A', 9, ['B']),
      makeTerritory('B', 5, ['A', 'C']),
      makeTerritory('C', 3, ['B'], ['D']),
      makeTerritory('D', 7, ['E'], ['C']),
      makeTerritory('E', 2, ['D', 'F']),
      makeTerritory('F', 1, ['E']),
    ],
    seaLanes: [{ a: 'C', b: 'D', from: [0, 0], to: [1, 1], km: 100, manual: false }],
  };
}
