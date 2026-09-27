import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, parseRules } from './config';
import { EMPIRE_COLORS, firstFreeColor } from './colors';

describe('campaign rules', () => {
  it('fills defaults', () => {
    expect(DEFAULT_RULES).toEqual({
      maxPlayers: 8,
      draft: { mode: 'contiguous' },
      war: {
        pace: 'correspondence',
        liveClock: '5+3',
        hoursPerMove: 24,
        draws: 'defender-holds',
        clockModifiers: true,
        tokensPerRound: 1,
        tokenCap: 3,
        stakeFloorPct: 80,
        raisePct: 125,
        lockRounds: 2,
        truceRounds: 1,
      },
    });
    expect(parseRules({ draft: {} })).toEqual(DEFAULT_RULES);
    expect(parseRules(undefined)).toEqual(DEFAULT_RULES);
  });

  it('fills war settings into rules stored before they existed', () => {
    const stored = { maxPlayers: 4, draft: { mode: 'free' } };
    expect(parseRules(stored).war).toEqual(DEFAULT_RULES.war);
  });

  it('rejects out-of-range player counts', () => {
    expect(() => parseRules({ maxPlayers: 1 })).toThrow();
    expect(() => parseRules({ maxPlayers: 9 })).toThrow();
  });

  it('only offers the preset time controls', () => {
    expect(parseRules({ war: { pace: 'live', liveClock: '10+5' } }).war.liveClock).toBe('10+5');
    expect(() => parseRules({ war: { liveClock: '1+0' } })).toThrow();
    expect(() => parseRules({ war: { hoursPerMove: 36 } })).toThrow();
  });
});

describe('empire colors', () => {
  it('pairs every color with a distinct pattern', () => {
    expect(new Set(EMPIRE_COLORS.map((c) => c.pattern)).size).toBe(EMPIRE_COLORS.length);
    expect(EMPIRE_COLORS.every((c, i) => c.index === i)).toBe(true);
  });

  it('hands out the first free color', () => {
    expect(firstFreeColor([])).toBe(0);
    expect(firstFreeColor([0, 1, 3])).toBe(2);
    expect(firstFreeColor(EMPIRE_COLORS.map((c) => c.index))).toBeNull();
  });
});
