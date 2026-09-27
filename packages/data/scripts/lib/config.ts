import { STAT_KEYS, type Continent, type LonLat, type StatKey, type TerritoryKind } from '@empire/rules';
import type { BBox } from './types';
import {
  asArray,
  asBBox,
  asLonLat,
  asNumber,
  asOptionalRecord,
  asRecord,
  asString,
  asStringList,
  fail,
  isRecord,
  loadConfigFile,
} from './yaml';

/**
 * Typed loaders for the hand-edited files in config/. Every value is validated with its location,
 * so a typo fails the build with a message pointing at the line to fix.
 */

export const CONTINENTS: readonly Continent[] = [
  'africa',
  'asia',
  'europe',
  'north-america',
  'south-america',
  'oceania',
];

/** An NE feature or split-off piece folded into a territory. */
export interface MemberSpec {
  /** Member id shown in `Territory.members`; defaults to the feature's ISO code. */
  id: string | null;
  name: string;
  /**
   * Which statistics economy covers this member: undefined = its own id, a code = that economy
   * (e.g. Jersey is reported by the World Bank as part of the Channel Islands, "CHI"), null = none.
   */
  stats: string | null | undefined;
}

export interface MergeSpec extends MemberSpec {
  /** NE ADM0_A3 code. */
  ne: string;
}

export interface PartSpec extends MemberSpec {
  /** NE feature the polygons are taken from. */
  from: string;
  /** Every polygon of `from` whose outer ring lies entirely inside this box moves here. */
  bbox: BBox | null;
  /** Alternatively: everything of `from` south of this parallel, cutting polygons that cross it. */
  southOf: number | null;
  /** False for pure geometry (no entry in `members`, no statistics of its own). */
  member: boolean;
}

export interface CanonEntry {
  id: string;
  kind: TerritoryKind;
  name: string;
  /** The NE feature this territory is built on, if any. */
  ne: string | null;
  /** For territories carved out of another feature (French Guiana): where the polygons come from. */
  split: { from: string; bbox: BBox } | null;
  stats: string | null | undefined;
  merge: MergeSpec[];
  parts: (PartSpec & { id: string })[];
  anchor: LonLat | null;
  continent: Continent | null;
  subregion: string | null;
  note: string | null;
}

export interface PairSpec {
  a: string;
  b: string;
  reason: string;
}

export interface CanonConfig {
  entries: CanonEntry[];
  drop: { ne: string; reason: string }[];
  micro: { areaKm2: number; include: string[]; exclude: string[] };
  landBorders: { add: PairSpec[]; remove: PairSpec[] };
}

const ID_PATTERN = /^[A-Z][A-Z0-9-]{1,19}$/;

function asId(v: unknown, where: string): string {
  const s = asString(v, where);
  if (!ID_PATTERN.test(s)) fail(where, `"${s}" is not a valid id (${ID_PATTERN})`);
  return s;
}

function asContinent(v: unknown, where: string): Continent | null {
  if (v === undefined || v === null) return null;
  const s = asString(v, where);
  if (!(CONTINENTS as readonly string[]).includes(s)) fail(where, `unknown continent "${s}"`);
  return s as Continent;
}

function asStatsCode(v: unknown, where: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return asString(v, where);
}

function parseMember(v: unknown, where: string): MemberSpec {
  if (typeof v === 'string') return { id: null, name: asString(v, where), stats: undefined };
  const r = asOptionalRecord(v, where, ['name', 'id', 'stats']);
  return {
    id: r['id'] === undefined ? null : asId(r['id'], `${where}.id`),
    name: asString(r['name'], `${where}.name`),
    stats: asStatsCode(r['stats'], `${where}.stats`),
  };
}

function parseEntry(id: string, kind: TerritoryKind, v: unknown, where: string): CanonEntry {
  const entry: CanonEntry = {
    id,
    kind,
    name: '',
    ne: kind === 'region' ? null : id,
    split: null,
    stats: undefined,
    merge: [],
    parts: [],
    anchor: null,
    continent: null,
    subregion: null,
    note: null,
  };
  if (typeof v === 'string') return { ...entry, name: asString(v, where) };
  const allowed =
    kind === 'region'
      ? ['name', 'anchor', 'continent', 'subregion', 'members', 'parts', 'note']
      : ['name', 'ne', 'split', 'stats', 'merge', 'parts', 'continent', 'subregion', 'note'];
  const r = asOptionalRecord(v, where, allowed);
  entry.name = asString(r['name'], `${where}.name`);
  entry.continent = asContinent(r['continent'], `${where}.continent`);
  entry.subregion = r['subregion'] === undefined ? null : asString(r['subregion'], `${where}.subregion`);
  entry.note = r['note'] === undefined ? null : asString(r['note'], `${where}.note`);
  entry.stats = asStatsCode(r['stats'], `${where}.stats`);
  if (r['ne'] !== undefined) entry.ne = asString(r['ne'], `${where}.ne`);
  if (r['split'] !== undefined) {
    const s = asOptionalRecord(r['split'], `${where}.split`, ['from', 'bbox']);
    entry.split = {
      from: asString(s['from'], `${where}.split.from`),
      bbox: asBBox(s['bbox'], `${where}.split.bbox`),
    };
    entry.ne = null;
  }
  const mergeKey = kind === 'region' ? 'members' : 'merge';
  for (const [ne, m] of Object.entries(asOptionalRecord(r[mergeKey], `${where}.${mergeKey}`))) {
    entry.merge.push({ ne, ...parseMember(m, `${where}.${mergeKey}.${ne}`) });
  }
  for (const [partId, p] of Object.entries(asOptionalRecord(r['parts'], `${where}.parts`))) {
    const pw = `${where}.parts.${partId}`;
    const pr = asOptionalRecord(p, pw, ['name', 'from', 'bbox', 'south_of', 'stats', 'member']);
    if ((pr['bbox'] === undefined) === (pr['south_of'] === undefined)) fail(pw, 'give exactly one of bbox or south_of');
    const member = pr['member'] === undefined ? true : pr['member'];
    if (typeof member !== 'boolean') fail(`${pw}.member`, 'expected true or false');
    entry.parts.push({
      id: asId(partId, pw),
      name: asString(pr['name'], `${pw}.name`),
      stats: member ? asStatsCode(pr['stats'], `${pw}.stats`) : null,
      from: asString(pr['from'], `${pw}.from`),
      bbox: pr['bbox'] === undefined ? null : asBBox(pr['bbox'], `${pw}.bbox`),
      southOf: pr['south_of'] === undefined ? null : asNumber(pr['south_of'], `${pw}.south_of`),
      member,
    });
  }
  if (kind === 'region') {
    entry.anchor = asLonLat(r['anchor'], `${where}.anchor`);
    if (!entry.continent) fail(where, 'regions need an explicit continent');
    if (!entry.subregion) fail(where, 'regions need an explicit subregion');
  }
  return entry;
}

function parsePairs(v: unknown, where: string): PairSpec[] {
  return asArray(v, where).map((x, i) => {
    const w = `${where}[${i}]`;
    const r = asOptionalRecord(x, w, ['a', 'b', 'reason']);
    const a = asId(r['a'], `${w}.a`);
    const b = asId(r['b'], `${w}.b`);
    if (a === b) fail(w, 'a and b must differ');
    return { a, b, reason: asString(r['reason'], `${w}.reason`) };
  });
}

/** config/canon.yaml: which territories exist and what they are made of. */
export function loadCanon(): CanonConfig {
  const file = 'canon.yaml';
  const root = asOptionalRecord(loadConfigFile(file), file, [
    'countries',
    'territories',
    'regions',
    'drop',
    'micro',
    'land_borders',
  ]);
  const entries: CanonEntry[] = [];
  const sections = [
    ['countries', 'country'],
    ['territories', 'territory'],
    ['regions', 'region'],
  ] as const;
  for (const [section, kind] of sections) {
    for (const [id, v] of Object.entries(asOptionalRecord(root[section], `${file} ${section}`))) {
      entries.push(parseEntry(asId(id, `${file} ${section}`), kind, v, `${file} ${section}.${id}`));
    }
  }
  const drop = Object.entries(asOptionalRecord(root['drop'], `${file} drop`)).map(([ne, reason]) => ({
    ne,
    reason: asString(reason, `${file} drop.${ne}`),
  }));
  const micro = asOptionalRecord(root['micro'], `${file} micro`, ['area_km2', 'include', 'exclude']);
  const land = asOptionalRecord(root['land_borders'], `${file} land_borders`, ['add', 'remove']);
  return {
    entries,
    drop,
    micro: {
      areaKm2: asNumber(micro['area_km2'], `${file} micro.area_km2`),
      include: asStringList(micro['include'], `${file} micro.include`),
      exclude: asStringList(micro['exclude'], `${file} micro.exclude`),
    },
    landBorders: {
      add: parsePairs(land['add'], `${file} land_borders.add`),
      remove: parsePairs(land['remove'], `${file} land_borders.remove`),
    },
  };
}

export interface LaneAddSpec extends PairSpec {
  /** Optional drawing hints: the lane end in territory ID snaps to the coastline nearest this point. */
  near: Map<string, LonLat>;
}

export interface SeaLaneConfig {
  thresholdKm: number;
  add: LaneAddSpec[];
  remove: PairSpec[];
}

/** config/sea-lanes.yaml: the proximity threshold and hand-made lane edits. */
export function loadSeaLanes(): SeaLaneConfig {
  const file = 'sea-lanes.yaml';
  const root = asOptionalRecord(loadConfigFile(file), file, ['threshold_km', 'add', 'remove']);
  const thresholdKm = asNumber(root['threshold_km'], `${file} threshold_km`);
  if (thresholdKm <= 0 || thresholdKm > 1000) fail(`${file} threshold_km`, 'must be in (0, 1000]');
  const add = asArray(root['add'], `${file} add`).map((x, i) => {
    const w = `${file} add[${i}]`;
    const r = asOptionalRecord(x, w, ['a', 'b', 'reason', 'near']);
    const [pair] = parsePairs([{ a: r['a'], b: r['b'], reason: r['reason'] }], w);
    const near = new Map<string, LonLat>();
    for (const [id, p] of Object.entries(asOptionalRecord(r['near'], `${w}.near`))) {
      if (id !== pair!.a && id !== pair!.b) fail(`${w}.near`, `${id} is neither ${pair!.a} nor ${pair!.b}`);
      near.set(id, asLonLat(p, `${w}.near.${id}`));
    }
    return { ...pair!, near };
  });
  return { thresholdKm, add, remove: parsePairs(root['remove'], `${file} remove`) };
}

export type EstimateSpec =
  | { kind: 'value'; value: number | null; year: number | null; source: string; replace: string | null }
  | { kind: 'eur'; eur: number; usdPerEur: number; year: number | null; source: string; replace: string | null }
  | { kind: 'ppp-ratio'; of: string; source: string; replace: string | null };

export interface AdjustmentSpec {
  subtract: string[];
  stats: StatKey[];
  reason: string;
}

export interface EstimatesConfig {
  /** Keyed by statistics code (see canon.yaml), then stat key. */
  estimates: Map<string, Map<StatKey, EstimateSpec>>;
  adjustments: Map<string, AdjustmentSpec>;
}

function asStatKey(v: string, where: string): StatKey {
  if (!(STAT_KEYS as readonly string[]).includes(v)) fail(where, `unknown stat "${v}" (${STAT_KEYS.join(', ')})`);
  return v as StatKey;
}

function asYear(v: unknown, where: string): number | null {
  if (v === undefined || v === null) return null;
  const y = asNumber(v, where);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) fail(where, 'expected a year');
  return y;
}

function parseEstimate(v: unknown, where: string): EstimateSpec {
  const r = asRecord(v, where);
  const source = asString(r['source'], `${where}.source`);
  const replace = r['replace'] === undefined ? null : asString(r['replace'], `${where}.replace`);
  if ('ppp_ratio_of' in r) {
    asOptionalRecord(r, where, ['ppp_ratio_of', 'source', 'replace']);
    return { kind: 'ppp-ratio', of: asString(r['ppp_ratio_of'], `${where}.ppp_ratio_of`), source, replace };
  }
  if ('eur' in r) {
    asOptionalRecord(r, where, ['eur', 'usd_per_eur', 'year', 'source', 'replace']);
    return {
      kind: 'eur',
      eur: asNumber(r['eur'], `${where}.eur`),
      usdPerEur: asNumber(r['usd_per_eur'], `${where}.usd_per_eur`),
      year: asYear(r['year'], `${where}.year`),
      source,
      replace,
    };
  }
  asOptionalRecord(r, where, ['value', 'year', 'source', 'replace']);
  if (!('value' in r)) fail(where, 'expected value (or eur / ppp_ratio_of)');
  const value = r['value'] === null ? null : asNumber(r['value'], `${where}.value`);
  if (value !== null && value < 0) fail(`${where}.value`, 'must be >= 0');
  return { kind: 'value', value, year: asYear(r['year'], `${where}.year`), source, replace };
}

/** config/estimates.yaml: figures that fill or replace World Bank data, and subtractions. */
export function loadEstimates(): EstimatesConfig {
  const file = 'estimates.yaml';
  const root = asOptionalRecord(loadConfigFile(file), file, ['estimates', 'adjustments']);
  const estimates = new Map<string, Map<StatKey, EstimateSpec>>();
  for (const [code, stats] of Object.entries(asOptionalRecord(root['estimates'], `${file} estimates`))) {
    const byStat = new Map<StatKey, EstimateSpec>();
    for (const [key, spec] of Object.entries(asRecord(stats, `${file} estimates.${code}`))) {
      const where = `${file} estimates.${code}.${key}`;
      byStat.set(asStatKey(key, where), parseEstimate(spec, where));
    }
    estimates.set(code, byStat);
  }
  const adjustments = new Map<string, AdjustmentSpec>();
  for (const [code, adj] of Object.entries(asOptionalRecord(root['adjustments'], `${file} adjustments`))) {
    const where = `${file} adjustments.${code}`;
    const r = asOptionalRecord(adj, where, ['subtract', 'stats', 'reason']);
    adjustments.set(code, {
      subtract: asStringList(r['subtract'], `${where}.subtract`),
      stats: asStringList(r['stats'], `${where}.stats`).map((s) => asStatKey(s, `${where}.stats`)),
      reason: asString(r['reason'], `${where}.reason`),
    });
  }
  return { estimates, adjustments };
}

export const VALUE_METRICS = ['gdpNominalUsd', 'gdpPppUsd', 'population', 'areaKm2'] as const;
export type ValueMetric = (typeof VALUE_METRICS)[number];

export interface ValuesConfig {
  weights: Record<ValueMetric, number>;
  /** Share of territories per value for 10 down to 2; value 1 takes the rest. */
  shares: Map<number, number>;
  overrides: Map<string, { value: number; reason: string | null }>;
}

/** config/values.yaml: score weights, the target distribution and hand overrides. */
export function loadValues(): ValuesConfig {
  const file = 'values.yaml';
  const root = asOptionalRecord(loadConfigFile(file), file, ['weights', 'distribution', 'overrides']);
  const w = asOptionalRecord(root['weights'], `${file} weights`, VALUE_METRICS);
  const weights = Object.fromEntries(
    VALUE_METRICS.map((m) => {
      const x = asNumber(w[m], `${file} weights.${m}`);
      if (x < 0) fail(`${file} weights.${m}`, 'must be >= 0');
      return [m, x];
    }),
  ) as Record<ValueMetric, number>;
  if (VALUE_METRICS.every((m) => weights[m] === 0)) fail(`${file} weights`, 'at least one weight must be > 0');

  const shares = new Map<number, number>();
  let total = 0;
  for (const [k, v] of Object.entries(asOptionalRecord(root['distribution'], `${file} distribution`))) {
    const value = Number(k);
    const where = `${file} distribution.${k}`;
    if (!Number.isInteger(value) || value < 2 || value > 10) fail(where, 'keys are values 2-10 (1 takes the rest)');
    const share = asNumber(v, where);
    if (share < 0 || share > 1) fail(where, 'share must be within [0, 1]');
    shares.set(value, share);
    total += share;
  }
  if (total > 1) fail(`${file} distribution`, `shares add up to ${total} > 1`);

  const overrides = new Map<string, { value: number; reason: string | null }>();
  for (const [id, v] of Object.entries(asOptionalRecord(root['overrides'], `${file} overrides`))) {
    const where = `${file} overrides.${id}`;
    const spec = isRecord(v)
      ? (() => {
          const r = asOptionalRecord(v, where, ['value', 'reason']);
          return { value: asNumber(r['value'], `${where}.value`), reason: asString(r['reason'], `${where}.reason`) };
        })()
      : { value: asNumber(v, where), reason: null };
    if (!Number.isInteger(spec.value) || spec.value < 1 || spec.value > 10) {
      fail(where, 'value must be an integer 1-10');
    }
    overrides.set(asId(id, where), spec);
  }
  return { weights, shares, overrides };
}

export interface TerrainConfig {
  islandInclude: string[];
  islandExclude: string[];
  mountains: string[];
}

/** config/terrain.yaml: island adjustments and the mountain list. */
export function loadTerrain(): TerrainConfig {
  const file = 'terrain.yaml';
  const root = asOptionalRecord(loadConfigFile(file), file, ['island', 'mountains']);
  const island = asOptionalRecord(root['island'], `${file} island`, ['include', 'exclude']);
  return {
    islandInclude: asStringList(island['include'], `${file} island.include`),
    islandExclude: asStringList(island['exclude'], `${file} island.exclude`),
    mountains: asStringList(root['mountains'], `${file} mountains`),
  };
}
