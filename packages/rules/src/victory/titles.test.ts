import { describe, expect, it } from 'vitest';
import { missionRules } from './catalog';
import { buildMap } from './test-maps';
import { MIGHT_SCALE, militaryMight, mightText, nextHolder, titleHolders, titleTotals, titlesHeldBy } from './titles';

// A superpower (spending, little army), two big armies, and a small country.
const idx = buildMap({
  A: { v: 5, land: ['B'], people: 300, area: 9000, gdp: 25_000, spend: 900, forces: 1 },
  B: { v: 5, land: ['C'], people: 1400, area: 9500, gdp: 18_000, spend: 100, forces: 4 },
  C: { v: 5, land: ['D'], people: 1400, area: 3000, gdp: 3_000, spend: 64, forces: 4 },
  D: { v: 1, people: 10, area: 100, gdp: 100 },
});

describe('military might', () => {
  it('averages the square-root shares of spending and armed forces, per million of the world', () => {
    const might = militaryMight(idx);
    // Spending roots 30, 10, 8 (of 48); forces roots 1, 2, 2 (of 5).
    expect(might.get('A')).toBe(Math.round(MIGHT_SCALE * (0.5 * (30 / 48) + 0.5 * (1 / 5))));
    expect(might.get('B')).toBe(Math.round(MIGHT_SCALE * (0.5 * (10 / 48) + 0.5 * (2 / 5))));
    expect(might.get('D')).toBe(0);
    // Nine times B's spending gives A less might than B and C together.
    expect(might.get('A')!).toBeLessThan(might.get('B')! + might.get('C')!);
    expect(mightText(might.get('A')!)).toBe('412.5');
  });
});

describe('titles', () => {
  it('go to the one player who leads, and to nobody on a shared lead', () => {
    expect(
      nextHolder(
        new Map([
          ['p1', 3],
          ['p2', 2],
        ]),
        null,
      ),
    ).toBe('p1');
    expect(
      nextHolder(
        new Map([
          ['p1', 3],
          ['p2', 3],
        ]),
        null,
      ),
    ).toBeNull();
    expect(
      nextHolder(
        new Map([
          ['p1', 0],
          ['p2', 0],
        ]),
        null,
      ),
    ).toBeNull();
  });

  it('stay with a holder who is only matched, and move to whoever passes them', () => {
    expect(
      nextHolder(
        new Map([
          ['p1', 3],
          ['p2', 3],
        ]),
        'p2',
      ),
    ).toBe('p2');
    expect(
      nextHolder(
        new Map([
          ['p1', 4],
          ['p2', 3],
        ]),
        'p2',
      ),
    ).toBe('p1');
    // A holder passed by two players level with each other: nobody.
    expect(
      nextHolder(
        new Map([
          ['p1', 4],
          ['p2', 4],
          ['p3', 1],
        ]),
        'p3',
      ),
    ).toBeNull();
  });

  it('are worked out from each empire’s totals', () => {
    const owners = new Map([
      ['A', 'p1'],
      ['B', 'p2'],
      ['C', 'p3'],
      ['D', 'p3'],
    ]);
    const players = ['p1', 'p2', 'p3'];
    expect(titleTotals(idx, owners, players).get('population')).toEqual(
      new Map([
        ['p1', 300],
        ['p2', 1400],
        ['p3', 1410],
      ]),
    );
    const holders = titleHolders(idx, owners, players, {});
    expect(holders).toEqual({ population: 'p3', land: 'p2', economy: 'p1', military: 'p1' });
    expect(titlesHeldBy(holders, 'p1')).toEqual(['economy', 'military']);
    // p3 loses D: level with p2 on people, so the holder keeps it.
    owners.set('D', 'p2');
    expect(titleHolders(idx, owners, players, holders).population).toBe('p2');
  });

  it('come with version 5, a point each, with 10 points to win', () => {
    expect(missionRules(4).titles).toBeNull();
    expect(missionRules(5)).toMatchObject({
      points: { public: 2, secret: 3, toWin: 10 },
      titles: { kinds: ['population', 'land', 'economy', 'military'], points: 1 },
    });
  });
});
