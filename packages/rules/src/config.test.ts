import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, lastRoundOf, parseRules } from './config';
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
      victory: {
        mode: 'objectives',
        version: 3,
        publicMissions: [],
        holdMinutes: null,
        selectionMinutes: null,
        lastRound: 25,
      },
    });
    expect(parseRules({ draft: {}, victory: { mode: 'objectives', lastRound: 25 } })).toEqual(DEFAULT_RULES);
  });

  it('gives campaigns stored before seasons no last round', () => {
    const stored = { victory: { mode: 'objectives', version: 2, publicMissions: [] } };
    expect(parseRules(stored).victory.lastRound).toBeNull();
    expect(lastRoundOf(parseRules(stored))).toBeNull();
    expect(lastRoundOf(DEFAULT_RULES)).toBe(25);
    // An open-ended campaign has no season, whatever it stored.
    expect(lastRoundOf(parseRules({ victory: { mode: 'open', lastRound: 20 } }))).toBeNull();
    expect(() => parseRules({ victory: { mode: 'objectives', lastRound: 1 } })).toThrow();
  });

  it('fills war settings into rules stored before they existed', () => {
    const stored = { maxPlayers: 4, draft: { mode: 'free' } };
    expect(parseRules(stored).war).toEqual(DEFAULT_RULES.war);
  });

  it('reads rules stored before victory missions as open-ended, never as Objectives', () => {
    const stored = { maxPlayers: 4, draft: { mode: 'free' }, war: { pace: 'live' } };
    // They play no missions, so the version only counts if the host switches a lobby to Objectives.
    expect(parseRules(stored).victory).toEqual({
      mode: 'open',
      version: 3,
      publicMissions: [],
      holdMinutes: null,
      selectionMinutes: null,
      lastRound: null,
    });
    expect(parseRules(undefined).victory.mode).toBe('open');
  });

  it('keeps the mission rules version a campaign stored', () => {
    expect(parseRules({ victory: { mode: 'objectives', version: 1 } }).victory.version).toBe(1);
  });

  it('validates the public missions stored with the rules', () => {
    const victory = { mode: 'objectives', publicMissions: [{ kind: 'expansion', gain: 15 }] };
    expect(parseRules({ victory }).victory.publicMissions).toEqual([{ kind: 'expansion', gain: 15 }]);
    expect(() => parseRules({ victory: { publicMissions: [{ kind: 'expansion' }] } })).toThrow();
    expect(() => parseRules({ victory: { publicMissions: [{ kind: 'northern_passage' }] } })).toThrow();
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
