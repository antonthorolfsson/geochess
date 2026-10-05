import { valueScale } from '@empire/rules';

/**
 * How the bots play. The defaults aim at a competent, casual friend group: players chase their
 * missions and block claims they can see, mostly accept wars, raise now and then, fortify what
 * their missions lean on, sign accords with neighbours they don't want to fight and rarely break
 * them.
 *
 * Knobs counted in country value are written for values 1-10 (dataset 2026.1); bots playing
 * another dataset have them scaled by its value scale (`knobsFor`).
 */
export interface BotKnobs {
  /** `standard` chases missions; `greedy` plays on country value alone, with no diplomacy. */
  policy: 'standard' | 'greedy';
  /** `greedy` drafts like auto-draft; `missions` adds bonuses for public mission targets. */
  draft: 'greedy' | 'missions';
  draftMissionWeight: number;
  /** Scale of the random noise on draft scores. */
  draftNoise: number;
  /**
   * - `ease`: the option showing the fewest conquests or wins (ties to the best fit).
   * - `rank1`: the best fit, as assigned when a player doesn't choose.
   * - `random`
   * - `forced`: a kind assigned by the scenario (for measuring each kind's strength).
   */
  secretChoice: 'ease' | 'rank1' | 'random' | 'forced';
  /** What one victory point is worth, in country value. */
  vpValue: number;
  /** What a war token is worth when it isn't at the cap, in country value. */
  tokenValue: number;
  /** The share of a mission's worth credited for progress toward it (the rest comes on completion). */
  progressWeight: number;
  /** Least utility for a declaration, with tokens to spare and with tokens at the cap. */
  declareThreshold: number;
  declareThresholdAtCap: number;
  /** Chance a defender raises when raising is worth it to them. */
  raiseRate: number;
  /** Chance a defender considers a redirect, tribute or peace terms when the target matters to them. */
  counterRate: number;
  /** Rounds of accord a defender asks for with the terms they offer (0 for none). */
  peaceAccordRounds: number;
  /** Whether bots fortify the countries their missions lean on. */
  fortify: boolean;
  /**
   * Chance an attacker calls a declaration off before the defender answers. Nothing in the bots'
   * reckoning calls for it, so it's 0 but for tests that need the rule exercised.
   */
  recallRate: number;
  /** Weight on breaking a rival's visible claim or revealed secret. */
  blockWeight: number;
  /** Weight on attacking the leader of the race. */
  leaderWeight: number;
  /** Whether bots sign accords at all. */
  accords: boolean;
  /** Chance per round a bot proposes an accord when it has a candidate partner. */
  proposeRate: number;
  /** Bias toward signing (added to the chance of accepting). */
  acceptBias: number;
  /** Utility margin over other targets, in value, that tempts a bot to break an accord (lower is more treacherous). */
  betrayMargin: number;
  /** Reputation under which a bot refuses proposals. */
  grudge: number;
  /** Candidate wars worked out in full per declaration. */
  topK: number;
  /** Hold 2 tokens back for Lightning Campaign while it's unscored. */
  saveForLightning: boolean;
  /** Weight on titles won, kept, lost or taken from the opponent in a war (what-ifs with titles only). */
  titleWeight: number;
}

export const DEFAULT_KNOBS: BotKnobs = {
  policy: 'standard',
  draft: 'missions',
  draftMissionWeight: 1,
  draftNoise: 1,
  secretChoice: 'ease',
  vpValue: 4,
  tokenValue: 1,
  progressWeight: 0.5,
  declareThreshold: 0.4,
  declareThresholdAtCap: -0.5,
  raiseRate: 0.35,
  counterRate: 0.8,
  peaceAccordRounds: 2,
  fortify: true,
  recallRate: 0,
  blockWeight: 1,
  leaderWeight: 0.5,
  accords: true,
  proposeRate: 0.35,
  acceptBias: 0,
  betrayMargin: 3,
  grudge: 70,
  topK: 6,
  saveForLightning: true,
  titleWeight: 1,
};

/** The knobs counted in country value. */
const VALUE_KNOBS = [
  'draftNoise',
  'vpValue',
  'tokenValue',
  'declareThreshold',
  'declareThresholdAtCap',
  'betrayMargin',
] as const satisfies readonly (keyof BotKnobs)[];

/** The knobs for a campaign on this dataset version: those counted in value scaled to its values. */
export function knobsFor(knobs: BotKnobs, datasetVersion: string): BotKnobs {
  const scale = valueScale(datasetVersion);
  if (scale === 1) return knobs;
  const scaled = { ...knobs };
  for (const k of VALUE_KNOBS) scaled[k] = knobs[k] * scale;
  return scaled;
}
