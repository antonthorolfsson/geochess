import { describe, expect, it } from 'vitest';
import type { MissionSpec, SecretMissionSpec } from './catalog';
import { effortText, missionRequirement, missionTargets, partAmount, revealRule } from './text';
import { buildMap } from './test-maps';

const idx = buildMap({ A: { v: 1 }, B: { v: 1 }, C: { v: 1 }, D: { v: 1 } });
const estimate = { conquests: 3, inTheWay: 1, targetValue: 7, rivals: 2 };

describe('mission wording', () => {
  it('reads large figures in words, never rounding up past what they are', () => {
    expect(partAmount({ unit: 'people' }, 1_464_000_000)).toBe('1.46 billion');
    expect(partAmount({ unit: 'people' }, 999_600_000)).toBe('999 million');
    expect(partAmount({ unit: 'people' }, 42_500)).toBe('42,500');
    expect(partAmount({ unit: 'km2' }, 7_500_000)).toBe('7.5 million km²');
    expect(partAmount({ unit: 'percent' }, 48)).toBe('48%');
    expect(partAmount({}, 3)).toBe('3');
  });

  it('spells out the new missions, naming a Nemesis’s rival', () => {
    const nemesis: MissionSpec = { kind: 'nemesis', rival: 'bo', count: 3, reveal: 2 };
    expect(missionRequirement(nemesis, idx, { playerName: (id) => (id === 'bo' ? 'Bo' : '?') })).toBe(
      'Take three countries from Bo, in wars or as tribute, and hold them.',
    );
    const straits: MissionSpec = {
      kind: 'strait_keeper',
      straits: [
        { name: 'Strait of A', shores: ['A', 'B'] },
        { name: 'Bab-el-C', shores: ['C', 'D'] },
      ],
      reveal: 1,
    };
    expect(missionRequirement(straits, idx)).toBe(
      'Hold both shores of two straits: the Strait of A (Territory A and Territory B) and the Bab-el-C ' +
        '(Territory C and Territory D).',
    );
    expect(missionTargets(straits)).toEqual(['A', 'B', 'C', 'D']);
    expect(missionRequirement({ kind: 'one_billion', people: 1_000_000_000 }, idx)).toBe(
      'Win countries home to at least 1 billion people since the draft, and hold them.',
    );
    const sea: MissionSpec = {
      kind: 'mare_nostrum',
      shores: [
        { name: 'European', territories: ['A', 'B'] },
        { name: 'eastern', territories: ['C'] },
      ],
      need: 2,
      perShore: 1,
    };
    expect(missionRequirement(sea, idx)).toBe(
      'Hold two of the three Mediterranean countries, at least one on each of its shores: the European ' +
        '(Territory A and Territory B) and the eastern (Territory C).',
    );
  });

  it('says what a secret option asks: conquests, or wins for the missions about battles', () => {
    const iron: SecretMissionSpec = { kind: 'iron_wall', wins: 2 };
    expect(effortText(iron, { ...estimate, conquests: 2 })).toBe('2 wars to win, against whoever attacks you.');
    expect(revealRule(iron)).toBe('Revealed once you have won one.');
    const route: SecretMissionSpec = { kind: 'silk_road', endpoints: ['A', 'D'] };
    expect(effortText(route, estimate)).toBe(
      'About 3 conquests (1 of them in the way) against 2 rivals, targets worth 7.',
    );
  });
});
