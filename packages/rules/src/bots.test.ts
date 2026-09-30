import { describe, expect, it } from 'vitest';
import { BOT_LEVELS, BOT_NAMES, MAX_PLAYERS, botLevelSchema, botLevelText, nextBotName } from './index';

describe('bot levels', () => {
  it('run from 1 to 8, each stronger than the last', () => {
    expect(BOT_LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i < BOT_LEVELS.length; i++) {
      expect(BOT_LEVELS[i]!.rating, BOT_LEVELS[i]!.name).toBeGreaterThan(BOT_LEVELS[i - 1]!.rating);
    }
  });

  it('accept only the levels there are', () => {
    expect(botLevelSchema.safeParse(1).success).toBe(true);
    expect(botLevelSchema.safeParse(8).success).toBe(true);
    for (const bad of [0, 9, 2.5, '3']) expect(botLevelSchema.safeParse(bad).success, String(bad)).toBe(false);
  });

  it('read as a level, a name and a rough rating', () => {
    expect(botLevelText(4)).toMatch(/^Level 4 · [A-Z][a-z ]+, about \d{3,4}$/);
  });
});

describe('bot names', () => {
  it('are call signs, enough for every seat but the host', () => {
    expect(BOT_NAMES.length).toBeGreaterThanOrEqual(MAX_PLAYERS - 1);
    expect(new Set(BOT_NAMES).size).toBe(BOT_NAMES.length);
  });

  it('go to the first call sign nobody at the table uses', () => {
    expect(nextBotName([])).toBe('Alpha');
    expect(nextBotName(['Field Marshal', 'Alpha'])).toBe('Bravo');
    expect(nextBotName([' alpha ', 'BRAVO'])).toBe('Charlie');
    expect(nextBotName([...BOT_NAMES])).toBe('Bot 1');
    expect(nextBotName([...BOT_NAMES, 'Bot 1'])).toBe('Bot 2');
  });
});
