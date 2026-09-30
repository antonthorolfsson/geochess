import { z } from 'zod';

/**
 * Bot players: empires the host adds in the lobby. A bot drafts, chooses a secret mission, declares
 * and answers wars, and handles accords and peace terms like any player, seeing only what a player
 * in its seat would see. Its level sets its chess alone; every bot plays the map the same way.
 */
export interface BotLevel {
  level: number;
  /** How well it plays, in a word or two. */
  name: string;
  /**
   * A rough rating: the levels' round robin (`apps/server/scripts/bot-ladder.ts`), pinned to
   * Stockfish's own calibration of level 3 (`UCI_Elo` 1400, measured against other engines), so
   * only a guide to human ratings. Level 8 won every game it played, so its figure is a floor.
   */
  rating: number;
  /** How it plays, in a sentence. */
  summary: string;
}

export const BOT_LEVELS: readonly BotLevel[] = [
  { level: 1, name: 'Beginner', rating: 750, summary: 'Knows how the pieces move and often leaves them hanging.' },
  {
    level: 2,
    name: 'Novice',
    rating: 1100,
    summary: 'Takes what you leave loose, and still loses pieces now and then.',
  },
  { level: 3, name: 'Casual', rating: 1400, summary: 'Plays sensible moves but misses tactics a move or two deep.' },
  { level: 4, name: 'Club player', rating: 1650, summary: 'Rarely blunders outright; punishes loose play.' },
  {
    level: 5,
    name: 'Strong club player',
    rating: 1950,
    summary: 'Calculates a few moves ahead and converts a won game.',
  },
  { level: 6, name: 'Expert', rating: 2300, summary: 'Hard to beat without a real plan.' },
  { level: 7, name: 'Master', rating: 2550, summary: 'Strong in every phase of the game.' },
  { level: 8, name: 'Engine', rating: 3000, summary: 'Stockfish at full strength.' },
];

export const MIN_BOT_LEVEL = 1;
export const MAX_BOT_LEVEL = BOT_LEVELS.length;
export const DEFAULT_BOT_LEVEL = 3;

export const botLevelSchema = z.number().int().min(MIN_BOT_LEVEL).max(MAX_BOT_LEVEL);

export function botLevel(level: number): BotLevel {
  const info = BOT_LEVELS.find((l) => l.level === level);
  if (!info) throw new Error(`Unknown bot level: ${level}`);
  return info;
}

/** "Level 4 · Club player, about 1650". */
export function botLevelText(level: number): string {
  const info = botLevel(level);
  return `Level ${info.level} · ${info.name}, about ${info.rating}`;
}

/** Call signs for bots, in the order they're handed out: none is a place on the map. */
export const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Tango', 'Victor'] as const;

/** The first call sign no player in the campaign is using. */
export function nextBotName(taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  const free = BOT_NAMES.find((name) => !used.has(name.toLowerCase()));
  if (free) return free;
  for (let n = 1; ; n++) if (!used.has(`bot ${n}`)) return `Bot ${n}`;
}
