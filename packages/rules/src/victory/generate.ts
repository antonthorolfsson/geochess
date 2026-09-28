/**
 * Choosing mission targets. Public missions are generated in the lobby from the map alone, before
 * anyone has drafted, so they aim for ground several empires could contest. Secret options are
 * dealt to each player after the draft from their actual holdings and the map's topology, with an
 * estimate of the effort each needs. Both are transparent heuristics, not proofs of balance.
 */
import type { CampaignRules } from '../config';
import type { Continent, TerritoryId } from '../dataset';
import { shuffled, type UserId } from '../draft';
import type { DatasetIndex } from '../graph';
import {
  PUBLIC_MISSION_KINDS,
  missionRules,
  type MissionRules,
  type PublicMissionKind,
  type PublicMissionSpec,
  type SecretFamily,
  type SecretMissionSpec,
} from './catalog';
import { evaluateMission } from './evaluate';
import {
  acquisitionPlan,
  angleBetween,
  bearing,
  captureCosts,
  centroid,
  components,
  frontier,
  heldBy,
  hopDistances,
  routeTo,
  valueOfSet,
  type AcquisitionPlan,
  type MissionWorld,
} from './world';

export type Random = () => number;

/** A small seeded generator (mulberry32): the same seed always deals the same options. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percent of a whole number, rounded up, without floating-point surprises. */
const percentUp = (value: number, pct: number) => Math.floor((value * pct + 99) / 100);

// ---------------------------------------------------------------------------------------------
// Public missions

export interface Region {
  name: string;
  continent: Continent;
  territories: TerritoryId[];
  value: number;
}

/**
 * Regions fit for Regional Power: subregions of a workable size and value that hang together on
 * the map and aren't a whole continent.
 */
export function regionsFor(idx: DatasetIndex, cfg: MissionRules): Region[] {
  const byName = new Map<string, Region>();
  const perContinent = new Map<Continent, number>();
  for (const t of idx.dataset.territories) {
    perContinent.set(t.continent, (perContinent.get(t.continent) ?? 0) + 1);
    const region = byName.get(t.subregion) ?? { name: t.subregion, continent: t.continent, territories: [], value: 0 };
    region.territories.push(t.id);
    region.value += t.value;
    byName.set(t.subregion, region);
  }
  const { size, value } = cfg.regionalPower;
  return [...byName.values()]
    .filter(
      (r) =>
        r.territories.length >= size[0] &&
        r.territories.length <= size[1] &&
        r.value >= value[0] &&
        r.value <= value[1] &&
        r.territories.length < (perContinent.get(r.continent) ?? 0) &&
        components(idx, new Set(r.territories)).length === 1,
    )
    .map((r) => ({ ...r, territories: r.territories.sort() }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Why a public mission can't be played in this campaign, or null if it can. */
export function publicMissionIssue(kind: PublicMissionKind, idx: DatasetIndex, rules: CampaignRules): string | null {
  const cfg = missionRules(rules.victory.version);
  const continents = new Set(idx.dataset.territories.map((t) => t.continent)).size;
  switch (kind) {
    case 'consolidation':
      return rules.draft.mode === 'free'
        ? null
        : 'Only for free drafts: a contiguous draft already leaves every empire in one piece.';
    case 'regional_power':
      return regionsFor(idx, cfg).length > 0 ? null : 'No region on this map has the right size for it.';
    case 'great_powers': {
      const { minValue, count } = cfg.greatPowers;
      const big = idx.dataset.territories.filter((t) => t.value >= minValue).length;
      return big >= count + 2 ? null : `This map has too few countries worth ${minValue} or more.`;
    }
    case 'across_the_seas':
      return idx.dataset.seaLanes.length >= cfg.acrossTheSeas.count * 2 ? null : 'This map has too few sea lanes.';
    case 'continental_bridge':
      return continents >= cfg.continentalBridge.continents
        ? null
        : `This map has fewer than ${cfg.continentalBridge.continents} continents.`;
    case 'two_fronts':
      return continents >= cfg.twoFronts.continents ? null : 'This map has only one continent.';
    default:
      return null;
  }
}

function strategicPositions(
  idx: DatasetIndex,
  cfg: MissionRules,
  random: Random,
  taken: ReadonlySet<TerritoryId>,
): PublicMissionSpec | null {
  const { count, need, value, radius, spacing } = cfg.strategicPositions;
  const distances = new Map<TerritoryId, Map<TerritoryId, number>>();
  const dist = (a: TerritoryId, b: TerritoryId) => {
    let d = distances.get(a);
    if (!d) distances.set(a, (d = hopDistances(idx, a)));
    return d.get(b) ?? Infinity;
  };
  const eligible = (id: TerritoryId) => {
    const t = idx.byId.get(id)!;
    return !t.micro && t.value >= value[0] && t.value <= value[1] && !taken.has(id);
  };
  // A hub several empires could meet around, with positions spread out around it.
  const hubs = shuffled(
    idx.ids.filter((id) => !idx.byId.get(id)!.micro && idx.neighbors(id).length >= 3),
    random,
  );
  for (const hub of hubs.slice(0, 80)) {
    const pool = shuffled(
      idx.ids.filter((id) => eligible(id) && dist(hub, id) <= radius),
      random,
    );
    const chosen: TerritoryId[] = [];
    for (const id of pool) {
      if (chosen.every((c) => dist(c, id) >= spacing)) chosen.push(id);
      if (chosen.length === count) break;
    }
    if (chosen.length < count) continue;
    if (new Set(chosen.map((id) => idx.byId.get(id)!.subregion)).size < 2) continue;
    return { kind: 'strategic_positions', territories: chosen.sort(), need };
  }
  return null;
}

function greatConnection(
  idx: DatasetIndex,
  cfg: MissionRules,
  random: Random,
  taken: ReadonlySet<TerritoryId>,
): PublicMissionSpec | null {
  const [lo, hi] = cfg.greatConnection.between;
  // Endpoints on the mainland of the graph: not microstates, not dead ends, not already a target.
  const ends = idx.ids.filter((id) => !idx.byId.get(id)!.micro && idx.neighbors(id).length >= 2 && !taken.has(id));
  for (const a of shuffled(ends, random).slice(0, 80)) {
    // The shortest chain counts land and sea lanes, as the mission does, and has to be as short on
    // the map: across the Bering Strait, Finland is only three countries from Haiti.
    const dist = hopDistances(idx, a);
    const onMap = hopDistances(idx, a, { onMap: true });
    const region = idx.byId.get(a)!.subregion;
    const partners = ends.filter((b) => {
      const d = dist.get(b);
      if (d === undefined || onMap.get(b) !== d) return false;
      return d - 1 >= lo && d - 1 <= hi && idx.byId.get(b)!.subregion !== region;
    });
    const b = shuffled(partners, random)[0];
    if (b) return { kind: 'great_connection', endpoints: [a, b].sort() as [TerritoryId, TerritoryId] };
  }
  return null;
}

/**
 * One public mission with fresh targets, avoiding countries in `taken` (other missions' targets)
 * where it can. Null when the map has no fitting targets.
 */
export function generatePublicMission(
  kind: PublicMissionKind,
  idx: DatasetIndex,
  rules: CampaignRules,
  random: Random,
  taken: ReadonlySet<TerritoryId> = new Set(),
): PublicMissionSpec | null {
  const cfg = missionRules(rules.victory.version);
  switch (kind) {
    case 'expansion':
      return { kind, gain: cfg.expansion.gain };
    case 'regional_power': {
      const all = regionsFor(idx, cfg);
      const free = all.filter((r) => !r.territories.some((id) => taken.has(id)));
      const region = shuffled(free.length > 0 ? free : all, random)[0];
      if (!region) return null;
      return {
        kind,
        region: region.name,
        territories: region.territories,
        totalValue: region.value,
        needValue: percentUp(region.value, cfg.regionalPower.sharePct),
        minTerritories: cfg.regionalPower.minTerritories,
      };
    }
    case 'strategic_positions':
      return strategicPositions(idx, cfg, random, taken);
    case 'great_connection':
      return greatConnection(idx, cfg, random, taken);
    case 'campaign_veteran':
      return { kind, ...cfg.campaignVeteran };
    case 'great_powers':
      return { kind, ...cfg.greatPowers };
    case 'across_the_seas':
      return { kind, ...cfg.acrossTheSeas };
    case 'continental_bridge':
      return { kind, ...cfg.continentalBridge };
    case 'consolidation':
      return { kind, ...cfg.consolidation };
    case 'two_fronts':
      return { kind, ...cfg.twoFronts };
  }
}

/** Countries a public mission names, which other missions should avoid. */
export function publicTargets(spec: PublicMissionSpec): TerritoryId[] {
  switch (spec.kind) {
    case 'regional_power':
    case 'strategic_positions':
      return spec.territories;
    case 'great_connection':
      return [...spec.endpoints];
    default:
      return [];
  }
}

/** Targeted missions first, so later ones can keep clear of earlier targets. */
const GENERATION_ORDER: readonly PublicMissionKind[] = ['regional_power', 'great_connection', 'strategic_positions'];

export type PublicMissionsResult = { missions: PublicMissionSpec[] } | { error: string };

/** Four distinct, playable public missions with targets that don't overlap. */
export function generatePublicMissions(
  kinds: readonly PublicMissionKind[],
  idx: DatasetIndex,
  rules: CampaignRules,
  random: Random,
): PublicMissionsResult {
  const cfg = missionRules(rules.victory.version);
  if (kinds.length !== cfg.publicCount) return { error: `Choose ${cfg.publicCount} public missions.` };
  if (new Set(kinds).size !== kinds.length) return { error: 'Each public mission can only be chosen once.' };
  for (const kind of kinds) {
    if (!PUBLIC_MISSION_KINDS.includes(kind)) return { error: 'That is not a public mission.' };
    const issue = publicMissionIssue(kind, idx, rules);
    if (issue) return { error: issue };
  }
  const taken = new Set<TerritoryId>();
  const specs = new Map<PublicMissionKind, PublicMissionSpec>();
  const order = [...kinds].sort(
    (a, b) => (GENERATION_ORDER.indexOf(a) + 1 || 99) - (GENERATION_ORDER.indexOf(b) + 1 || 99),
  );
  for (const kind of order) {
    const spec = generatePublicMission(kind, idx, rules, random, taken);
    if (!spec) return { error: `No targets on this map fit ${kind.replace(/_/g, ' ')}.` };
    specs.set(kind, spec);
    for (const id of publicTargets(spec)) taken.add(id);
  }
  return { missions: kinds.map((k) => specs.get(k)!) };
}

// ---------------------------------------------------------------------------------------------
// Secret options

/** What a secret option asks for, estimated when it's dealt. */
export interface EffortEstimate {
  /** Conquests needed: the targets and the countries in the way. */
  conquests: number;
  /** Of those, countries in the way that aren't targets. */
  inTheWay: number;
  /** Value of the targets still to take. */
  targetValue: number;
  /** Different players holding the countries to conquer. */
  rivals: number;
}

export interface SecretOption {
  /** Stable within the player's options. */
  id: string;
  /** 1 is the best fit, which is assigned if the player doesn't choose in time. */
  rank: number;
  spec: SecretMissionSpec;
  estimate: EffortEstimate;
}

/** A secret mission that fits a player, with how well it fits (higher is better). */
export interface SecretCandidate {
  spec: SecretMissionSpec;
  family: SecretFamily;
  estimate: EffortEstimate;
  fit: number;
}

/**
 * Up to three secret options for a player, dealt after the draft: a mix of families where
 * possible, each still at least two conquests from completion and not about to be revealed, and
 * within reach of the empire. Which kinds, and which instance of each, are drawn with the
 * player's private seed from those that fit (see `MissionRules.variety`), then ranked by fit.
 * Measured Expansion fills in when fewer than three others fit. An empty list means nothing
 * fits, which the host has to settle.
 */
export function secretOptions(
  world: MissionWorld,
  userId: UserId,
  rules: CampaignRules,
  random: Random,
): SecretOption[] {
  const cfg = missionRules(rules.victory.version);
  const valid = secretCandidates(world, userId, rules, random);
  const chosen: SecretCandidate[] = [];
  const draw = (pool: readonly SecretCandidate[]) => {
    const left = pool.filter((c) => !chosen.includes(c));
    if (left.length > 0 && chosen.length < cfg.secretOptions) chosen.push(left[Math.floor(random() * left.length)]!);
  };
  for (const family of ['region', 'route', 'expansion'] as const) draw(valid.filter((c) => c.family === family));
  while (chosen.length < Math.min(cfg.secretOptions, valid.length)) draw(valid);
  if (chosen.length < cfg.secretOptions) {
    const fallback = measuredExpansion(world, userId, cfg, random);
    if (fallback) chosen.push(fallback);
  }
  return chosen
    .sort((a, b) => b.fit - a.fit)
    .map((c, i) => ({ id: `o${i + 1}`, rank: i + 1, spec: c.spec, estimate: c.estimate }));
}

/** Only options still at least two conquests away, and not about to be revealed. */
function stillOpen(world: MissionWorld, userId: UserId, cfg: MissionRules, c: SecretCandidate): boolean {
  const ev = evaluateMission(world, userId, c.spec);
  return !ev.complete && !ev.near && c.estimate.conquests >= cfg.effort.min;
}

/** How well an option fits (higher is better): see `MissionRules.fit`. */
function fitOf(cfg: MissionRules, e: EffortEstimate, random: Random): number {
  const w = cfg.fit;
  return (
    -Math.abs(e.conquests - cfg.effort.ideal) -
    w.inTheWay * e.inTheWay -
    w.rivals * Math.max(0, e.rivals - 2) -
    w.value * Math.max(0, e.targetValue - w.freeValue) +
    random() * w.jitter
  );
}

/** The documented fallback: Measured Expansion, when it can be done within reach. */
function measuredExpansion(
  world: MissionWorld,
  userId: UserId,
  cfg: MissionRules,
  random: Random,
): SecretCandidate | null {
  const { idx, owners } = world;
  const { gain, newCount, revealGain, revealNew } = cfg.measuredExpansion;
  const plan = valuePlan(
    idx,
    owners,
    heldBy(owners, userId),
    () => true,
    gain,
    newCount,
    cfg.effort.reach,
    cfg.effort.max,
  );
  if (!plan) return null;
  const estimate: EffortEstimate = {
    conquests: plan.length,
    inTheWay: 0,
    targetValue: valueOfSet(idx, plan),
    rivals: new Set(plan.map((id) => owners.get(id))).size,
  };
  const c: SecretCandidate = {
    spec: { kind: 'measured_expansion', gain, newCount, revealGain, revealNew },
    family: 'expansion',
    estimate,
    fit: fitOf(cfg, estimate, random),
  };
  return stillOpen(world, userId, cfg, c) ? c : null;
}

/**
 * Every secret mission (the best instance of each kind) that fits a player now, best fit first.
 * Measured Expansion isn't among them: it's only a fallback.
 */
export function secretCandidates(
  world: MissionWorld,
  userId: UserId,
  rules: CampaignRules,
  random: Random,
): SecretCandidate[] {
  const cfg = missionRules(rules.victory.version);
  const { idx, owners } = world;
  const held = heldBy(owners, userId);
  const base = world.baseline.get(userId) ?? held;
  const costs = captureCosts(idx, held);
  const cost = (id: TerritoryId) => costs.cost.get(id) ?? Infinity;
  const claimed = (id: TerritoryId) => owners.has(id);

  const estimate = (plan: AcquisitionPlan, targets: readonly TerritoryId[]): EffortEstimate => {
    const isTarget = new Set(targets);
    const hit = plan.conquests.filter((id) => isTarget.has(id));
    return {
      conquests: plan.conquests.length,
      inTheWay: plan.conquests.length - hit.length,
      targetValue: valueOfSet(idx, hit),
      rivals: new Set(plan.conquests.map((id) => owners.get(id))).size,
    };
  };
  const { min, max, reach } = cfg.effort;
  const fits = (e: EffortEstimate) => e.conquests >= min && e.conquests <= max;
  const candidate = (spec: SecretMissionSpec, family: SecretFamily, e: EffortEstimate): SecretCandidate => ({
    spec,
    family,
    estimate: e,
    fit: fitOf(cfg, e, random),
  });
  const inReach = (targets: readonly TerritoryId[]) =>
    targets.some((id) => !held.has(id) && cost(id) <= reach) || targets.every((id) => held.has(id));
  /**
   * One of a kind's few best instances that are still open, at random; the rest of the kind's
   * instances are never dealt.
   */
  const drawn = (instances: SecretCandidate[]): SecretCandidate[] => {
    const top: SecretCandidate[] = [];
    for (const c of instances.sort((a, b) => b.fit - a.fit)) {
      if (top.length >= cfg.variety.instances) break;
      if (stillOpen(world, userId, cfg, c)) top.push(c);
    }
    return top.length > 0 ? [top[Math.floor(random() * top.length)]!] : [];
  };

  const found: SecretCandidate[] = [];

  // Named sets, where this map has every country and they hang together.
  for (const tpl of cfg.namedSets) {
    const targets = [...tpl.territories];
    if (!targets.every((id) => idx.byId.has(id) && claimed(id))) continue;
    if (components(idx, new Set(targets)).length !== 1) continue;
    if (tpl.need - targets.filter((id) => held.has(id)).length < min || !inReach(targets)) continue;
    const plan = acquisitionPlan(idx, held, targets, tpl.need);
    if (!plan) continue;
    const e = estimate(plan, targets);
    if (fits(e)) {
      found.push(candidate({ kind: tpl.kind, territories: targets, need: tpl.need, reveal: tpl.reveal }, 'region', e));
    }
  }

  // Island Empire: the nearest islands.
  {
    const { count, need, newCount } = cfg.islandEmpire;
    const islands = idx.ids.filter(
      (id) => idx.byId.get(id)!.terrain.includes('island') && claimed(id) && cost(id) <= reach,
    );
    if (islands.length >= count) {
      const targets = shuffled(islands, random)
        .sort((a, b) => cost(a) - cost(b))
        .slice(0, count)
        .sort();
      const open = targets.filter((id) => !held.has(id));
      const toTake = Math.max(newCount, need - (targets.length - open.length));
      const plan = acquisitionPlan(idx, held, open, toTake);
      if (plan) {
        const e = estimate(plan, open);
        if (fits(e))
          found.push(candidate({ kind: 'island_empire', territories: targets, need, newCount }, 'region', e));
      }
    }
  }

  // Mountain Kingdom: three mountain countries close together.
  {
    const { count, reveal, spread } = cfg.mountainKingdom;
    const peaks = idx.ids.filter((id) => idx.byId.get(id)!.terrain.includes('mountains') && claimed(id));
    const dist = new Map(peaks.map((id) => [id, hopDistances(idx, id)]));
    const close = (a: TerritoryId, b: TerritoryId) => (dist.get(a)!.get(b) ?? Infinity) <= spread;
    const kingdoms: SecretCandidate[] = [];
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < peaks.length; j++) {
        if (!close(peaks[i]!, peaks[j]!)) continue;
        for (let k = j + 1; k < peaks.length; k++) {
          const targets = [peaks[i]!, peaks[j]!, peaks[k]!];
          if (!close(peaks[i]!, peaks[k]!) || !close(peaks[j]!, peaks[k]!)) continue;
          if (count - targets.filter((id) => held.has(id)).length < min || !inReach(targets)) continue;
          const plan = acquisitionPlan(idx, held, targets, count);
          if (!plan) continue;
          const e = estimate(plan, targets);
          if (fits(e)) {
            kingdoms.push(
              candidate({ kind: 'mountain_kingdom', territories: targets, need: count, reveal }, 'region', e),
            );
          }
        }
      }
    }
    found.push(...drawn(kingdoms));
  }

  // Unification: two drafted pieces that need at least two conquests to join.
  {
    const pieces = components(idx, new Set(base)).slice(0, 8);
    const mostValuable = (piece: readonly TerritoryId[]) =>
      [...piece].sort((a, b) => (idx.byId.get(b)?.value ?? 0) - (idx.byId.get(a)?.value ?? 0) || (a < b ? -1 : 1))[0]!;
    const joins: SecretCandidate[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const fromPiece = captureCosts(idx, new Set(base), { sources: pieces[i]! });
      for (let j = i + 1; j < pieces.length; j++) {
        let end: TerritoryId | null = null;
        for (const id of pieces[j]!) {
          const c = fromPiece.cost.get(id);
          if (c !== undefined && (end === null || c < fromPiece.cost.get(end)!)) end = id;
        }
        if (end === null) continue;
        const need = fromPiece.cost.get(end)!;
        if (need < cfg.unification.newCount || need > max) continue;
        const route = routeTo(fromPiece, end).filter((id) => !base.has(id));
        const e: EffortEstimate = {
          conquests: route.length,
          inTheWay: route.length,
          targetValue: valueOfSet(idx, route),
          rivals: new Set(route.map((id) => owners.get(id))).size,
        };
        const marks = [mostValuable(pieces[i]!), mostValuable(pieces[j]!)].sort() as [TerritoryId, TerritoryId];
        if (!marks.every((id) => held.has(id))) continue;
        joins.push(candidate({ kind: 'unification', marks, newCount: cfg.unification.newCount }, 'route', e));
      }
    }
    found.push(...drawn(joins));
  }

  // Encirclement: a country held by someone else, with three to five neighbors to take.
  {
    const [lo, hi] = cfg.encirclement.neighbors;
    const rings: SecretCandidate[] = [];
    for (const center of idx.ids) {
      const owner = owners.get(center);
      if (owner === undefined || owner === userId) continue;
      const ring = [...new Set(idx.neighbors(center))].sort();
      if (ring.length < lo || ring.length > hi || !ring.every(claimed)) continue;
      if (ring.length - ring.filter((id) => held.has(id)).length < min) continue;
      // Taking the center would break the mission, so routes can't pass through it.
      const blocked = new Set([center]);
      const around = captureCosts(idx, held, { blocked });
      if (!ring.some((id) => !held.has(id) && (around.cost.get(id) ?? Infinity) <= reach)) continue;
      const plan = acquisitionPlan(idx, held, ring, ring.length, { blocked });
      if (!plan) continue;
      const e = estimate(plan, ring);
      if (fits(e)) rings.push(candidate({ kind: 'encirclement', center, ring }, 'route', e));
    }
    found.push(...drawn(rings));
  }

  // Hidden Triangle: three targets in at least two directions from the empire.
  {
    const { count, reveal, value, distance, spreadDegrees } = cfg.hiddenTriangle;
    const middle = centroid(idx, held);
    const pool = idx.ids.filter((id) => {
      const t = idx.byId.get(id)!;
      const c = cost(id);
      return (
        !held.has(id) &&
        claimed(id) &&
        !t.micro &&
        t.value >= value[0] &&
        t.value <= value[1] &&
        c >= distance[0] &&
        c <= distance[1]
      );
    });
    const triangles: SecretCandidate[] = [];
    if (middle && pool.length >= count) {
      const heading = new Map(pool.map((id) => [id, bearing(middle, idx.byId.get(id)!.anchor)]));
      for (let attempt = 0; attempt < 60; attempt++) {
        const targets = shuffled(pool, random).slice(0, count).sort();
        const spread = targets.some((a, i) =>
          targets.slice(i + 1).some((b) => angleBetween(heading.get(a)!, heading.get(b)!) >= spreadDegrees),
        );
        if (!spread) continue;
        const plan = acquisitionPlan(idx, held, targets, count);
        if (!plan) continue;
        const e = estimate(plan, targets);
        if (fits(e)) {
          triangles.push(candidate({ kind: 'hidden_triangle', territories: targets, need: count, reveal }, 'route', e));
        }
      }
    }
    found.push(...drawn(triangles));
  }

  // Two-Theater Power: the two continents where growing takes the fewest conquests.
  {
    const { netValue, newCount } = cfg.twoTheater;
    const continents = [...new Set(idx.dataset.territories.map((t) => t.continent))].sort();
    const theaters = continents.flatMap((c) => {
      const plan = valuePlan(
        idx,
        owners,
        held,
        (id) => idx.byId.get(id)!.continent === c,
        netValue,
        newCount,
        reach,
        max,
      );
      return plan ? [{ continent: c, plan }] : [];
    });
    const pairs: SecretCandidate[] = [];
    for (let i = 0; i < theaters.length; i++) {
      for (let j = i + 1; j < theaters.length; j++) {
        const [a, b] = [theaters[i]!, theaters[j]!];
        const conquests = [...new Set([...a.plan, ...b.plan])];
        const e: EffortEstimate = {
          conquests: conquests.length,
          inTheWay: 0,
          targetValue: valueOfSet(idx, conquests),
          rivals: new Set(conquests.map((id) => owners.get(id))).size,
        };
        if (!fits(e)) continue;
        const spec: SecretMissionSpec = {
          kind: 'two_theater_power',
          continents: [a.continent, b.continent],
          netValue,
          newCount,
        };
        pairs.push(candidate(spec, 'expansion', e));
      }
    }
    found.push(...drawn(pairs));
  }

  // Protected Expansion: needs two partners and someone else to take ground from.
  {
    const { partners, rounds, acquisitions, minPlayers } = cfg.protectedExpansion;
    const front = frontier(idx, owners, held);
    if (world.players.length >= minPlayers && front.length > 0) {
      const e: EffortEstimate = {
        conquests: acquisitions,
        inTheWay: 0,
        targetValue: 0,
        rivals: new Set(front.map((id) => owners.get(id))).size,
      };
      found.push(candidate({ kind: 'protected_expansion', partners, rounds, acquisitions }, 'expansion', e));
    }
  }

  return found.filter((c) => stillOpen(world, userId, cfg, c)).sort((a, b) => b.fit - a.fit);
}

/**
 * A greedy plan to gain `value` from at least `count` countries matching `where`, each conquest
 * the most valuable reachable one per step it costs. The conquests, or null if it takes more than
 * `max` or can't be done within `reach` of the empire.
 */
function valuePlan(
  idx: DatasetIndex,
  owners: ReadonlyMap<TerritoryId, UserId>,
  held: ReadonlySet<TerritoryId>,
  where: (id: TerritoryId) => boolean,
  value: number,
  count: number,
  reach: number,
  max: number,
): TerritoryId[] | null {
  const current = new Set(held);
  const conquests: TerritoryId[] = [];
  let gained = 0;
  let won = 0;
  while (gained < value || won < count) {
    const costs = captureCosts(idx, current);
    let best: { id: TerritoryId; score: number } | null = null;
    for (const id of idx.ids) {
      if (current.has(id) || !owners.has(id) || !where(id)) continue;
      const c = costs.cost.get(id);
      if (c === undefined || c > reach) continue;
      const score = (idx.byId.get(id)?.value ?? 0) / c;
      if (!best || score > best.score || (score === best.score && id < best.id)) best = { id, score };
    }
    if (!best) return null;
    for (const id of routeTo(costs, best.id)) {
      if (current.has(id)) continue;
      current.add(id);
      conquests.push(id);
      if (where(id)) {
        gained += idx.byId.get(id)?.value ?? 0;
        won++;
      }
    }
    if (conquests.length > max) return null;
  }
  return conquests;
}
