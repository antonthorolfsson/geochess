/**
 * The static country dataset. Built and versioned by `@empire/data`; each campaign
 * snapshots the dataset version it started with.
 */

/** Stable identifier: an ISO 3166-1 alpha-3 code for countries, or a descriptive code for regions (e.g. "LEEWARD"). */
export type TerritoryId = string;

export type LonLat = [lon: number, lat: number];

export type Continent = 'africa' | 'asia' | 'europe' | 'north-america' | 'south-america' | 'oceania';

export type Terrain = 'mountains' | 'island';

/**
 * - `country`: a sovereign state (possibly with enclaves or crown dependencies merged in).
 * - `territory`: a dependency or disputed territory played on its own (e.g. Greenland, Taiwan).
 * - `region`: a bundle of microstates played as one (e.g. the Windward Islands).
 */
export type TerritoryKind = 'country' | 'territory' | 'region';

export const STAT_KEYS = [
  'population',
  'areaKm2',
  'gdpNominalUsd',
  'gdpPppUsd',
  'militarySpendingUsd',
  'armedForces',
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

/** Real-world figures. `null` when no source or estimate is available. */
export type RealStats = Record<StatKey, number | null>;

export interface StatMeta {
  /** Data year of the figure, when known. */
  year: number | null;
  /** True when the figure is an estimate or computed, rather than taken from the primary source. */
  estimated: boolean;
  /** Human-readable source, e.g. "World Bank WDI" or "Estimate: IMF WEO Apr 2025". */
  source: string;
}

export interface Territory {
  id: TerritoryId;
  /** Neutral display name. */
  name: string;
  kind: TerritoryKind;
  /** Source entities folded into this territory (bundled microstates, merged enclaves). Empty if none. */
  members: { id: string; name: string }[];
  continent: Continent;
  /** UN geoscheme subregion, e.g. "Western Europe". */
  subregion: string;
  /** Game value, an integer from 1 to 20 (1 to 10 before dataset 2026.2). */
  value: number;
  /** Land neighbors, sorted. */
  land: TerritoryId[];
  /** Neighbors across a designated sea lane, sorted. Disjoint from `land`. */
  sea: TerritoryId[];
  terrain: Terrain[];
  /** Too small to tap on a world map; rendered with a dot. */
  micro: boolean;
  /** Label and dot position. */
  anchor: LonLat;
  stats: RealStats;
  statMeta: Record<StatKey, StatMeta>;
}

export interface SeaLane {
  a: TerritoryId;
  b: TerritoryId;
  /**
   * Where the lane is drawn: `from` on the coast of `a`, `to` on the coast of `b`. Usually the
   * closest coastal points; hand-placed lanes may use other points for a clearer crossing.
   */
  from: LonLat;
  to: LonLat;
  /** Great-circle distance between `from` and `to`. */
  km: number;
  /** True when added by hand in the sea lane config rather than found by proximity. */
  manual: boolean;
}

export interface Dataset {
  /** Dataset version, e.g. "2026.1". */
  version: string;
  generatedAt: string;
  /** Required attributions for the underlying data. */
  attribution: string[];
  /** Sorted by id. */
  territories: Territory[];
  seaLanes: SeaLane[];
}

/** The highest game value a territory can have. */
export const MAX_VALUE = 20;

/**
 * Each dataset's value scale against 2026.1's, whose values run 1 to 10. From 2026.2 they run 1 to
 * 20, steeper at the top (a superpower is worth five or six median countries rather than three),
 * and the map is worth 1.29 times as much (928 against 718). Mission numbers counted in value come
 * in versions written for one scale (`MissionRules.valueScale`); the bots' habits are written for
 * 1-10 and multiplied by it. Datasets not listed (test maps) are on the 1-10 scale.
 */
export const DATASET_VALUE_SCALES: Readonly<Record<string, number>> = { '2026.1': 1, '2026.2': 1.29, '2026.3': 1.29 };

export const valueScale = (datasetVersion: string): number => DATASET_VALUE_SCALES[datasetVersion] ?? 1;

/** The highest value a territory can have in this dataset version. */
export const topValueOf = (datasetVersion: string): number => (valueScale(datasetVersion) === 1 ? 10 : MAX_VALUE);
