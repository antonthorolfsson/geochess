import { z } from 'zod';

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
  /** What a defender's raise demands, as a percentage of the target's value (rounded up). */
  raisePct: z.number().int().min(100).max(300).default(125),
  /** Rounds after a country changes hands in a war before it can be staked. */
  lockRounds: z.number().int().min(0).max(5).default(2),
  /** Rounds two players can't declare war on each other after a war between them resolves. */
  truceRounds: z.number().int().min(0).max(5).default(1),
});

/** Every host setting for a campaign. Stored as JSON on the campaign; grows with each phase. */
export const campaignRulesSchema = z.object({
  maxPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS).default(MAX_PLAYERS),
  draft: draftRulesSchema.prefault({}),
  war: warRulesSchema.prefault({}),
});

export type CampaignRules = z.infer<typeof campaignRulesSchema>;
export type CampaignRulesInput = z.input<typeof campaignRulesSchema>;
export type DraftMode = CampaignRules['draft']['mode'];
export type WarRules = CampaignRules['war'];

/**
 * Validates rules and fills defaults. Rules stored by earlier versions lack newer settings, so
 * stored rules go through this too.
 */
export function parseRules(input: unknown): CampaignRules {
  return campaignRulesSchema.parse(input ?? {});
}

export const DEFAULT_RULES: CampaignRules = parseRules({});

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
