import type { Continent, LonLat, TerritoryKind } from '@empire/rules';
import type { CanonConfig, CanonEntry } from './config';
import type { NeFeature } from './naturalearth';
import type { BBox, PolygonCoords } from './types';

/** Polygons from one source that end up in one territory. */
export interface Piece {
  /** Unique key, e.g. "FRA" (what is left of France) or "FRA>GUF" (split from France). */
  key: string;
  territoryId: string;
  /** Member id, or null for the territory's own geometry. */
  memberId: string | null;
  /** NE feature the polygons come from. */
  source: string;
  polygons: PolygonCoords[];
}

export interface TerritoryPlan {
  id: string;
  name: string;
  kind: TerritoryKind;
  continent: Continent;
  subregion: string;
  members: { id: string; name: string }[];
  pieces: Piece[];
  /** Statistics codes summed into this territory (World Bank codes or estimates.yaml keys). */
  statsCodes: string[];
  /** Hand-placed anchor (regions only). */
  anchor: LonLat | null;
  note: string | null;
}

export type FeatureAction = 'kept' | 'merged' | 'bundled' | 'dropped';

export interface CanonReport {
  features: { code: string; neName: string; action: FeatureAction }[];
  renamed: { id: string; neName: string; name: string }[];
  splits: { id: string; name: string; from: string; to: string; how: string; polygons: number }[];
  drops: { code: string; neName: string; reason: string }[];
}

const NE_CONTINENTS: Record<string, Continent> = {
  Africa: 'africa',
  Asia: 'asia',
  Europe: 'europe',
  'North America': 'north-america',
  'South America': 'south-america',
  Oceania: 'oceania',
};

function insideBBox(polygon: PolygonCoords, [w, s, e, n]: BBox): boolean {
  const outer = polygon[0] ?? [];
  return outer.length > 0 && outer.every(([lon, lat]) => lon >= w && lon <= e && lat >= s && lat <= n);
}

/** Point where segment a–b meets the parallel `lat`; an endpoint on the parallel is reused as is. */
function onParallel(a: LonLat, b: LonLat, lat: number): LonLat {
  if (a[1] === lat) return a;
  if (b[1] === lat) return b;
  const t = (lat - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), lat];
}

/**
 * Splits a hole-free polygon along a parallel into its northern and southern parts. Only polygons
 * whose outer ring dips below the parallel in one continuous stretch are supported, which keeps
 * the cut exact: both parts share the same two cut points, so the topology sees one shared border.
 */
function cutAtParallel(
  polygon: PolygonCoords,
  lat: number,
  where: string,
): { north: PolygonCoords | null; south: PolygonCoords | null } {
  const ring = polygon[0] ?? [];
  const pts = ring.slice(0, -1);
  const n = pts.length;
  const below = pts.map((p) => p[1] < lat);
  if (below.every((b) => !b)) return { north: polygon, south: null };
  if (below.every((b) => b)) return { north: null, south: polygon };
  if (polygon.length > 1) throw new Error(`${where}: cannot cut a polygon with holes`);
  const starts = pts.map((_, i) => i).filter((i) => below[i] && !below[(i - 1 + n) % n]);
  if (starts.length !== 1) throw new Error(`${where}: the ring crosses latitude ${lat} more than twice`);
  const start = starts[0]!;
  const run: LonLat[] = [];
  let end = start;
  for (let i = start; below[i]; i = (i + 1) % n) {
    run.push(pts[i]!);
    end = i;
  }
  const prev = pts[(start - 1 + n) % n]!;
  const next = pts[(end + 1) % n]!;
  const entry = onParallel(prev, pts[start]!, lat);
  const exit = onParallel(pts[end]!, next, lat);
  const south: LonLat[] = [entry, ...run, exit, entry];
  const north: LonLat[] = [];
  for (let i = (end + 1) % n; i !== start; i = (i + 1) % n) north.push(pts[i]!);
  if (entry !== prev) north.push(entry);
  if (exit !== next) north.push(exit);
  north.push(north[0]!);
  return { north: [north], south: [south] };
}

export function applyCanon(
  features: readonly NeFeature[],
  canon: CanonConfig,
): { plans: TerritoryPlan[]; report: CanonReport } {
  const problems: string[] = [];
  const byCode = new Map(features.map((f) => [f.code, f]));
  const remaining = new Map(features.map((f) => [f.code, [...f.polygons]]));
  const usage = new Map<string, string[]>();
  const report: CanonReport = { features: [], renamed: [], splits: [], drops: [] };

  const feature = (code: string, where: string): NeFeature | null => {
    const f = byCode.get(code);
    if (!f) problems.push(`${where}: no Natural Earth feature with ADM0_A3 "${code}"`);
    return f ?? null;
  };
  const use = (code: string, how: string, action: FeatureAction): void => {
    usage.set(code, [...(usage.get(code) ?? []), how]);
    const f = byCode.get(code);
    if (f) report.features.push({ code, neName: f.name, action });
  };
  const take = (from: string, bbox: BBox, where: string): PolygonCoords[] => {
    if (!feature(from, where)) return [];
    const pool = remaining.get(from) ?? [];
    const taken = pool.filter((p) => insideBBox(p, bbox));
    if (taken.length === 0) problems.push(`${where}: no polygon of ${from} lies inside bbox [${bbox.join(', ')}]`);
    remaining.set(
      from,
      pool.filter((p) => !taken.includes(p)),
    );
    return taken;
  };
  const cut = (from: string, lat: number, where: string): PolygonCoords[] => {
    if (!feature(from, where)) return [];
    const kept: PolygonCoords[] = [];
    const taken: PolygonCoords[] = [];
    for (const polygon of remaining.get(from) ?? []) {
      const { north, south } = cutAtParallel(polygon, lat, where);
      if (north) kept.push(north);
      if (south) taken.push(south);
    }
    if (taken.length === 0) problems.push(`${where}: nothing of ${from} lies south of ${lat}`);
    remaining.set(from, kept);
    return taken;
  };

  // Split-offs first, so each feature's leftover polygons are known before it is assigned.
  const extracted = new Map<string, PolygonCoords[]>();
  for (const e of canon.entries) {
    if (e.split) {
      const polys = take(e.split.from, e.split.bbox, `canon.yaml ${e.id}.split`);
      extracted.set(e.id, polys);
      report.splits.push({
        id: e.id,
        name: e.name,
        from: e.split.from,
        to: e.id,
        how: `bbox [${e.split.bbox.join(', ')}]`,
        polygons: polys.length,
      });
    }
    for (const part of e.parts) {
      const where = `canon.yaml ${e.id}.parts.${part.id}`;
      const polys = part.bbox ? take(part.from, part.bbox, where) : cut(part.from, part.southOf!, where);
      extracted.set(`${e.id}>${part.id}`, polys);
      report.splits.push({
        id: part.id,
        name: part.name,
        from: part.from,
        to: e.id,
        how: part.bbox ? `bbox [${part.bbox.join(', ')}]` : `cut along ${part.southOf}°N, southern part`,
        polygons: polys.length,
      });
    }
  }

  const ids = new Set<string>();
  for (const e of canon.entries) {
    if (ids.has(e.id)) problems.push(`canon.yaml: duplicate territory id ${e.id}`);
    ids.add(e.id);
  }
  const memberIds = new Set<string>();
  const plans: TerritoryPlan[] = [];
  for (const e of canon.entries) {
    const plan = planEntry(e);
    if (plan) plans.push(plan);
  }

  function planEntry(e: CanonEntry): TerritoryPlan | null {
    const where = `canon.yaml ${e.id}`;
    const pieces: Piece[] = [];
    const members: { id: string; name: string }[] = [];
    const statsCodes: string[] = [];
    const addStats = (code: string | null): void => {
      if (code !== null && !statsCodes.includes(code)) statsCodes.push(code);
    };
    const addMember = (id: string, name: string): void => {
      if (memberIds.has(id) || ids.has(id)) problems.push(`${where}: member id ${id} is used twice`);
      memberIds.add(id);
      members.push({ id, name });
    };

    let principal: NeFeature | null = null;
    if (e.ne) {
      principal = feature(e.ne, where);
      if (principal) {
        const polygons = remaining.get(e.ne) ?? [];
        if (polygons.length === 0) problems.push(`${where}: nothing left of ${e.ne} after splits`);
        pieces.push({ key: e.ne, territoryId: e.id, memberId: null, source: e.ne, polygons });
        const kind = e.kind === 'country' ? 'country' : 'territory';
        use(e.ne, `${kind} ${e.id}`, 'kept');
        if (principal.name !== e.name) report.renamed.push({ id: e.id, neName: principal.name, name: e.name });
      }
    } else if (e.split) {
      pieces.push({
        key: `${e.split.from}>${e.id}`,
        territoryId: e.id,
        memberId: null,
        source: e.split.from,
        polygons: extracted.get(e.id) ?? [],
      });
    }
    if (e.kind !== 'region') addStats(e.stats === undefined ? e.id : e.stats);

    for (const m of e.merge) {
      const f = feature(m.ne, `${where}.${e.kind === 'region' ? 'members' : 'merge'}.${m.ne}`);
      if (!f) continue;
      const id = m.id ?? f.iso3 ?? f.code;
      addMember(id, m.name);
      const polygons = remaining.get(m.ne) ?? [];
      if (polygons.length === 0) problems.push(`${where}: nothing left of ${m.ne} after splits`);
      pieces.push({ key: m.ne, territoryId: e.id, memberId: id, source: m.ne, polygons });
      addStats(m.stats === undefined ? id : m.stats);
      const action = e.kind === 'region' ? 'bundled' : 'merged';
      use(m.ne, `${action} into ${e.id}`, action);
    }
    for (const part of e.parts) {
      if (part.member) addMember(part.id, part.name);
      pieces.push({
        key: `${part.from}>${part.id}`,
        territoryId: e.id,
        memberId: part.member ? part.id : null,
        source: part.from,
        polygons: extracted.get(`${e.id}>${part.id}`) ?? [],
      });
      if (part.member) addStats(part.stats === undefined ? part.id : part.stats);
    }

    const neContinent = principal ? NE_CONTINENTS[principal.continent] : undefined;
    const continent = e.continent ?? neContinent ?? null;
    const subregion = e.subregion ?? principal?.subregion ?? null;
    if (!continent) {
      problems.push(`${where}: set "continent" (NE says "${principal?.continent ?? 'n/a'}")`);
      return null;
    }
    if (!subregion) {
      problems.push(`${where}: set "subregion"`);
      return null;
    }
    return {
      id: e.id,
      name: e.name,
      kind: e.kind,
      continent,
      subregion,
      members,
      pieces,
      statsCodes,
      anchor: e.anchor,
      note: e.note,
    };
  }

  for (const d of canon.drop) {
    const f = feature(d.ne, `canon.yaml drop.${d.ne}`);
    if (!f) continue;
    use(d.ne, 'dropped', 'dropped');
    report.drops.push({ code: d.ne, neName: f.name, reason: d.reason });
  }

  for (const f of features) {
    const how = usage.get(f.code) ?? [];
    if (how.length === 0) {
      problems.push(`Natural Earth feature ${f.code} (${f.name}) is not accounted for in canon.yaml`);
    } else if (how.length > 1) {
      problems.push(`Natural Earth feature ${f.code} (${f.name}) is used more than once: ${how.join('; ')}`);
    }
  }
  if (problems.length > 0) throw new Error(`Map canon problems:\n  - ${problems.join('\n  - ')}`);

  plans.sort((a, b) => (a.id < b.id ? -1 : 1));
  report.features.sort((a, b) => (a.code < b.code ? -1 : 1));
  report.renamed.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { plans, report };
}
