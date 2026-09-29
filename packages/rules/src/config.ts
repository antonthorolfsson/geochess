import { z } from 'zod';
import { CURRENT_MISSION_RULES, VICTORY_MODES, publicMissionSpecSchema } from './victory/catalog';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export const draftRulesSchema = z.object({
  /**
   * - `contiguous`: after your first pick, you must claim a country bordering one you hold,
   *   unless none is left, in which case any free country is allowed.
   * - `free`: claim any free country.
   */
  mode: z.enum(['contiguous', 'free']).default('contiguous'),
});

/**
 * - `live`: blitz for game nights; both players are expected to be at the board.
 * - `correspondence`: a move or so a day, for slow campaigns.
 */
export const PACES = ['live', 'correspondence'] as const;
export type Pace = (typeof PACES)[number];

/** Live time controls the host can pick: minutes each, plus seconds added per move. */
export const LIVE_CLOCKS = ['3+2', '5+3', '10+5', '15+10'] as const;
export type LiveClock = (typeof LIVE_CLOCKS)[number];

/** Correspondence time per move, in hours. */
export const CORRESPONDENCE_HOURS = [12, 24, 48, 72] as const;

/**
 * - `defender-holds`: a drawn war changes nothing.
 * - `armageddon`: one more game with colors swapped; Black gets less time but wins a draw.
 */
export const DRAW_RULES = ['defender-holds', 'armageddon'] as const;
export type DrawRule = (typeof DRAW_RULES)[number];

/**
 * How a defender raises the stakes:
 * - `matched`: they put one of their own countries into the war, worth no more than the target;
 *   the attacker adds at least as much to the stake or withdraws, and winning takes both countries.
 * - `token`: they pay a war token to demand a stake of `raisePct` of the target's value; the
 *   token goes to the attacker if they fight on.
 * - `free`: they demand a stake of `raisePct` at no cost (the original rule).
 * - `off`: no raising.
 */
export const RAISE_STYLES = ['matched', 'token', 'free', 'off'] as const;
export type RaiseStyle = (typeof RAISE_STYLES)[number];

/**
 * Where a defender may redirect an attack:
 * - `nearby`: to a country bordering the original target, and the war keeps that target's clock.
 * - `anywhere`: to any country bordering the attacker's empire (the original rule).
 */
export const REDIRECT_RULES = ['nearby', 'anywhere'] as const;
export type RedirectRule = (typeof REDIRECT_RULES)[number];

/**
 * War settings. Rules stored before a setting existed read as the original game (a free raise,
 * redirects anywhere and free, tribute, no fortifying or recall), so no campaign underway
 * changes; new campaigns start from `DEFAULT_RULES`, which plays the revised answers.
 */
export const warRulesSchema = z.object({
  pace: z.enum(PACES).default('correspondence'),
  liveClock: z.enum(LIVE_CLOCKS).default('5+3'),
  hoursPerMove: z.literal(CORRESPONDENCE_HOURS).default(24),
  draws: z.enum(DRAW_RULES).default('defender-holds'),
  /** Extra time for home turf and terrain (defender) and for supply lines (attacker). */
  clockModifiers: z.boolean().default(true),
  /** War tokens each player gains when a round starts. */
  tokensPerRound: z.number().int().min(1).max(5).default(1),
  /** Unused tokens carry over up to this many; tribute can take a player past it. */
  tokenCap: z.number().int().min(1).max(10).default(3),
  /** The least a stake may be worth, as a percentage of the target's value (rounded up). */
  stakeFloorPct: z.number().int().min(50).max(200).default(80),
  /**
   * What a raise to a percentage demands (the `token` and `free` styles), and what a war on a
   * fortified country needs, as a percentage of the target's value (rounded up).
   */
  raisePct: z.number().int().min(100).max(300).default(125),
  /** Rounds after a country changes hands in a war before it can be staked. */
  lockRounds: z.number().int().min(0).max(5).default(2),
  /** Rounds two players can't declare war on each other after a war between them resolves. */
  truceRounds: z.number().int().min(0).max(5).default(1),
  raise: z.enum(RAISE_STYLES).default('free'),
  redirect: z.enum(REDIRECT_RULES).default('anywhere'),
  /** Redirecting costs the defender a war token, which goes to the attacker if they fight on. */
  redirectToken: z.boolean().default(false),
  /** A player may spend a war token to fortify a country: war on it needs a stake of `raisePct`. */
  fortify: z.boolean().default(false),
  /**
   * Either player may offer terms to end a war until its game is over: countries or tokens either
   * way, or nothing, and an accord. Replaces tribute as an answer.
   */
  peaceTerms: z.boolean().default(false),
  /** The attacker may call off a declaration until the defender answers. */
  recall: z.boolean().default(false),
});

/** The war settings new campaigns start with, over the original game's. */
export const REVISED_WAR_RULES = {
  raise: 'matched',
  redirect: 'nearby',
  redirectToken: true,
  fortify: true,
  peaceTerms: true,
  recall: true,
} as const satisfies Partial<z.input<typeof warRulesSchema>>;

/**
 * Longer holding times the host can pick besides the pace's default, by pace, in minutes. The
 * default is also the least: rounds are the host's to start, so the time is what stops a rushed
 * round from cutting the response window short.
 */
export const HOLD_MINUTE_OPTIONS: Record<Pace, readonly number[]> = {
  live: [15, 30, 60],
  correspondence: [48 * 60, 72 * 60],
};
/** Times to choose a secret mission the host can pick besides the pace's default, by pace, in minutes. */
export const SELECTION_MINUTE_OPTIONS: Record<Pace, readonly number[]> = {
  live: [3, 10],
  correspondence: [12 * 60, 48 * 60],
};

/** Last rounds the host can pick for an Objectives campaign (null: no last round). */
export const LAST_ROUND_OPTIONS = [15, 20, 25, 30] as const;
/** The last round new campaigns start with. */
export const DEFAULT_LAST_ROUND = 25;

/**
 * How a campaign is won. Rules stored before victory missions existed have no `victory` and read
 * as open-ended, so no campaign underway gains missions or points; new campaigns start from
 * `DEFAULT_RULES`, which plays Objectives with a last round.
 */
export const victoryRulesSchema = z.object({
  mode: z.enum(VICTORY_MODES).default('open'),
  /** The mission rules version (thresholds and generation limits) the campaign was created with. */
  version: z.number().int().min(1).default(CURRENT_MISSION_RULES),
  /** The public missions and their targets, generated in the lobby and locked when the draft starts. */
  publicMissions: z.array(publicMissionSpecSchema).max(8).default([]),
  /** Least time a claim is held after the next round starts, in minutes; null for the pace's default. */
  holdMinutes: z
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 60)
    .nullable()
    .default(null),
  /** Time to choose a secret mission once the draft ends, in minutes; null for the pace's default. */
  selectionMinutes: z
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 60)
    .nullable()
    .default(null),
  /**
   * The season's last round (Objectives only): if nobody has reached the points to win when it
   * ends, the most points win. Null plays on until someone does; rules stored before seasons
   * existed read as null, so no campaign underway gains an end.
   */
  lastRound: z.number().int().min(2).max(100).nullable().default(null),
});

/** Every host setting for a campaign. Stored as JSON on the campaign; grows with each phase. */
export const campaignRulesSchema = z.object({
  maxPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS).default(MAX_PLAYERS),
  draft: draftRulesSchema.prefault({}),
  war: warRulesSchema.prefault({}),
  victory: victoryRulesSchema.prefault({}),
});

export type CampaignRules = z.infer<typeof campaignRulesSchema>;
export type CampaignRulesInput = z.input<typeof campaignRulesSchema>;
export type DraftMode = CampaignRules['draft']['mode'];
export type WarRules = CampaignRules['war'];
export type VictoryRules = CampaignRules['victory'];

/**
 * Validates rules and fills defaults. Rules stored by earlier versions lack newer settings, so
 * stored rules go through this too.
 */
export function parseRules(input: unknown): CampaignRules {
  return campaignRulesSchema.parse(input ?? {});
}

/**
 * The settings a new campaign starts with: the revised war answers, Objectives, its public
 * missions generated on creation, and a last round.
 */
export const DEFAULT_RULES: CampaignRules = parseRules({
  war: REVISED_WAR_RULES,
  victory: { mode: 'objectives', lastRound: DEFAULT_LAST_ROUND },
});

/** The round after which an Objectives campaign ends on points, or null if it plays on. */
export const lastRoundOf = (rules: CampaignRules): number | null =>
  rules.victory.mode === 'objectives' ? rules.victory.lastRound : null;

export const campaignNameSchema = z
  .string()
  .trim()
  .min(2, 'Campaign names need at least 2 characters.')
  .max(60, 'Campaign names can be at most 60 characters.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Names need at least 2 characters.')
  .max(32, 'Names can be at most 32 characters.');

/**
 * A password for signing in by email. Length is the only rule, as NIST's guidance has it: a long
 * passphrase beats composition rules. The cap bounds the work of hashing one.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Passwords need at least 8 characters.')
  .max(128, 'Passwords can be at most 128 characters.');
