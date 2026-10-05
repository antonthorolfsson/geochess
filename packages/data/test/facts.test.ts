import { FACT_KEYS, factOf, type Dataset, type FactTable } from '@empire/rules';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = <T>(...parts: string[]) => JSON.parse(readFileSync(path.join(root, ...parts), 'utf8')) as T;
const table = readJson<FactTable>('facts', 'facts.json');
const index = readJson<{ versions: string[] }>('datasets', 'index.json');

describe('arsenals and energy table', () => {
  it('covers every territory of every dataset version, and nothing else', () => {
    for (const version of index.versions) {
      const ids = readJson<Dataset>('datasets', version, 'territories.json').territories.map((t) => t.id);
      expect(Object.keys(table.territories).sort(), version).toEqual([...ids].sort());
    }
  });

  it('names a source for every figure and holds only known, non-negative figures', () => {
    expect(Object.keys(table.sources).sort()).toEqual([...FACT_KEYS].sort());
    expect(table.attribution.length).toBeGreaterThan(0);
    for (const [id, facts] of Object.entries(table.territories)) {
      for (const [key, fact] of Object.entries(facts)) {
        expect(FACT_KEYS, `${id} ${key}`).toContain(key);
        expect(fact.value, `${id} ${key}`).toBeGreaterThanOrEqual(0);
        expect(fact.year, `${id} ${key}`).toBeGreaterThanOrEqual(2000);
      }
    }
  });

  it('has figures for most of the map', () => {
    const count = (key: (typeof FACT_KEYS)[number]) =>
      Object.values(table.territories).filter((facts) => facts[key] !== undefined).length;
    for (const key of ['activePersonnel', 'tanks', 'combatAircraft', 'navalShips'] as const) {
      expect(count(key), key).toBeGreaterThanOrEqual(140);
    }
    for (const key of ['oilTwh', 'gasTwh', 'electricityTwh'] as const)
      expect(count(key), key).toBeGreaterThanOrEqual(180);
  });

  it('looks like the real world', () => {
    const fact = (id: string, key: (typeof FACT_KEYS)[number]) => factOf(table, id, key) ?? 0;
    expect(fact('USA', 'combatAircraft')).toBeGreaterThan(fact('FRA', 'combatAircraft'));
    // Multirole jets count as combat aircraft, so the F-35 air forces aren't empty.
    expect(fact('NOR', 'combatAircraft')).toBeGreaterThan(0);
    expect(fact('RUS', 'tanks')).toBeGreaterThan(fact('GBR', 'tanks'));
    expect(fact('CHN', 'activePersonnel')).toBeGreaterThan(1_000_000);
    expect(fact('SAU', 'oilTwh')).toBeGreaterThan(fact('NOR', 'oilTwh'));
    expect(fact('QAT', 'gasTwh')).toBeGreaterThan(fact('DEU', 'gasTwh'));
    expect(fact('CHN', 'electricityTwh')).toBeGreaterThan(fact('USA', 'electricityTwh'));
    expect(factOf(table, 'GRL', 'tanks')).toBeNull();
    expect(factOf(null, 'USA', 'tanks')).toBeNull();
  });
});
