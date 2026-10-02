/**
 * Victory missions: the catalog of public and secret missions, the numbers they use (versioned, so
 * playtests can tune them without touching campaigns already underway), and the instantiated
 * parameters ("specs") a campaign stores for each mission it plays with.
 */
import { z } from 'zod';
import type { Pace } from '../config';
import type { Continent, TerritoryId } from '../dataset';
import type { UserId } from '../draft';

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
  'mare_nostrum',
  'one_billion',
  'great_expanse',
  'seven_wonders',
  'kingslayer',
  'lightning_campaign',
] as const;
export type PublicMissionKind = (typeof PUBLIC_MISSION_KINDS)[number];

/** Secret missions with a fixed set of named countries. */
export const NAMED_SET_KINDS = [
  'northern_passage',
  'caribbean_chain',
  'pacific_passage',
  'mediterranean_arc',
  'central_asian_union',
  'black_sea',
  'baltic_league',
  'gulf_hegemon',
  'caspian',
  'nordic',
  'horn_of_africa',
  'andean_spine',
  'mekong',
] as const;
export type NamedSetKind = (typeof NAMED_SET_KINDS)[number];

/** Secret missions to join two named countries with an unbroken chain. */
export const ROUTE_KINDS = ['silk_road', 'cape_to_cairo', 'pan_american_highway'] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

export const SECRET_MISSION_KINDS = [
  ...NAMED_SET_KINDS,
  'island_empire',
  'mountain_kingdom',
  'buffer_zone',
  'unification',
  'encirclement',
  'hidden_triangle',
  ...ROUTE_KINDS,
  'strait_keeper',
  'two_theater_power',
  'protected_expansion',
  'half_of_humanity',
  'nemesis',
  'backstab',
  'iron_wall',
  'checkmate_artist',
  /** The documented fallback, offered only when fewer than three other options fit. */
  'measured_expansion',
] as const;
export type SecretMissionKind = (typeof SECRET_MISSION_KINDS)[number];

export type MissionKind = PublicMissionKind | SecretMissionKind;

// ---------------------------------------------------------------------------------------------
// Specs: a mission with its targets and thresholds filled in

/** One shore of a sea: its name, as in "the European shore", and the countries on it. */
export interface Shore {
  name: string;
  territories: TerritoryId[];
}

/** A strait and the two countries on either side of it. */
export interface Strait {
  name: string;
  shores: [TerritoryId, TerritoryId];
}

/**
 * `needsConquest` (positions, from version 3): the position counts only with at least one of its
 * countries won since the draft, so a draft can't hand it out.
 */
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
      needsConquest?: boolean;
    }
  /** Any `need` of the marked positions at once. */
  | { kind: 'strategic_positions'; territories: TerritoryId[]; need: number; needsConquest?: boolean }
  /** Both endpoints and an unbroken chain of your countries between them (with `needsConquest`, through one won since the draft). */
  | { kind: 'great_connection'; endpoints: [TerritoryId, TerritoryId]; needsConquest?: boolean }
  /**
   * Historical: `wins` war victories against `opponents` different players, `attackWins` of them
   * attacking. With `attackOnly`, only wars won as the attacker count, opponents included.
   */
  | { kind: 'campaign_veteran'; wins: number; opponents: number; attackWins: number; attackOnly?: boolean }
  /** `count` countries worth `minValue` or more, `newCount` of them won since the draft. */
  | { kind: 'great_powers'; minValue: number; count: number; newCount: number }
  /** `count` countries taken in attacks launched across sea lanes, still held. */
  | { kind: 'across_the_seas'; count: number }
  /** One connected block with `perContinent` countries on each of `continents` continents. */
  | { kind: 'continental_bridge'; continents: number; perContinent: number; needsConquest?: boolean }
  /** `sharePct` of the empire's value in one block holding `newCount` new countries (free drafts). */
  | { kind: 'consolidation'; sharePct: number; newCount: number }
  /** `perContinent` new countries on each of `continents` continents. */
  | { kind: 'two_fronts'; continents: number; perContinent: number }
  /** `need` of the countries on the shores, at least `perShore` on each shore. */
  | { kind: 'mare_nostrum'; shores: Shore[]; need: number; perShore: number; needsConquest?: boolean }
  /** Countries won since the draft, still held, home to at least `people` people. */
  | { kind: 'one_billion'; people: number }
  /** Countries won since the draft, still held, covering at least `areaKm2` square kilometers. */
  | { kind: 'great_expanse'; areaKm2: number }
  /** `count` of the marked countries, `newCount` of them won since the draft. */
  | { kind: 'seven_wonders'; territories: TerritoryId[]; count: number; newCount: number }
  /**
   * Historical: a war won as the attacker, declared on a player who led the race while you didn't.
   * The leader is judged on points, then value; with `lead`, on points alone, and only a leader at
   * least `lead` points ahead of you counts.
   */
  | { kind: 'kingslayer'; lead?: number }
  /** Historical: `wins` wars declared in the same round, all won. */
  | { kind: 'lightning_campaign'; wins: number };

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
  | { kind: 'measured_expansion'; gain: number; newCount: number; revealGain: number; revealNew: number }
  /** Both named countries and an unbroken chain of your countries between them. */
  | { kind: RouteKind; endpoints: [TerritoryId, TerritoryId] }
  /** Own every neighbor of `center`, and `center` itself. */
  | { kind: 'buffer_zone'; center: TerritoryId; ring: TerritoryId[] }
  /** Both shores of every marked strait; revealed at `reveal` straits. */
  | { kind: 'strait_keeper'; straits: Strait[]; reveal: number }
  /** Countries home to at least `sharePct`% of the world's people. */
  | { kind: 'half_of_humanity'; sharePct: number }
  /** Hold `count` countries taken from `rival`; revealed at `reveal`. */
  | { kind: 'nemesis'; rival: UserId; count: number; reveal: number }
  /**
   * Historical: break an accord, then take `count` countries (1 if unset) from that partner in wars
   * declared within `rounds` rounds.
   */
  | { kind: 'backstab'; rounds: number; count?: number }
  /** Historical: `wins` wars won as the defender. */
  | { kind: 'iron_wall'; wins: number }
  /** Historical: `wins` wars won by checkmate. */
  | { kind: 'checkmate_artist'; wins: number };

export type MissionSpec = PublicMissionSpec | SecretMissionSpec;
/** The spec of one kind (an intersection, so kinds sharing a shape, like the named sets, narrow too). */
export type SpecOf<K extends MissionKind> = MissionSpec & { kind: K };

const territory = z.string().min(1).max(40);
const count = z.number().int().min(1).max(1000);

/** Public missions live in the campaign's rules, so they are validated whenever rules are read. */
const needsConquest = z.boolean().optional();

export const publicMissionSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('expansion'), gain: count }),
  z.object({
    kind: z.literal('regional_power'),
    region: z.string().min(1).max(80),
    territories: z.array(territory).min(1).max(80),
    totalValue: count,
    needValue: count,
    minTerritories: count,
    needsConquest,
  }),
  z.object({
    kind: z.literal('strategic_positions'),
    territories: z.array(territory).min(1).max(12),
    need: count,
    needsConquest,
  }),
  z.object({ kind: z.literal('great_connection'), endpoints: z.tuple([territory, territory]), needsConquest }),
  z.object({
    kind: z.literal('campaign_veteran'),
    wins: count,
    opponents: count,
    attackWins: z.number().int().min(0),
    attackOnly: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('great_powers'), minValue: count, count, newCount: z.number().int().min(0) }),
  z.object({ kind: z.literal('across_the_seas'), count }),
  z.object({ kind: z.literal('continental_bridge'), continents: count, perContinent: count, needsConquest }),
  z.object({ kind: z.literal('consolidation'), sharePct: z.number().int().min(1).max(100), newCount: count }),
  z.object({ kind: z.literal('two_fronts'), continents: count, perContinent: count }),
  z.object({
    kind: z.literal('mare_nostrum'),
    shores: z
      .array(z.object({ name: z.string().min(1).max(40), territories: z.array(territory).min(1).max(40) }))
      .min(1)
      .max(6),
    need: count,
    perShore: count,
    needsConquest,
  }),
  z.object({ kind: z.literal('one_billion'), people: z.number().int().min(1).max(1e11) }),
  z.object({ kind: z.literal('great_expanse'), areaKm2: z.number().int().min(1).max(2e8) }),
  z.object({
    kind: z.literal('seven_wonders'),
    territories: z.array(territory).min(1).max(12),
    count,
    newCount: z.number().int().min(0),
  }),
  z.object({ kind: z.literal('kingslayer'), lead: count.optional() }),
  z.object({ kind: z.literal('lightning_campaign'), wins: count }),
]);

// ---------------------------------------------------------------------------------------------
// The catalog

/**
 * Secret missions come in families, and a player's options mix them where possible: holding a
 * region, taking a route or position, growing (alone or under accords), and fighting (a rival to
 * beat, an accord to break, battles to win).
 */
export type SecretFamily = 'region' | 'route' | 'expansion' | 'battle';

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
  /** Only for free drafts. */
  freeDraftOnly?: boolean;
}

const info = (m: MissionInfo) => m;

export const MISSIONS: Record<MissionKind, MissionInfo> = {
  expansion: info({
    kind: 'expansion',
    name: 'Expansion',
    scope: 'public',
    timing: 'claim',
  }),
  regional_power: info({
    kind: 'regional_power',
    name: 'Regional Power',
    scope: 'public',
    timing: 'claim',
  }),
  strategic_positions: info({
    kind: 'strategic_positions',
    name: 'Strategic Positions',
    scope: 'public',
    timing: 'claim',
  }),
  great_connection: info({
    kind: 'great_connection',
    name: 'The Great Connection',
    scope: 'public',
    timing: 'claim',
  }),
  campaign_veteran: info({
    kind: 'campaign_veteran',
    name: 'Campaign Veteran',
    scope: 'public',
    timing: 'historic',
  }),
  great_powers: info({
    kind: 'great_powers',
    name: 'Great Powers',
    scope: 'public',
    timing: 'claim',
  }),
  across_the_seas: info({
    kind: 'across_the_seas',
    name: 'Across the Seas',
    scope: 'public',
    timing: 'claim',
  }),
  continental_bridge: info({
    kind: 'continental_bridge',
    name: 'Continental Bridge',
    scope: 'public',
    timing: 'claim',
  }),
  consolidation: info({
    kind: 'consolidation',
    name: 'Consolidation',
    scope: 'public',
    timing: 'claim',
    freeDraftOnly: true,
  }),
  two_fronts: info({
    kind: 'two_fronts',
    name: 'Two Fronts',
    scope: 'public',
    timing: 'claim',
  }),
  mare_nostrum: info({
    kind: 'mare_nostrum',
    name: 'Mare Nostrum',
    scope: 'public',
    timing: 'claim',
  }),
  one_billion: info({
    kind: 'one_billion',
    name: 'One Billion',
    scope: 'public',
    timing: 'claim',
  }),
  great_expanse: info({
    kind: 'great_expanse',
    name: 'Great Expanse',
    scope: 'public',
    timing: 'claim',
  }),
  seven_wonders: info({
    kind: 'seven_wonders',
    name: 'Seven Wonders',
    scope: 'public',
    timing: 'claim',
  }),
  kingslayer: info({
    kind: 'kingslayer',
    name: 'Kingslayer',
    scope: 'public',
    timing: 'historic',
  }),
  lightning_campaign: info({
    kind: 'lightning_campaign',
    name: 'Lightning Campaign',
    scope: 'public',
    timing: 'historic',
  }),
  northern_passage: info({
    kind: 'northern_passage',
    name: 'Northern Passage',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  caribbean_chain: info({
    kind: 'caribbean_chain',
    name: 'Caribbean Chain',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  pacific_passage: info({
    kind: 'pacific_passage',
    name: 'Pacific Passage',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  mediterranean_arc: info({
    kind: 'mediterranean_arc',
    name: 'Mediterranean Arc',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  central_asian_union: info({
    kind: 'central_asian_union',
    name: 'Central Asian Union',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  black_sea: info({
    kind: 'black_sea',
    name: 'Black Sea',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  baltic_league: info({
    kind: 'baltic_league',
    name: 'Baltic League',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  gulf_hegemon: info({
    kind: 'gulf_hegemon',
    name: 'Gulf Hegemon',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  caspian: info({
    kind: 'caspian',
    name: 'Caspian',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  nordic: info({
    kind: 'nordic',
    name: 'Nordic',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  horn_of_africa: info({
    kind: 'horn_of_africa',
    name: 'Horn of Africa',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  andean_spine: info({
    kind: 'andean_spine',
    name: 'Andean Spine',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  mekong: info({
    kind: 'mekong',
    name: 'Mekong',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  island_empire: info({
    kind: 'island_empire',
    name: 'Island Empire',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  mountain_kingdom: info({
    kind: 'mountain_kingdom',
    name: 'Mountain Kingdom',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  unification: info({
    kind: 'unification',
    name: 'Unification',
    scope: 'secret',
    timing: 'claim',
    family: 'route',
  }),
  encirclement: info({
    kind: 'encirclement',
    name: 'Encirclement',
    scope: 'secret',
    timing: 'claim',
    family: 'route',
  }),
  hidden_triangle: info({
    kind: 'hidden_triangle',
    name: 'Hidden Triangle',
    scope: 'secret',
    timing: 'claim',
    family: 'route',
  }),
  two_theater_power: info({
    kind: 'two_theater_power',
    name: 'Two-Theater Power',
    scope: 'secret',
    timing: 'claim',
    family: 'expansion',
  }),
  protected_expansion: info({
    kind: 'protected_expansion',
    name: 'Protected Expansion',
    scope: 'secret',
    timing: 'claim',
    family: 'expansion',
  }),
  measured_expansion: info({
    kind: 'measured_expansion',
    name: 'Measured Expansion',
    scope: 'secret',
    timing: 'claim',
    family: 'expansion',
  }),
  buffer_zone: info({
    kind: 'buffer_zone',
    name: 'Buffer Zone',
    scope: 'secret',
    timing: 'claim',
    family: 'region',
  }),
  silk_road: info({
    kind: 'silk_road',
    name: 'Silk Road',
    scope: 'secret',
    timing: 'claim',
    family: 'route',
  }),
  cape_to_cairo: info({
    kind: 'cape_to_cairo',
    name: 'Cape to Cairo',
    scope: 'secret',
    timing: 'claim',
    family: 'route',
  }),
  pan_american_highway: info({
    kind: 'pan_american_highway',
    name: 'Pan-American Highway',
    scope: 'secret',
    timing: 'claim',
    family: 'route',
  }),
  strait_keeper: info({
    kind: 'strait_keeper',
    name: 'Strait Keeper',
    scope: 'secret',
    timing: 'claim',
    family: 'route',
  }),
  half_of_humanity: info({
    kind: 'half_of_humanity',
    name: 'Half of Humanity',
    scope: 'secret',
    timing: 'claim',
    family: 'expansion',
  }),
  nemesis: info({
    kind: 'nemesis',
    name: 'Nemesis',
    scope: 'secret',
    timing: 'claim',
    family: 'battle',
  }),
  backstab: info({
    kind: 'backstab',
    name: 'Backstab',
    scope: 'secret',
    timing: 'historic',
    family: 'battle',
  }),
  iron_wall: info({
    kind: 'iron_wall',
    name: 'Iron Wall',
    scope: 'secret',
    timing: 'historic',
    family: 'battle',
  }),
  checkmate_artist: info({
    kind: 'checkmate_artist',
    name: 'Checkmate Artist',
    scope: 'secret',
    timing: 'historic',
    family: 'battle',
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

export interface RouteTemplate {
  kind: RouteKind;
  /** Dataset ids. A dataset missing either doesn't offer the mission. */
  endpoints: readonly [TerritoryId, TerritoryId];
}

export interface StraitTemplate {
  name: string;
  /** Dataset ids of the countries on either side; they must border each other on the map. */
  shores: readonly [TerritoryId, TerritoryId];
}

/**
 * Every threshold and generation limit the missions use. A campaign stores the version it was
 * created with, so changing these (as a new version) never alters campaigns already underway.
 */
export interface MissionRules {
  version: number;
  points: { public: number; secret: number; toWin: number };
  /** The public missions this version offers the host. */
  publicKinds: readonly PublicMissionKind[];
  /** The secret missions this version deals (Measured Expansion only ever as the fallback). */
  secretKinds: readonly SecretMissionKind[];
  /**
   * The families a player's options are drawn from, one each where possible. When there are more
   * families than options, the order they're drawn in comes from the player's seed.
   */
  families: readonly SecretFamily[];
  /** Public missions per campaign. */
  publicCount: number;
  defaultPublic: readonly PublicMissionKind[];
  /** Public missions only for tables of up to this many players: at bigger ones they're broken before they can be held. */
  maxPlayers: Partial<Record<PublicMissionKind, number>>;
  /**
   * Missions that take a long campaign (rarely done, and late), marked as such in the lobby. A
   * random draw of public missions takes at most `longDrawn` of them.
   */
  long: readonly MissionKind[];
  longDrawn: number;
  /**
   * Strategic Positions, Regional Power, The Great Connection, Continental Bridge and Mare Nostrum
   * count only with at least one country of the position won since the draft.
   */
  positionsNeedConquest: boolean;
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
  /**
   * Countries between the two endpoints on the shortest chain (inclusive), by land or sea lane.
   * Such a chain must also exist without crossing the edge of the map.
   */
  greatConnection: { between: readonly [number, number] };
  /** With `attackOnly`, only wars won as the attacker count. */
  campaignVeteran: { wins: number; opponents: number; attackWins: number; attackOnly?: boolean };
  greatPowers: { minValue: number; count: number; newCount: number };
  acrossTheSeas: { count: number };
  continentalBridge: { continents: number; perContinent: number };
  consolidation: { sharePct: number; newCount: number };
  twoFronts: { continents: number; perContinent: number };
  mareNostrum: {
    shores: readonly { name: string; territories: readonly TerritoryId[] }[];
    need: number;
    perShore: number;
  };
  oneBillion: { people: number };
  greatExpanse: { areaKm2: number };
  sevenWonders: { territories: readonly TerritoryId[]; count: number; newCount: number };
  lightningCampaign: { wins: number };
  /** Without a `lead`, the leader is judged on points, then value, and any lead will do. */
  kingslayer: { lead?: number };

  namedSets: readonly NamedSetTemplate[];
  routes: readonly RouteTemplate[];
  /** The straits Strait Keeper chooses from. */
  straits: readonly StraitTemplate[];
  /** `count` straits, revealed once both shores of `reveal` of them are held. */
  straitKeeper: { count: number; reveal: number };
  /** The marked country has this many neighbors (inclusive). */
  bufferZone: { neighbors: readonly [number, number] };
  halfOfHumanity: { sharePct: number };
  nemesis: { count: number; reveal: number };
  /** Rounds after the one the accord is broken in, and countries to take from the partner (one if unset). */
  backstab: { rounds: number; count?: number };
  /** Dealt only with `minPlayers` or more: a lone rival can deny it by never attacking. */
  ironWall: { wins: number; minPlayers: number };
  checkmateArtist: { wins: number };
  islandEmpire: { count: number; need: number; newCount: number };
  /** `need` of three mountain countries, each within `spread` steps of the others. */
  mountainKingdom: { count: number; need: number; reveal: number; spread: number };
  /** New countries the link between the two marked pieces must need, at least. */
  unification: { newCount: number };
  encirclement: { neighbors: readonly [number, number] };
  /**
   * `need` of `count` targets worth `value`, `distance` conquests away, at least two of them
   * `spreadDegrees` apart as seen from the middle of the empire.
   */
  hiddenTriangle: {
    count: number;
    need: number;
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

/**
 * Version 1 offers the first catalog. The numbers for the missions version 2 added are here too,
 * so both versions share them, but version 1 never offers those missions.
 */
export const MISSION_RULES_V1: MissionRules = {
  version: 1,
  points: { public: 2, secret: 3, toWin: 7 },
  publicKinds: [
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
  ],
  secretKinds: [
    'northern_passage',
    'caribbean_chain',
    'pacific_passage',
    'mediterranean_arc',
    'central_asian_union',
    'island_empire',
    'mountain_kingdom',
    'unification',
    'encirclement',
    'hidden_triangle',
    'two_theater_power',
    'protected_expansion',
    'measured_expansion',
  ],
  families: ['region', 'route', 'expansion'],
  publicCount: 4,
  defaultPublic: ['expansion', 'strategic_positions', 'great_connection', 'campaign_veteran'],
  maxPlayers: {},
  long: ['continental_bridge', 'mare_nostrum', 'pan_american_highway'],
  longDrawn: 4,
  positionsNeedConquest: false,
  secretOptions: 3,
  holdMinutes: { live: 10, correspondence: 24 * 60 },
  selectionMinutes: { live: 5, correspondence: 24 * 60 },

  expansion: { gain: 15 },
  regionalPower: { sharePct: 60, minTerritories: 3, size: [5, 12], value: [20, 55] },
  strategicPositions: { count: 5, need: 3, value: [3, 8], radius: 4, spacing: 2 },
  greatConnection: { between: [6, 10] },
  campaignVeteran: { wins: 3, opponents: 2, attackWins: 1 },
  greatPowers: { minValue: 8, count: 3, newCount: 2 },
  acrossTheSeas: { count: 3 },
  continentalBridge: { continents: 3, perContinent: 2 },
  consolidation: { sharePct: 80, newCount: 2 },
  twoFronts: { continents: 2, perContinent: 2 },
  mareNostrum: {
    shores: [
      { name: 'European', territories: ['ESP', 'FRA', 'ITA', 'MLT', 'SVN', 'HRV', 'BIH', 'MNE', 'ALB', 'GRC'] },
      { name: 'African', territories: ['MAR', 'DZA', 'TUN', 'LBY', 'EGY'] },
      { name: 'eastern', territories: ['TUR', 'CYP', 'SYR', 'LBN', 'ISR', 'PSE'] },
    ],
    need: 12,
    perShore: 3,
  },
  oneBillion: { people: 1_000_000_000 },
  greatExpanse: { areaKm2: 7_500_000 },
  sevenWonders: { territories: ['CHN', 'JOR', 'BRA', 'PER', 'MEX', 'ITA', 'IND', 'EGY'], count: 3, newCount: 2 },
  lightningCampaign: { wins: 2 },
  kingslayer: {},

  namedSets: [
    { kind: 'northern_passage', territories: ['CAN', 'GRL', 'ISL', 'GBR'], need: 4, reveal: 3 },
    { kind: 'caribbean_chain', territories: ['CUB', 'HTI', 'DOM', 'PRI'], need: 4, reveal: 3 },
    { kind: 'pacific_passage', territories: ['AUS', 'NZL', 'POLYNESIA', 'FJI'], need: 4, reveal: 3 },
    { kind: 'mediterranean_arc', territories: ['ESP', 'FRA', 'ITA', 'TUN'], need: 4, reveal: 3 },
    { kind: 'central_asian_union', territories: ['KAZ', 'UZB', 'TKM', 'KGZ', 'TJK'], need: 4, reveal: 3 },
  ],
  routes: [
    { kind: 'silk_road', endpoints: ['CHN', 'ITA'] },
    { kind: 'cape_to_cairo', endpoints: ['ZAF', 'EGY'] },
    { kind: 'pan_american_highway', endpoints: ['USA', 'CHL'] },
  ],
  straits: [
    { name: 'Strait of Gibraltar', shores: ['ESP', 'MAR'] },
    { name: 'Strait of Dover', shores: ['FRA', 'GBR'] },
    { name: 'Øresund', shores: ['DNK', 'SWE'] },
    { name: 'Strait of Sicily', shores: ['ITA', 'TUN'] },
    { name: 'Bab-el-Mandeb', shores: ['DJI', 'YEM'] },
    { name: 'Strait of Hormuz', shores: ['IRN', 'OMN'] },
    { name: 'Palk Strait', shores: ['IND', 'LKA'] },
    { name: 'Singapore Strait', shores: ['IDN', 'SGP'] },
    { name: 'Taiwan Strait', shores: ['CHN', 'TWN'] },
    { name: 'Korea Strait', shores: ['JPN', 'KOR'] },
    { name: 'Bering Strait', shores: ['RUS', 'USA'] },
    { name: 'Straits of Florida', shores: ['CUB', 'USA'] },
  ],
  straitKeeper: { count: 3, reveal: 2 },
  bufferZone: { neighbors: [3, 6] },
  halfOfHumanity: { sharePct: 50 },
  nemesis: { count: 3, reveal: 2 },
  backstab: { rounds: 2 },
  ironWall: { wins: 2, minPlayers: 2 },
  checkmateArtist: { wins: 2 },
  islandEmpire: { count: 6, need: 4, newCount: 2 },
  mountainKingdom: { count: 3, need: 3, reveal: 2, spread: 3 },
  unification: { newCount: 2 },
  encirclement: { neighbors: [3, 5] },
  hiddenTriangle: { count: 3, need: 3, reveal: 2, value: [2, 7], distance: [1, 3], spreadDegrees: 90 },
  twoTheater: { netValue: 8, newCount: 2 },
  protectedExpansion: { partners: 2, rounds: 2, acquisitions: 3, minPlayers: 4 },
  measuredExpansion: { gain: 20, newCount: 3, revealGain: 16, revealNew: 2 },
  effort: { min: 2, max: 7, ideal: 4, reach: 3 },
  fit: { inTheWay: 0.35, rivals: 0.15, value: 0.08, freeValue: 16, jitter: 0.6 },
  variety: { instances: 3 },
};

/**
 * Version 2 adds six public missions (Mare Nostrum, One Billion, Great Expanse, Seven Wonders,
 * Kingslayer, Lightning Campaign), eight named regions and seas, three routes, and the secret
 * missions of a fourth family, battle.
 */
export const MISSION_RULES_V2: MissionRules = {
  ...MISSION_RULES_V1,
  version: 2,
  publicKinds: PUBLIC_MISSION_KINDS,
  secretKinds: SECRET_MISSION_KINDS,
  families: ['region', 'route', 'expansion', 'battle'],
  namedSets: [
    ...MISSION_RULES_V1.namedSets,
    { kind: 'black_sea', territories: ['TUR', 'BGR', 'ROU', 'UKR', 'RUS', 'GEO'], need: 5, reveal: 4 },
    {
      kind: 'baltic_league',
      territories: ['DNK', 'DEU', 'POL', 'LTU', 'LVA', 'EST', 'RUS', 'FIN', 'SWE'],
      need: 6,
      reveal: 5,
    },
    { kind: 'gulf_hegemon', territories: ['IRN', 'IRQ', 'KWT', 'SAU', 'BHR', 'QAT', 'ARE', 'OMN'], need: 5, reveal: 4 },
    { kind: 'caspian', territories: ['RUS', 'KAZ', 'TKM', 'IRN', 'AZE'], need: 4, reveal: 3 },
    { kind: 'nordic', territories: ['NOR', 'SWE', 'FIN', 'DNK'], need: 4, reveal: 3 },
    { kind: 'horn_of_africa', territories: ['ETH', 'ERI', 'DJI', 'SOM'], need: 4, reveal: 3 },
    { kind: 'andean_spine', territories: ['COL', 'ECU', 'PER', 'BOL', 'CHL'], need: 4, reveal: 3 },
    { kind: 'mekong', territories: ['MMR', 'THA', 'LAO', 'KHM', 'VNM'], need: 4, reveal: 3 },
  ],
};

/**
 * Version 3 follows the balance simulation (docs/balance-report.md), which found campaigns won by
 * round 6 to 9 instead of 15 to 25:
 * - Records are harder: Campaign Veteran counts only wars won as the attacker, Kingslayer only a
 *   leader four points ahead, and the battle secrets need more wins (Iron Wall is dealt only from
 *   four players: with fewer, a rival can deny it by never attacking).
 * - Giants are bigger: one huge country no longer completes Great Expanse or One Billion (now two
 *   billion), and Great Powers needs all three won.
 * - Positions need a conquest, so a draft can't hand them out; The Great Connection and Mare
 *   Nostrum are only for four players or fewer, and Great Powers replaces the former as a default.
 * - Across the Seas, and region and route secrets, which were rarely done, are easier.
 * - A random draw takes at most one mission that makes for a long campaign.
 * The season's last round, the other half of the fix, is a host setting (`victory.lastRound`).
 */
export const MISSION_RULES_V3: MissionRules = {
  ...MISSION_RULES_V2,
  version: 3,
  defaultPublic: ['expansion', 'strategic_positions', 'great_powers', 'campaign_veteran'],
  maxPlayers: { great_connection: 4, mare_nostrum: 4 },
  // Scored by a fifth of players or fewer in the simulator (Continental Bridge at bigger tables),
  // and the secrets done least: chains and rings.
  long: [
    'great_connection',
    'mare_nostrum',
    'consolidation',
    'regional_power',
    'strategic_positions',
    'seven_wonders',
    'one_billion',
    'continental_bridge',
    'silk_road',
    'cape_to_cairo',
    'pan_american_highway',
    'encirclement',
    'unification',
  ],
  longDrawn: 1,
  positionsNeedConquest: true,

  campaignVeteran: { wins: 4, opponents: 3, attackWins: 4, attackOnly: true },
  greatPowers: { minValue: 8, count: 3, newCount: 3 },
  acrossTheSeas: { count: 2 },
  oneBillion: { people: 2_000_000_000 },
  greatExpanse: { areaKm2: 20_000_000 },
  kingslayer: { lead: 4 },

  // Region and route secrets: half the countries (at least two), revealed only once complete.
  namedSets: MISSION_RULES_V2.namedSets.map((t) => {
    const need = Math.max(2, Math.ceil(t.territories.length / 2));
    return { ...t, need, reveal: need };
  }),
  mountainKingdom: { count: 3, need: 2, reveal: 2, spread: 3 },
  hiddenTriangle: { ...MISSION_RULES_V2.hiddenTriangle, need: 2, reveal: 2, distance: [1, 2] },
  straitKeeper: { count: 1, reveal: 1 },
  islandEmpire: { count: 6, need: 3, newCount: 2 },

  nemesis: { count: 4, reveal: 3 },
  backstab: { rounds: 2, count: 2 },
  ironWall: { wins: 3, minPlayers: 4 },
  checkmateArtist: { wins: 3 },
};

const MISSION_RULES: Record<number, MissionRules> = { 1: MISSION_RULES_V1, 2: MISSION_RULES_V2, 3: MISSION_RULES_V3 };

/** The mission rules version new campaigns are created with. */
export const CURRENT_MISSION_RULES = MISSION_RULES_V3.version;

/** Versions from here up hold numbers the simulator tries out; no campaign is created with one. */
export const TRIAL_MISSION_RULES_FROM = 100;

/** Makes trial numbers readable under their version, so generation and evaluation use them like any other. */
export function registerTrialMissionRules(rules: MissionRules): void {
  if (rules.version < TRIAL_MISSION_RULES_FROM) {
    throw new Error(`Trial mission rules need a version of ${TRIAL_MISSION_RULES_FROM} or more`);
  }
  MISSION_RULES[rules.version] = rules;
}

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
