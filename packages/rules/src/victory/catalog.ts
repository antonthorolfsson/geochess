/**
 * Victory missions: the catalog of public and secret missions, the numbers they use (versioned, so
 * playtests can tune them without touching campaigns already underway), and the instantiated
 * parameters ("specs") a campaign stores for each mission it plays with.
 */
import { z } from 'zod';
import type { Pace } from '../config';
import type { Continent, TerritoryId } from '../dataset';

/**
 * - `objectives`: public and secret missions score victory points; the first to 7 wins.
 * - `open`: no fixed end (every campaign before victory missions existed).
 */
export const VICTORY_MODES = ['objectives', 'open'] as const;
export type VictoryMode = (typeof VICTORY_MODES)[number];

export const PUBLIC_MISSION_KINDS = [
  'expansion',
  'regional_power',
  'strategic_positions',
  'great_connection',
  'campaign_veteran',
  'great_powers',
  'across_the_seas',
  'continental_bridge',
  'consolidation',
  'two_fronts',
] as const;
export type PublicMissionKind = (typeof PUBLIC_MISSION_KINDS)[number];

/** Secret missions with a fixed set of named countries. */
export const NAMED_SET_KINDS = [
  'northern_passage',
  'caribbean_chain',
  'pacific_passage',
  'mediterranean_arc',
  'central_asian_union',
] as const;
export type NamedSetKind = (typeof NAMED_SET_KINDS)[number];

export const SECRET_MISSION_KINDS = [
  ...NAMED_SET_KINDS,
  'island_empire',
  'mountain_kingdom',
  'unification',
  'encirclement',
  'hidden_triangle',
  'two_theater_power',
  'protected_expansion',
  /** The documented fallback, offered only when fewer than three other options fit. */
  'measured_expansion',
] as const;
export type SecretMissionKind = (typeof SECRET_MISSION_KINDS)[number];

export type MissionKind = PublicMissionKind | SecretMissionKind;

// ---------------------------------------------------------------------------------------------
// Specs: a mission with its targets and thresholds filled in

export type PublicMissionSpec =
  /** Current total value at least `gain` above the baseline. */
  | { kind: 'expansion'; gain: number }
  /** At least `needValue` of the region's `totalValue`, from at least `minTerritories` of its countries. */
  | {
      kind: 'regional_power';
      region: string;
      territories: TerritoryId[];
      totalValue: number;
      needValue: number;
      minTerritories: number;
    }
  /** Any `need` of the marked positions at once. */
  | { kind: 'strategic_positions'; territories: TerritoryId[]; need: number }
  /** Both endpoints and an unbroken chain of your countries between them. */
  | { kind: 'great_connection'; endpoints: [TerritoryId, TerritoryId] }
  /** Historical: `wins` war victories against `opponents` different players, `attackWins` of them attacking. */
  | { kind: 'campaign_veteran'; wins: number; opponents: number; attackWins: number }
  /** `count` countries worth `minValue` or more, `newCount` of them won since the draft. */
  | { kind: 'great_powers'; minValue: number; count: number; newCount: number }
  /** `count` countries taken in attacks launched across sea lanes, still held. */
  | { kind: 'across_the_seas'; count: number }
  /** One connected block with `perContinent` countries on each of `continents` continents. */
  | { kind: 'continental_bridge'; continents: number; perContinent: number }
  /** `sharePct` of the empire's value in one block holding `newCount` new countries (free drafts). */
  | { kind: 'consolidation'; sharePct: number; newCount: number }
  /** `perContinent` new countries on each of `continents` continents. */
  | { kind: 'two_fronts'; continents: number; perContinent: number };

export type SecretMissionSpec =
  /** Own `need` of the named countries; revealed at `reveal`. */
  | { kind: NamedSetKind; territories: TerritoryId[]; need: number; reveal: number }
  /** Own `need` of the islands, `newCount` of them won since the draft. */
  | { kind: 'island_empire'; territories: TerritoryId[]; need: number; newCount: number }
  /** Own every one of the (three) targets; revealed at `reveal`. */
  | { kind: 'mountain_kingdom' | 'hidden_triangle'; territories: TerritoryId[]; need: number; reveal: number }
  /** Join two marked countries from separate pieces of the drafted empire, through `newCount`+ new countries. */
  | { kind: 'unification'; marks: [TerritoryId, TerritoryId]; newCount: number }
  /** Own every neighbor of `center` while someone else holds it. */
  | { kind: 'encirclement'; center: TerritoryId; ring: TerritoryId[] }
  /** On each continent: `netValue` more than drafted there, and `newCount` new countries. */
  | { kind: 'two_theater_power'; continents: [Continent, Continent]; netValue: number; newCount: number }
  /** Accords with `partners` players holding together `rounds` whole rounds while taking `acquisitions` countries. */
  | { kind: 'protected_expansion'; partners: number; rounds: number; acquisitions: number }
  /** `gain` net value and `newCount` new countries; revealed at `revealGain` and `revealNew`. */
  | { kind: 'measured_expansion'; gain: number; newCount: number; revealGain: number; revealNew: number };

export type MissionSpec = PublicMissionSpec | SecretMissionSpec;
/** The spec of one kind (an intersection, so kinds sharing a shape, like the named sets, narrow too). */
export type SpecOf<K extends MissionKind> = MissionSpec & { kind: K };

const territory = z.string().min(1).max(40);
const count = z.number().int().min(1).max(1000);

/** Public missions live in the campaign's rules, so they are validated whenever rules are read. */
export const publicMissionSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('expansion'), gain: count }),
  z.object({
    kind: z.literal('regional_power'),
    region: z.string().min(1).max(80),
    territories: z.array(territory).min(1).max(80),
    totalValue: count,
    needValue: count,
    minTerritories: count,
  }),
  z.object({ kind: z.literal('strategic_positions'), territories: z.array(territory).min(1).max(12), need: count }),
  z.object({ kind: z.literal('great_connection'), endpoints: z.tuple([territory, territory]) }),
  z.object({ kind: z.literal('campaign_veteran'), wins: count, opponents: count, attackWins: z.number().int().min(0) }),
  z.object({ kind: z.literal('great_powers'), minValue: count, count, newCount: z.number().int().min(0) }),
  z.object({ kind: z.literal('across_the_seas'), count }),
  z.object({ kind: z.literal('continental_bridge'), continents: count, perContinent: count }),
  z.object({ kind: z.literal('consolidation'), sharePct: z.number().int().min(1).max(100), newCount: count }),
  z.object({ kind: z.literal('two_fronts'), continents: count, perContinent: count }),
]);

// ---------------------------------------------------------------------------------------------
// The catalog

/**
 * Secret missions come in three families, and a player's options mix them where possible:
 * holding a region, taking a route or position, and growing (alone or under accords).
 */
export type SecretFamily = 'region' | 'route' | 'expansion';

export interface MissionInfo {
  kind: MissionKind;
  name: string;
  scope: 'public' | 'secret';
  /**
   * - `claim`: a position to hold; it scores once held through the full response window.
   * - `historic`: a record that can't be undone; it scores the moment it's complete.
   */
  timing: 'claim' | 'historic';
  /** Secret missions only. */
  family?: SecretFamily;
  /** The mission tends to take a long campaign. */
  long?: boolean;
  /** Only for free drafts. */
  freeDraftOnly?: boolean;
  /** In a sentence, without targets. */
  summary: string;
}

const info = (m: MissionInfo) => m;

export const MISSIONS: Record<MissionKind, MissionInfo> = {
  expansion: info({
    kind: 'expansion',
    name: 'Expansion',
    scope: 'public',
    timing: 'claim',
    summary: 'Grow your empire’s total value well past what you drafted.',
  }),
  regional_power: info({
    kind: 'regional_power',
    name: 'Regional Power',
    scope: 'public',
    timing: 'claim',
    summary: 'Hold most of the value of one marked region.',
  }),
  strategic_positions: info({
    kind: 'strategic_positions',
    name: 'Strategic Positions',
    scope: 'public',
    timing: 'claim',
    summary: 'Hold any three of five marked countries at once.',
  }),
  great_connection: info({
    kind: 'great_connection',
    name: 'The Great Connection',
    scope: 'public',
    timing: 'claim',
    summary: 'Hold two marked countries and an unbroken chain of yours between them.',
  }),
  campaign_veteran: info({
    kind: 'campaign_veteran',
    name: 'Campaign Veteran',
    scope: 'public',
    timing: 'historic',
    summary: 'Win three wars against more than one opponent, at least one as the attacker.',
  }),
  great_powers: info({
    kind: 'great_powers',
    name: 'Great Powers',
    scope: 'public',
    timing: 'claim',
    summary: 'Hold three of the most valuable countries, two of them won after the draft.',
  }),
  across_the_seas: info({
    kind: 'across_the_seas',
    name: 'Across the Seas',
    scope: 'public',
    timing: 'claim',
    summary: 'Win three attacks launched across sea lanes, and keep what they took.',
  }),
  continental_bridge: info({
    kind: 'continental_bridge',
    name: 'Continental Bridge',
    scope: 'public',
    timing: 'claim',
    long: true,
    summary: 'Hold one connected block spanning three continents.',
  }),
  consolidation: info({
    kind: 'consolidation',
    name: 'Consolidation',
    scope: 'public',
    timing: 'claim',
    freeDraftOnly: true,
    summary: 'Pull a scattered empire together into one block.',
  }),
  two_fronts: info({
    kind: 'two_fronts',
    name: 'Two Fronts',
    scope: 'public',
    timing: 'claim',
    summary: 'Win new ground on two continents.',
  }),
  northern_passage: info({
    kind: 'northern_passage',
    name: 'Northern Passage',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
    summary: 'Hold the North Atlantic crossing, from Canada to the United Kingdom.',
  }),
  caribbean_chain: info({
    kind: 'caribbean_chain',
    name: 'Caribbean Chain',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
    summary: 'Hold the chain of the Greater Antilles.',
  }),
  pacific_passage: info({
    kind: 'pacific_passage',
    name: 'Pacific Passage',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
    summary: 'Hold the South Pacific from Australia to Fiji.',
  }),
  mediterranean_arc: info({
    kind: 'mediterranean_arc',
    name: 'Mediterranean Arc',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
    summary: 'Hold the arc of the western Mediterranean.',
  }),
  central_asian_union: info({
    kind: 'central_asian_union',
    name: 'Central Asian Union',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
    summary: 'Unite most of Central Asia.',
  }),
  island_empire: info({
    kind: 'island_empire',
    name: 'Island Empire',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
    summary: 'Hold four of six marked islands, two of them won after the draft.',
  }),
  mountain_kingdom: info({
    kind: 'mountain_kingdom',
    name: 'Mountain Kingdom',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
    summary: 'Hold three marked mountain countries close together.',
  }),
  unification: info({
    kind: 'unification',
    name: 'Unification',
    scope: 'secret',
    timing: 'claim',
    family: 'route',
    summary: 'Join two separate pieces of your drafted empire.',
  }),
  encirclement: info({
    kind: 'encirclement',
    name: 'Encirclement',
    scope: 'secret',
    timing: 'claim',
    family: 'route',
    summary: 'Surround a marked country held by someone else.',
  }),
  hidden_triangle: info({
    kind: 'hidden_triangle',
    name: 'Hidden Triangle',
    scope: 'secret',
    timing: 'claim',
    family: 'route',
    summary: 'Hold three marked countries lying in different directions from your empire.',
  }),
  two_theater_power: info({
    kind: 'two_theater_power',
    name: 'Two-Theater Power',
    scope: 'secret',
    timing: 'claim',
    family: 'expansion',
    summary: 'Grow on two marked continents at once.',
  }),
  protected_expansion: info({
    kind: 'protected_expansion',
    name: 'Protected Expansion',
    scope: 'secret',
    timing: 'claim',
    family: 'expansion',
    summary: 'Expand while accords with two partners guard your back.',
  }),
  measured_expansion: info({
    kind: 'measured_expansion',
    name: 'Measured Expansion',
    scope: 'secret',
    timing: 'claim',
    family: 'expansion',
    summary: 'Grow steadily past what you drafted.',
  }),
};

export const missionInfo = (kind: MissionKind): MissionInfo => MISSIONS[kind];
export const isPublicKind = (kind: MissionKind): kind is PublicMissionKind => MISSIONS[kind].scope === 'public';

// ---------------------------------------------------------------------------------------------
// The numbers, by version

export interface NamedSetTemplate {
  kind: NamedSetKind;
  /** Dataset ids. A dataset missing any of them doesn't offer the mission. */
  territories: readonly TerritoryId[];
  need: number;
  reveal: number;
}

/**
 * Every threshold and generation limit the missions use. A campaign stores the version it was
 * created with, so changing these (as a new version) never alters campaigns already underway.
 */
export interface MissionRules {
  version: number;
  points: { public: number; secret: number; toWin: number };
  /** Public missions per campaign. */
  publicCount: number;
  defaultPublic: readonly PublicMissionKind[];
  /** Secret options dealt to each player. */
  secretOptions: number;
  /** Least time a claim is held after the next round starts, by pace, in minutes. */
  holdMinutes: Record<Pace, number>;
  /** Time to choose a secret mission, by pace, in minutes. */
  selectionMinutes: Record<Pace, number>;

  expansion: { gain: number };
  regionalPower: {
    sharePct: number;
    minTerritories: number;
    /** Regions with this many countries (inclusive) ... */
    size: readonly [number, number];
    /** ... and this much total value. */
    value: readonly [number, number];
  };
  strategicPositions: {
    count: number;
    need: number;
    /** Positions are worth this much (inclusive) ... */
    value: readonly [number, number];
    /** ... lie within this many steps of a common hub ... */
    radius: number;
    /** ... and at least this many steps from each other. */
    spacing: number;
  };
  greatConnection: { distance: readonly [number, number] };
  campaignVeteran: { wins: number; opponents: number; attackWins: number };
  greatPowers: { minValue: number; count: number; newCount: number };
  acrossTheSeas: { count: number };
  continentalBridge: { continents: number; perContinent: number };
  consolidation: { sharePct: number; newCount: number };
  twoFronts: { continents: number; perContinent: number };

  namedSets: readonly NamedSetTemplate[];
  islandEmpire: { count: number; need: number; newCount: number };
  /** Three mountain countries, each within `spread` steps of the others. */
  mountainKingdom: { count: number; reveal: number; spread: number };
  /** New countries the link between the two marked pieces must need, at least. */
  unification: { newCount: number };
  encirclement: { neighbors: readonly [number, number] };
  /**
   * Targets worth `value`, `distance` conquests away, at least two of them `spreadDegrees` apart
   * as seen from the middle of the empire.
   */
  hiddenTriangle: {
    count: number;
    reveal: number;
    value: readonly [number, number];
    distance: readonly [number, number];
    spreadDegrees: number;
  };
  twoTheater: { netValue: number; newCount: number };
  protectedExpansion: { partners: number; rounds: number; acquisitions: number; minPlayers: number };
  measuredExpansion: { gain: number; newCount: number; revealGain: number; revealNew: number };
  /**
   * Secret options must need at least `min` conquests and at most `max` (targets and the countries
   * in the way), with the nearest target at most `reach` conquests away. `ideal` ranks them.
   */
  effort: { min: number; max: number; ideal: number; reach: number };
  /**
   * How options are ranked: distance from the ideal number of conquests, less these per country in
   * the way, per rival beyond two, and per point of target value beyond `freeValue`, plus up to
   * `jitter` at random so equal options vary.
   */
  fit: { inTheWay: number; rivals: number; value: number; freeValue: number; jitter: number };
  /**
   * How options are drawn from the ranked candidates with the player's private seed: each kind's
   * instance from its `instances` best fits, each family's kind from those that fit at all. The
   * map, the draft and this generator are public, so the best fits alone would let rivals work out
   * a player's options.
   */
  variety: { instances: number };
}

export const MISSION_RULES_V1: MissionRules = {
  version: 1,
  points: { public: 2, secret: 3, toWin: 7 },
  publicCount: 4,
  defaultPublic: ['expansion', 'strategic_positions', 'great_connection', 'campaign_veteran'],
  secretOptions: 3,
  holdMinutes: { live: 10, correspondence: 24 * 60 },
  selectionMinutes: { live: 5, correspondence: 24 * 60 },

  expansion: { gain: 15 },
  regionalPower: { sharePct: 60, minTerritories: 3, size: [5, 12], value: [20, 55] },
  strategicPositions: { count: 5, need: 3, value: [3, 8], radius: 4, spacing: 2 },
  greatConnection: { distance: [4, 6] },
  campaignVeteran: { wins: 3, opponents: 2, attackWins: 1 },
  greatPowers: { minValue: 8, count: 3, newCount: 2 },
  acrossTheSeas: { count: 3 },
  continentalBridge: { continents: 3, perContinent: 2 },
  consolidation: { sharePct: 80, newCount: 2 },
  twoFronts: { continents: 2, perContinent: 2 },

  namedSets: [
    { kind: 'northern_passage', territories: ['CAN', 'GRL', 'ISL', 'GBR'], need: 4, reveal: 3 },
    { kind: 'caribbean_chain', territories: ['CUB', 'HTI', 'DOM', 'PRI'], need: 4, reveal: 3 },
    { kind: 'pacific_passage', territories: ['AUS', 'NZL', 'POLYNESIA', 'FJI'], need: 4, reveal: 3 },
    { kind: 'mediterranean_arc', territories: ['ESP', 'FRA', 'ITA', 'TUN'], need: 4, reveal: 3 },
    { kind: 'central_asian_union', territories: ['KAZ', 'UZB', 'TKM', 'KGZ', 'TJK'], need: 4, reveal: 3 },
  ],
  islandEmpire: { count: 6, need: 4, newCount: 2 },
  mountainKingdom: { count: 3, reveal: 2, spread: 3 },
  unification: { newCount: 2 },
  encirclement: { neighbors: [3, 5] },
  hiddenTriangle: { count: 3, reveal: 2, value: [2, 7], distance: [1, 3], spreadDegrees: 90 },
  twoTheater: { netValue: 8, newCount: 2 },
  protectedExpansion: { partners: 2, rounds: 2, acquisitions: 3, minPlayers: 4 },
  measuredExpansion: { gain: 20, newCount: 3, revealGain: 16, revealNew: 2 },
  effort: { min: 2, max: 7, ideal: 4, reach: 3 },
  fit: { inTheWay: 0.35, rivals: 0.15, value: 0.08, freeValue: 16, jitter: 0.6 },
  variety: { instances: 3 },
};

const MISSION_RULES: Record<number, MissionRules> = { 1: MISSION_RULES_V1 };

/** The mission rules version new campaigns are created with. */
export const CURRENT_MISSION_RULES = MISSION_RULES_V1.version;

/** The numbers a campaign plays with, by the version it stored. */
export function missionRules(version: number): MissionRules {
  const rules = MISSION_RULES[version];
  if (!rules) throw new Error(`Unknown mission rules version: ${version}`);
  return rules;
}

// ---------------------------------------------------------------------------------------------
// Mission slots

/** Public missions are keyed by their slot; each player has one secret mission. */
export const publicMissionKey = (slot: number) => `p${slot}`;
export const SECRET_MISSION_KEY = 'secret';
