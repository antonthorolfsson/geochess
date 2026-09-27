import { describe, expect, it } from 'vitest';
import { parseRules } from './config';
import {
  autoPick,
  checkPick,
  draftListStatus,
  draftRoundOf,
  legalPicks,
  normalizeDraftList,
  pickerAt,
  picksUntilTurn,
  shuffled,
  suggestPick,
  upcomingPickers,
  type Owners,
} from './draft';
import { indexDataset } from './graph';
import { lineDataset } from './test-fixtures';

const idx = indexDataset(lineDataset());
const contiguous = parseRules({ draft: { mode: 'contiguous' } });
const free = parseRules({ draft: { mode: 'free' } });
const owners = (entries: [string, string][]): Owners => new Map(entries);

describe('snake order', () => {
  it('reverses every other round', () => {
    const order = ['ann', 'bo', 'cy'];
    const picks = Array.from({ length: 9 }, (_, i) => pickerAt(order, i));
    expect(picks).toEqual(['ann', 'bo', 'cy', 'cy', 'bo', 'ann', 'ann', 'bo', 'cy']);
  });

  it('numbers rounds from one', () => {
    expect(draftRoundOf(0, 3)).toBe(1);
    expect(draftRoundOf(2, 3)).toBe(1);
    expect(draftRoundOf(3, 3)).toBe(2);
  });

  it('lists upcoming pickers without running past the end', () => {
    expect(upcomingPickers(['ann', 'bo'], 1, 5, 4)).toEqual(['bo', 'bo', 'ann']);
  });

  it('counts picks until a player is up', () => {
    const order = ['ann', 'bo', 'cy'];
    expect(picksUntilTurn(order, 0, 6, 'ann')).toBe(0);
    expect(picksUntilTurn(order, 1, 6, 'ann')).toBe(4);
    expect(picksUntilTurn(order, 6, 6, 'ann')).toBeNull();
  });
});

describe('legal picks', () => {
  it('allows any free country for a first pick', () => {
    expect(legalPicks(idx, contiguous, owners([]), 'ann')).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('requires bordering countries in contiguous mode', () => {
    expect(legalPicks(idx, contiguous, owners([['B', 'ann']]), 'ann')).toEqual(['A', 'C']);
  });

  it('counts sea lanes as borders', () => {
    expect(
      legalPicks(
        idx,
        contiguous,
        owners([
          ['C', 'ann'],
          ['B', 'bo'],
        ]),
        'ann',
      ),
    ).toEqual(['D']);
  });

  it('falls back to any free country when the empire is boxed in', () => {
    const o = owners([
      ['A', 'ann'],
      ['B', 'bo'],
    ]);
    expect(legalPicks(idx, contiguous, o, 'ann')).toEqual(['C', 'D', 'E', 'F']);
  });

  it('allows anything free in free mode', () => {
    expect(legalPicks(idx, free, owners([['A', 'ann']]), 'ann')).toEqual(['B', 'C', 'D', 'E', 'F']);
  });
});

describe('checkPick', () => {
  const draft = {
    order: ['ann', 'bo'],
    pickIndex: 2,
    owners: owners([
      ['A', 'ann'],
      ['D', 'bo'],
    ]),
  };

  it('accepts a legal pick', () => {
    // Pick 2 is the start of round 2, which reverses: bo picks.
    expect(checkPick(idx, contiguous, draft, 'bo', 'E')).toBeNull();
  });

  it('rejects out-of-turn, unknown, taken and non-bordering picks', () => {
    expect(checkPick(idx, contiguous, draft, 'ann', 'B')).toBe('not-your-turn');
    expect(checkPick(idx, contiguous, draft, 'bo', 'ZZZ')).toBe('unknown-territory');
    expect(checkPick(idx, contiguous, draft, 'bo', 'A')).toBe('already-claimed');
    expect(checkPick(idx, contiguous, draft, 'bo', 'B')).toBe('not-bordering');
  });

  it('rejects picks once every country is claimed', () => {
    expect(checkPick(idx, contiguous, { ...draft, pickIndex: 6 }, 'ann', 'B')).toBe('draft-complete');
  });
});

describe('suggestPick', () => {
  it('takes the most valuable country available', () => {
    expect(suggestPick(idx, free, owners([]), 'ann')).toBe('A');
    expect(suggestPick(idx, free, owners([['A', 'bo']]), 'ann')).toBe('D');
  });

  it('respects contiguity', () => {
    expect(suggestPick(idx, contiguous, owners([['E', 'ann']]), 'ann')).toBe('D');
    expect(
      suggestPick(
        idx,
        contiguous,
        owners([
          ['F', 'ann'],
          ['E', 'bo'],
        ]),
        'ann',
      ),
    ).toBe('A');
  });

  it('prefers bordering countries on equal value', () => {
    const tie = indexDataset({
      ...lineDataset(),
      territories: lineDataset().territories.map((t) => ({ ...t, value: 4 })),
    });
    expect(suggestPick(tie, free, owners([['E', 'ann']]), 'ann')).toBe('D');
  });

  it('returns null when nothing is left', () => {
    const all = owners(idx.ids.map((id) => [id, 'bo']));
    expect(suggestPick(idx, free, all, 'ann')).toBeNull();
  });
});

describe('shuffled', () => {
  it('permutes without losing items', () => {
    const items = ['a', 'b', 'c', 'd'];
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const out = shuffled(items, random);
    expect([...out].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('draft lists', () => {
  it('auto-picks the first country on the list', () => {
    expect(autoPick(idx, free, owners([]), 'ann', ['E', 'C'])).toBe('E');
  });

  it('skips countries someone already claimed', () => {
    expect(autoPick(idx, free, owners([['E', 'bo']]), 'ann', ['E', 'C'])).toBe('C');
  });

  it('skips countries that do not border the empire yet, keeping them for later', () => {
    const o = owners([['A', 'ann']]);
    expect(autoPick(idx, contiguous, o, 'ann', ['D', 'B'])).toBe('B');
    expect(draftListStatus(idx, contiguous, o, 'ann', ['D', 'B', 'C'])).toEqual([
      { id: 'D', status: 'not-bordering' },
      { id: 'B', status: 'next' },
      { id: 'C', status: 'not-bordering' },
    ]);
  });

  it('falls back to the most valuable legal country when the list runs out', () => {
    expect(autoPick(idx, free, owners([['E', 'bo']]), 'ann', ['E'])).toBe('A');
    expect(autoPick(idx, free, owners([]), 'ann', [])).toBe('A');
  });

  it('can wait for the player instead once the list runs out', () => {
    expect(autoPick(idx, free, owners([['E', 'bo']]), 'ann', ['E', 'C'], 'wait')).toBe('C');
    expect(autoPick(idx, free, owners([['E', 'bo']]), 'ann', ['E'], 'wait')).toBeNull();
    expect(autoPick(idx, contiguous, owners([['A', 'ann']]), 'ann', ['D'], 'wait')).toBeNull();
  });

  it('reports each entry', () => {
    expect(draftListStatus(idx, free, owners([['C', 'bo']]), 'ann', ['C', 'F', 'E'])).toEqual([
      { id: 'C', status: 'claimed' },
      { id: 'F', status: 'next' },
      { id: 'E', status: 'available' },
    ]);
  });

  it('drops unknown, repeated and claimed countries', () => {
    expect(normalizeDraftList(idx, owners([['B', 'bo']]), ['C', 'ZZZ', 'B', 'C', 'A'])).toEqual(['C', 'A']);
  });
});
