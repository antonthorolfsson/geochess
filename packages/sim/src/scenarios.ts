/**
 * Named campaign setups for the simulator's runs. A scenario is a base configuration; a run crosses
 * it with player counts, paces and seeds.
 */
import {
  CURRENT_MISSION_RULES,
  DEFAULT_LAST_ROUND,
  secretCandidates,
  seededRandom,
  shuffled,
  type DatasetIndex,
  type SecretMissionKind,
  type SecretOption,
} from '@empire/rules';
import { makeBots } from './bots';
import { DEFAULT_KNOBS, knobsFor, type BotKnobs } from './bots/knobs';
import { DEFAULT_CHESS } from './engine/chess';
import { runCampaign } from './engine/engine';
import type { SecretChooser } from './engine/lifecycle';
import type { SimConfig, SimState } from './engine/types';
import { missionWorld } from './engine/world';
import { hashSeed } from './random';
import { VARIANTS } from './variants-catalog';

/** Live wars finish in the round they're declared; correspondence wars often run on. */
export const LATENCY = { live: [1], correspondence: [0.2, 0.5, 0.3] } as const;

export type ConfigOverrides = Omit<Partial<SimConfig>, 'bots'> & { bots?: Partial<BotKnobs> };

export function baseConfig(overrides: ConfigOverrides = {}): SimConfig {
  const { bots, ...rest } = overrides;
  const pace = rest.pace ?? 'live';
  return {
    scenario: 'custom',
    players: 4,
    draftMode: 'contiguous',
    publics: 'default',
    pace,
    latency: LATENCY[pace],
    waves: 2,
    mode: 'normal',
    roundCap: 40,
    missionVersion: CURRENT_MISSION_RULES,
    dataset: null,
    lastRound: DEFAULT_LAST_ROUND,
    war: {},
    chess: DEFAULT_CHESS,
    elo: { kind: 'equal' },
    variant: null,
    debug: false,
    trace: false,
    ...rest,
    bots: { ...DEFAULT_KNOBS, ...bots },
  };
}

interface Scenario {
  description: string;
  config: ConfigOverrides;
}

const chess = (patch: Partial<SimConfig['chess']>): SimConfig['chess'] => ({ ...DEFAULT_CHESS, ...patch });

export const SCENARIOS: Record<string, Scenario> = {
  baseline: {
    description: 'Contiguous draft, the default public missions, mission-seeking bots, equal players.',
    config: {},
  },
  'titles-blind': {
    description: 'The baseline with bots that never fight for a title (for the titles what-ifs).',
    config: { bots: { titleWeight: 0 } },
  },
  random: {
    description: 'Contiguous draft with the public missions drawn at random, played to a win.',
    config: { publics: 'random' },
  },
  publics: {
    description: 'Public missions drawn at random, played to round 25 without ending, to measure each one.',
    config: { publics: 'random', mode: 'horizon', roundCap: 25 },
  },
  free: {
    description: 'Free draft with random public missions (Consolidation can come up).',
    config: { draftMode: 'free', publics: 'random' },
  },
  'hot-publics': {
    description:
      'The four public missions that score soonest (Kingslayer, Great Expanse, One Billion, Great Powers), played to round 25.',
    config: { publics: ['kingslayer', 'great_expanse', 'one_billion', 'great_powers'], mode: 'horizon', roundCap: 25 },
  },
  'cold-publics': {
    description:
      'Four public missions that rarely score (Great Connection, Mare Nostrum, Regional Power, Across the Seas), played to round 25.',
    config: {
      publics: ['mare_nostrum', 'regional_power', 'great_connection', 'across_the_seas'],
      mode: 'horizon',
      roundCap: 25,
    },
  },
  secrets: {
    description: 'Each player assigned a different secret mission that fits them, to measure each kind.',
    config: { bots: { secretChoice: 'forced' } },
  },
  greedy: {
    description: 'Bots that play on value alone: what gets completed by accident.',
    config: { bots: { policy: 'greedy' } },
  },
  'choice-rank1': {
    description: 'Players take the best fit (as when the time runs out).',
    config: { bots: { secretChoice: 'rank1' } },
  },
  'choice-random': {
    description: 'Players pick a secret option at random.',
    config: { bots: { secretChoice: 'random' } },
  },
  'draft-greedy': { description: 'Drafting on value alone, like auto-draft.', config: { bots: { draft: 'greedy' } } },
  'draft-heavy': { description: 'Drafting hard for public targets.', config: { bots: { draftMissionWeight: 2 } } },
  'raise-never': { description: 'Defenders never raise.', config: { bots: { raiseRate: 0 } } },
  'raise-always': { description: 'Defenders raise whenever it pays.', config: { bots: { raiseRate: 1 } } },
  'no-blocking': {
    description: 'Nobody goes out of their way to break claims or hit the leader.',
    config: { bots: { blockWeight: 0, leaderWeight: 0 } },
  },
  'high-blocking': {
    description: 'Everyone gangs up on claims and the leader.',
    config: { bots: { blockWeight: 2, leaderWeight: 1.5 } },
  },
  'no-accords': { description: 'Nobody signs accords.', config: { bots: { accords: false } } },
  treacherous: {
    description: 'Accords broken at the first good opportunity.',
    config: { bots: { betrayMargin: 0.5 } },
  },
  aggressive: {
    description: 'Bots declare readily.',
    config: { bots: { declareThreshold: -0.5, declareThresholdAtCap: -2 } },
  },
  cautious: {
    description: 'Bots declare only for clear gains.',
    config: { bots: { declareThreshold: 1.5, declareThresholdAtCap: 0 } },
  },
  'mate-15': { description: '15% of decisive games end in mate.', config: { chess: chess({ mateShare: 0.15 }) } },
  'mate-45': { description: '45% of decisive games end in mate.', config: { chess: chess({ mateShare: 0.45 }) } },
  'mate-denial': {
    description: 'Rivals resign rather than be mated by a revealed Checkmate Artist.',
    config: { chess: chess({ mateDenial: 0.7 }) },
  },
  'draw-4': { description: '4% of games drawn.', config: { chess: chess({ drawRate: 0.04 }) } },
  'draw-12': { description: '12% of games drawn.', config: { chess: chess({ drawRate: 0.12 }) } },
  'white-0': { description: 'No edge for White.', config: { chess: chess({ whiteElo: 0 }) } },
  'white-35': { description: 'White worth 35 Elo.', config: { chess: chess({ whiteElo: 35 }) } },
  'time-0': { description: 'Clock modifiers make no difference.', config: { chess: chess({ eloPerTimePct: 0 }) } },
  'time-3': { description: 'Clock modifiers count double.', config: { chess: chess({ eloPerTimePct: 3 }) } },
  'elo-150': { description: 'Ratings spread with sd 150.', config: { elo: { kind: 'spread', sd: 150 } } },
  'elo-300': { description: 'Ratings spread with sd 300.', config: { elo: { kind: 'spread', sd: 300 } } },
  'elo-star': { description: 'One player 300 points stronger.', config: { elo: { kind: 'star', bonus: 300 } } },
  'elo-300-light': {
    description: 'Ratings spread with sd 300, with a light rating handicap.',
    config: { elo: { kind: 'spread', sd: 300 }, war: { handicap: 'light' } },
  },
  'elo-300-full': {
    description: 'Ratings spread with sd 300, with a full rating handicap.',
    config: { elo: { kind: 'spread', sd: 300 }, war: { handicap: 'full' } },
  },
  'elo-star-full': {
    description: 'One player 300 points stronger, with a full rating handicap.',
    config: { elo: { kind: 'star', bonus: 300 }, war: { handicap: 'full' } },
  },
  armageddon: { description: 'Drawn wars go to Armageddon.', config: { war: { draws: 'armageddon' } } },
  'vp-10': {
    description: 'Players who value a victory point at 10 country value instead of 4: more mission-driven.',
    config: { bots: { vpValue: 10 } },
  },
  'waves-1': { description: 'One declaration wave per round.', config: { waves: 1 } },
  'waves-3': { description: 'Three declaration waves per round.', config: { waves: 3 } },
  'values-10': {
    description:
      'Dataset 2026.1, with country values 1-10, and mission rules version 3: what campaigns created before 2 October 2026 play.',
    config: { dataset: '2026.1', missionVersion: 3 },
  },
};

/** A scenario's configuration (or a what-if variant's, as `whatif:<name>`), with overrides. */
export function scenarioConfig(name: string, overrides: ConfigOverrides = {}): SimConfig {
  if (name.startsWith('whatif:')) {
    const variant = VARIANTS[name.slice('whatif:'.length)];
    if (!variant) throw new Error(`Unknown variant: ${name}`);
    const base = SCENARIOS[variant.scenario ?? 'baseline']!.config;
    return baseConfig({
      ...base,
      ...overrides,
      scenario: name,
      variant: variant.variant,
      bots: { ...base.bots, ...overrides.bots },
    });
  }
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown scenario: ${name}`);
  return baseConfig({
    ...scenario.config,
    ...overrides,
    scenario: name,
    bots: { ...scenario.config.bots, ...overrides.bots },
  });
}

/**
 * Forced assignment: each player gets a different secret kind among those that fit them (as the
 * dealer judges fit), taken in a random order of kinds per campaign, so across many campaigns every
 * kind is held by players it fits, whatever a chooser would prefer.
 */
export function forcedChooser(seed: number): SecretChooser {
  const assigned = new Set<SecretMissionKind>();
  let order: SecretMissionKind[] | null = null;
  return (s: SimState, player): SecretOption | null => {
    order ??= shuffled(
      s.mr.secretKinds.filter((k) => k !== 'measured_expansion'),
      seededRandom(hashSeed(`${seed}:forced`)),
    );
    const candidates = secretCandidates(
      missionWorld(s),
      player.id,
      s.rules,
      seededRandom(hashSeed(`${seed}:forced:${player.id}`)),
    );
    const pick =
      order.map((kind) => candidates.find((c) => c.spec.kind === kind && !assigned.has(kind))).find(Boolean) ??
      candidates[0];
    if (!pick) return null;
    assigned.add(pick.spec.kind as SecretMissionKind);
    player.forced = true;
    return { id: 'forced', rank: 0, spec: pick.spec, estimate: pick.estimate };
  };
}

export function runScenarioCampaign(cfg: SimConfig, seed: number, idx: DatasetIndex): SimState {
  const chooser = cfg.bots.secretChoice === 'forced' ? forcedChooser(seed) : undefined;
  return runCampaign(cfg, seed, { bots: makeBots(knobsFor(cfg.bots, idx.dataset.version), chooser), idx });
}
