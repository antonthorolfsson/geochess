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
  type SecretMissionKind,
  type SecretMissionSpec,
} from './catalog';
import { evaluateMission } from './evaluate';
import { numberInWords } from './text';
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
  statOfSet,
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

/**
 * Why a public mission can't be played in this campaign, or null if it can. `players` is the size
 * of the table, when it's known: some missions are only for small ones.
 */
export function publicMissionIssue(
  kind: PublicMissionKind,
  idx: DatasetIndex,
  rules: CampaignRules,
  players?: number,
): string | null {
  const cfg = missionRules(rules.victory.version);
  if (!cfg.publicKinds.includes(kind)) return 'Campaigns created before it was added can’t play it.';
  const most = cfg.maxPlayers[kind];
  if (most !== undefined && players !== undefined && players > most) {
    return `Only for campaigns of up to ${numberInWords(most)} players.`;
  }
  const continents = new Set(idx.dataset.territories.map((t) => t.continent)).size;
  const onMap = (ids: readonly TerritoryId[]) => ids.every((id) => idx.byId.has(id));
  switch (kind) {
    case 'mare_nostrum':
      return onMap(cfg.mareNostrum.shores.flatMap((shore) => shore.territories))
        ? null
        : 'This map doesn’t have every Mediterranean country.';
    case 'seven_wonders':
      return onMap(cfg.sevenWonders.territories) ? null : 'This map doesn’t have every country with a wonder.';
    case 'one_billion':
      return statOfSet(idx, idx.ids, 'population') >= 3 * cfg.oneBillion.people
        ? null
        : 'This map has too few people for it.';
    case 'great_expanse':
      return statOfSet(idx, idx.ids, 'areaKm2') >= 3 * cfg.greatExpanse.areaKm2
        ? null
        : 'This map is too small for it.';
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
    return { kind: 'strategic_positions', territories: chosen.sort(), need, ...conquest(cfg) };
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
    if (b)
      return { kind: 'great_connection', endpoints: [a, b].sort() as [TerritoryId, TerritoryId], ...conquest(cfg) };
  }
  return null;
}

/** Positions need a country won since the draft, from version 3. */
const conquest = (cfg: MissionRules) => (cfg.positionsNeedConquest ? { needsConquest: true } : {});

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
        ...conquest(cfg),
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
      return { kind, ...cfg.continentalBridge, ...conquest(cfg) };
    case 'consolidation':
      return { kind, ...cfg.consolidation };
    case 'two_fronts':
      return { kind, ...cfg.twoFronts };
    case 'mare_nostrum': {
      const { shores, need, perShore } = cfg.mareNostrum;
      const copied = shores.map((s) => ({ name: s.name, territories: [...s.territories] }));
      return { kind, shores: copied, need, perShore, ...conquest(cfg) };
    }
    case 'one_billion':
      return { kind, ...cfg.oneBillion };
    case 'great_expanse':
      return { kind, ...cfg.greatExpanse };
    case 'seven_wonders':
      return { kind, ...cfg.sevenWonders, territories: [...cfg.sevenWonders.territories] };
    case 'kingslayer':
      return { kind, ...cfg.kingslayer };
    case 'lightning_campaign':
      return { kind, ...cfg.lightningCampaign };
  }
}

/** Countries a public mission names, which other missions should avoid. */
export function publicTargets(spec: PublicMissionSpec): TerritoryId[] {
  switch (spec.kind) {
    case 'regional_power':
    case 'strategic_positions':
    case 'seven_wonders':
      return spec.territories;
    case 'great_connection':
      return [...spec.endpoints];
    case 'mare_nostrum':
      return spec.shores.flatMap((shore) => shore.territories);
    default:
      return [];
  }
}

/**
 * Targeted missions first, so later ones can keep clear of earlier targets; fixed targets before
 * all of them, since they can't move.
 */
const GENERATION_ORDER: readonly PublicMissionKind[] = [
  'mare_nostrum',
  'seven_wonders',
  'regional_power',
  'great_connection',
  'strategic_positions',
];

/**
 * Public missions drawn at random, all different, from those the campaign can play: its version's,
 * and fit for this map, these rules and a table of `players`. At most `longDrawn` of them take a
 * long campaign (later ones are passed over), so a draw can't stack the rarely done ones. In
 * catalog order; fewer only if fewer fit.
 */
export function drawPublicKinds(
  idx: DatasetIndex,
  rules: CampaignRules,
  random: Random,
  players?: number,
): PublicMissionKind[] {
  const cfg = missionRules(rules.victory.version);
  const playable = cfg.publicKinds.filter((kind) => publicMissionIssue(kind, idx, rules, players) === null);
  const drawn: PublicMissionKind[] = [];
  let long = 0;
  for (const kind of shuffled(playable, random)) {
    if (drawn.length >= cfg.publicCount) break;
    if (cfg.long.includes(kind)) {
      if (long >= cfg.longDrawn) continue;
      long++;
    }
    drawn.push(kind);
  }
  return playable.filter((kind) => drawn.includes(kind));
}

export type PublicMissionsResult = { missions: PublicMissionSpec[] } | { error: string };

/** Four distinct, playable public missions with targets that don't overlap, for a table of `players`. */
export function generatePublicMissions(
  kinds: readonly PublicMissionKind[],
  idx: DatasetIndex,
  rules: CampaignRules,
  random: Random,
  players?: number,
): PublicMissionsResult {
  const cfg = missionRules(rules.victory.version);
  if (kinds.length !== cfg.publicCount) return { error: `Choose ${cfg.publicCount} public missions.` };
  if (new Set(kinds).size !== kinds.length) return { error: 'Each public mission can only be chosen once.' };
  for (const kind of kinds) {
    if (!PUBLIC_MISSION_KINDS.includes(kind)) return { error: 'That is not a public mission.' };
    const issue = publicMissionIssue(kind, idx, rules, players);
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
  /**
   * Conquests needed: the targets and the countries in the way. For battle missions, the wins
   * still needed (Backstab: the broken accord and the conquest).
   */
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
  // With more families than options, which families come first is drawn too.
  const families = cfg.families.length > cfg.secretOptions ? shuffled(cfg.families, random) : cfg.families;
  for (const family of families) draw(valid.filter((c) => c.family === family));
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
  const plan = gainPlan(idx, owners, heldBy(owners, userId), {
    worth: (id) => idx.byId.get(id)?.value ?? 0,
    where: () => true,
    gain,
    count: newCount,
    reach: cfg.effort.reach,
    max: cfg.effort.max,
  });
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

  const offers = (kind: SecretMissionKind) => cfg.secretKinds.includes(kind);
  const found: SecretCandidate[] = [];

  // Named sets, where this map has every country and enough of them to finish it hang together
  // (Nordic's Iceland lies apart, across the North Atlantic).
  for (const tpl of cfg.namedSets) {
    if (!offers(tpl.kind)) continue;
    const targets = [...tpl.territories];
    if (!targets.every((id) => idx.byId.has(id) && claimed(id))) continue;
    if (!components(idx, new Set(targets)).some((part) => part.length >= tpl.need)) continue;
    if (tpl.need - targets.filter((id) => held.has(id)).length < min || !inReach(targets)) continue;
    const plan = acquisitionPlan(idx, held, targets, tpl.need);
    if (!plan) continue;
    const e = estimate(plan, targets);
    if (fits(e)) {
      found.push(candidate({ kind: tpl.kind, territories: targets, need: tpl.need, reveal: tpl.reveal }, 'region', e));
    }
  }

  // Routes: two named countries to join, for an empire at one end (or within reach of it).
  for (const tpl of cfg.routes) {
    if (!offers(tpl.kind)) continue;
    const [a, b] = tpl.endpoints;
    const ends: TerritoryId[] = [a, b];
    if (!ends.every((id) => idx.byId.has(id) && claimed(id)) || !ends.some((id) => cost(id) <= reach)) continue;
    const route = routeTo(captureCosts(idx, held, { sources: [a] }), b);
    if (route.length === 0) continue;
    const conquests = route.filter((id) => !held.has(id));
    const e: EffortEstimate = {
      conquests: conquests.length,
      inTheWay: conquests.filter((id) => !ends.includes(id)).length,
      targetValue: valueOfSet(
        idx,
        conquests.filter((id) => ends.includes(id)),
      ),
      rivals: new Set(conquests.map((id) => owners.get(id))).size,
    };
    if (fits(e)) found.push(candidate({ kind: tpl.kind, endpoints: [a, b] }, 'route', e));
  }

  // Island Empire: the nearest islands.
  if (offers('island_empire')) {
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
  if (offers('mountain_kingdom')) {
    const { need, reveal, spread } = cfg.mountainKingdom;
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
          if (need - targets.filter((id) => held.has(id)).length < min || !inReach(targets)) continue;
          const plan = acquisitionPlan(idx, held, targets, need);
          if (!plan) continue;
          const e = estimate(plan, targets);
          if (fits(e)) {
            kingdoms.push(candidate({ kind: 'mountain_kingdom', territories: targets, need, reveal }, 'region', e));
          }
        }
      }
    }
    found.push(...drawn(kingdoms));
  }

  // Buffer Zone: the most valuable drafted country with a ring of workable size.
  if (offers('buffer_zone')) {
    const [lo, hi] = cfg.bufferZone.neighbors;
    const ringOf = (id: TerritoryId) => [...new Set(idx.neighbors(id))].sort();
    const center = [...base]
      .filter((id) => held.has(id) && ringOf(id).length >= lo && ringOf(id).length <= hi)
      .sort((a, b) => (idx.byId.get(b)?.value ?? 0) - (idx.byId.get(a)?.value ?? 0) || (a < b ? -1 : 1))[0];
    const ring = center ? ringOf(center) : [];
    if (center && ring.every(claimed) && ring.filter((id) => !held.has(id)).length >= min) {
      const plan = acquisitionPlan(idx, held, ring, ring.length);
      if (plan) {
        const e = estimate(plan, ring);
        if (fits(e)) found.push(candidate({ kind: 'buffer_zone', center, ring }, 'region', e));
      }
    }
  }

  // Unification: two drafted pieces that need at least two conquests to join.
  if (offers('unification')) {
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
  if (offers('encirclement')) {
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
  if (offers('hidden_triangle')) {
    const { count, need, reveal, value, distance, spreadDegrees } = cfg.hiddenTriangle;
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
        const plan = acquisitionPlan(idx, held, targets, need);
        if (!plan) continue;
        const e = estimate(plan, targets);
        if (fits(e)) {
          triangles.push(candidate({ kind: 'hidden_triangle', territories: targets, need, reveal }, 'route', e));
        }
      }
    }
    found.push(...drawn(triangles));
  }

  // Strait Keeper: three straits not held on both shores yet, from the nearest.
  if (offers('strait_keeper')) {
    const { count, reveal } = cfg.straitKeeper;
    const open = cfg.straits.filter(
      ({ shores: [a, b] }) =>
        idx.byId.has(a) &&
        idx.byId.has(b) &&
        idx.neighbors(a).includes(b) &&
        claimed(a) &&
        claimed(b) &&
        !(held.has(a) && held.has(b)),
    );
    const alone = new Map(
      open.map((st) => [st, acquisitionPlan(idx, held, st.shores, 2)?.conquests.length ?? Infinity]),
    );
    const nearest = open
      .filter((st) => alone.get(st)! <= max)
      .sort((x, y) => alone.get(x)! - alone.get(y)! || (x.name < y.name ? -1 : 1))
      .slice(0, 6);
    const sets: SecretCandidate[] = [];
    for (const straits of combinations(nearest, count)) {
      const targets = [...new Set(straits.flatMap((st) => st.shores))].sort();
      if (!inReach(targets)) continue;
      const plan = acquisitionPlan(idx, held, targets, targets.length);
      if (!plan) continue;
      const e = estimate(plan, targets);
      if (!fits(e)) continue;
      const spec: SecretMissionSpec = {
        kind: 'strait_keeper',
        straits: straits.map((st) => ({ name: st.name, shores: [st.shores[0], st.shores[1]] })),
        reveal,
      };
      sets.push(candidate(spec, 'route', e));
    }
    found.push(...drawn(sets));
  }

  // Two-Theater Power: the two continents where growing takes the fewest conquests.
  if (offers('two_theater_power')) {
    const { netValue, newCount } = cfg.twoTheater;
    const continents = [...new Set(idx.dataset.territories.map((t) => t.continent))].sort();
    const theaters = continents.flatMap((c) => {
      const plan = gainPlan(idx, owners, held, {
        worth: (id) => idx.byId.get(id)?.value ?? 0,
        where: (id) => idx.byId.get(id)!.continent === c,
        gain: netValue,
        count: newCount,
        reach,
        max,
      });
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

  // Half of Humanity: for an empire holding one of the two most populous countries.
  if (offers('half_of_humanity')) {
    const { sharePct } = cfg.halfOfHumanity;
    const people = (id: TerritoryId) => idx.byId.get(id)?.stats.population ?? 0;
    const giants = [...idx.ids].sort((a, b) => people(b) - people(a) || (a < b ? -1 : 1)).slice(0, 2);
    if (giants.some((id) => held.has(id))) {
      const short = (statOfSet(idx, idx.ids, 'population') * sharePct) / 100 - statOfSet(idx, held, 'population');
      const plan = gainPlan(idx, owners, held, { worth: people, where: () => true, gain: short, count: 0, reach, max });
      if (plan) {
        const e: EffortEstimate = {
          conquests: plan.length,
          inTheWay: 0,
          targetValue: valueOfSet(idx, plan),
          rivals: new Set(plan.map((id) => owners.get(id))).size,
        };
        if (fits(e)) found.push(candidate({ kind: 'half_of_humanity', sharePct }, 'expansion', e));
      }
    }
  }

  // Protected Expansion: needs two partners and someone else to take ground from.
  if (offers('protected_expansion')) {
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

  // Nemesis: the rival with the longest shared front (the most of their countries bordering yours).
  if (offers('nemesis') && world.players.length >= (cfg.nemesis.minPlayers ?? 0)) {
    const { count, reveal } = cfg.nemesis;
    const fronts = new Map<UserId, TerritoryId[]>();
    for (const id of frontier(idx, owners, held)) {
      const owner = owners.get(id)!;
      fronts.set(owner, [...(fronts.get(owner) ?? []), id]);
    }
    const [rival, front] = [...fronts].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))[0] ?? [];
    if (rival && front && heldBy(owners, rival).size >= count) {
      const easiest = [...front]
        .sort((a, b) => (idx.byId.get(a)?.value ?? 0) - (idx.byId.get(b)?.value ?? 0) || (a < b ? -1 : 1))
        .slice(0, count);
      const e: EffortEstimate = { conquests: count, inTheWay: 0, targetValue: valueOfSet(idx, easiest), rivals: 1 };
      found.push(candidate({ kind: 'nemesis', rival, count, reveal }, 'battle', e));
    }
  }

  // Backstab, Iron Wall and Checkmate Artist are about battles, not the map: they fit anyone (Iron
  // Wall only at tables big enough that one rival can't deny it by never attacking).
  const opponents = world.players.length - 1;
  if (offers('backstab') && opponents > 0) {
    // The accord to break, then the conquests.
    const e: EffortEstimate = { conquests: 1 + (cfg.backstab.count ?? 1), inTheWay: 0, targetValue: 0, rivals: 1 };
    found.push(candidate({ kind: 'backstab', ...cfg.backstab }, 'battle', e));
  }
  if (offers('iron_wall') && opponents > 0 && world.players.length >= cfg.ironWall.minPlayers) {
    const { wins } = cfg.ironWall;
    const e: EffortEstimate = { conquests: wins, inTheWay: 0, targetValue: 0, rivals: opponents };
    found.push(candidate({ kind: 'iron_wall', wins }, 'battle', e));
  }
  if (offers('checkmate_artist') && opponents > 0) {
    const { wins } = cfg.checkmateArtist;
    const e: EffortEstimate = { conquests: wins, inTheWay: 0, targetValue: 0, rivals: opponents };
    found.push(candidate({ kind: 'checkmate_artist', wins }, 'battle', e));
  }

  return found.filter((c) => stillOpen(world, userId, cfg, c)).sort((a, b) => b.fit - a.fit);
}

/**
 * A greedy plan to gain `gain` of what `worth` measures (value, people) from at least `count`
 * countries matching `where`, each conquest the one worth most per step it costs. The conquests,
 * or null if it takes more than `max` or can't be done within `reach` of the empire.
 */
function gainPlan(
  idx: DatasetIndex,
  owners: ReadonlyMap<TerritoryId, UserId>,
  held: ReadonlySet<TerritoryId>,
  opts: {
    worth: (id: TerritoryId) => number;
    where: (id: TerritoryId) => boolean;
    gain: number;
    count: number;
    reach: number;
    max: number;
  },
): TerritoryId[] | null {
  const { worth, where, gain, count, reach, max } = opts;
  const current = new Set(held);
  const conquests: TerritoryId[] = [];
  let gained = 0;
  let won = 0;
  while (gained < gain || won < count) {
    const costs = captureCosts(idx, current);
    let best: { id: TerritoryId; score: number } | null = null;
    for (const id of idx.ids) {
      if (current.has(id) || !owners.has(id) || !where(id)) continue;
      const c = costs.cost.get(id);
      if (c === undefined || c > reach) continue;
      const score = worth(id) / c;
      if (!best || score > best.score || (score === best.score && id < best.id)) best = { id, score };
    }
    if (!best) return null;
    for (const id of routeTo(costs, best.id)) {
      if (current.has(id)) continue;
      current.add(id);
      conquests.push(id);
      if (where(id)) {
        gained += worth(id);
        won++;
      }
    }
    if (conquests.length > max) return null;
  }
  return conquests;
}

/** Every way of choosing `k` of `items`, in order. */
function combinations<T>(items: readonly T[], k: number, from = 0): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  for (let i = from; i <= items.length - k; i++) {
    for (const rest of combinations(items, k - 1, i + 1)) out.push([items[i]!, ...rest]);
  }
  return out;
}
