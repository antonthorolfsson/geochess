/**
 * Mission evaluators: where a player stands on a mission, as structured progress (several parts
 * where a mission has several requirements), whether it's complete, whether it's one meaningful
 * step away (the reveal trigger for secret missions), and the countries and wars that count.
 */
import type { Continent, TerritoryId } from '../dataset';
import type { UserId } from '../draft';
import { conceded } from '../war';
import type { MissionSpec, Shore, SpecOf } from './catalog';
import { CONTINENT_NAMES } from './text';
import {
  captureCosts,
  components,
  currentRound,
  frontier,
  heldBy,
  leadersAt,
  pathThrough,
  pathWithin,
  pointsAt,
  roundAt,
  routeTo,
  statOfSet,
  valueOfSet,
  withTransfers,
  type MissionWar,
  type MissionWorld,
} from './world';

/** One requirement of a mission and how far along it is. Several parts make a mission. */
export interface ProgressPart {
  label: string;
  have: number;
  need: number;
  done: boolean;
  /** What the figures measure, when they aren't counts (see `partAmount`). */
  unit?: 'people' | 'km2' | 'percent';
}

export interface MissionEvidence {
  /** The countries that count toward the mission right now. */
  territories: TerritoryId[];
  /** A route, for connection missions: the chain held, or the best one still open. */
  path?: TerritoryId[];
  /** The wars that count, for battle missions. */
  wars?: string[];
}

export interface Evaluation {
  complete: boolean;
  /**
   * One meaningful step from completion, by the mission's own reveal rule (always true once
   * complete). Secret missions are revealed when this first turns true.
   */
  near: boolean;
  parts: ProgressPart[];
  evidence: MissionEvidence;
}

interface Check {
  complete: boolean;
  parts: ProgressPart[];
  evidence: MissionEvidence;
}

/** A player's view of the world, worked out once per evaluation. */
interface Scope {
  world: MissionWorld;
  userId: UserId;
  held: Set<TerritoryId>;
  /** Their holdings when the draft finished. */
  base: ReadonlySet<TerritoryId>;
  /** Held now, but not at the baseline: won since the draft (recapturing a drafted country doesn't count). */
  fresh: Set<TerritoryId>;
}

function scopeOf(world: MissionWorld, userId: UserId): Scope {
  const held = heldBy(world.owners, userId);
  const base = world.baseline.get(userId) ?? new Set<TerritoryId>();
  const fresh = new Set([...held].filter((id) => !base.has(id)));
  return { world, userId, held, base, fresh };
}

const part = (label: string, have: number, need: number, unit?: ProgressPart['unit']): ProgressPart => ({
  label,
  have,
  need,
  done: have >= need,
  ...(unit && { unit }),
});
const allDone = (parts: readonly ProgressPart[]) => parts.every((p) => p.done);
const sorted = (ids: Iterable<TerritoryId>) => [...ids].sort();

interface Evaluator {
  check(s: Scope): Check;
  /** The reveal rule, checked when the mission isn't complete. */
  near?(s: Scope, check: Check): boolean;
}

/** Where `userId` stands on a mission. */
export function evaluateMission(world: MissionWorld, userId: UserId, spec: MissionSpec): Evaluation {
  const s = scopeOf(world, userId);
  const e = evaluatorFor(spec);
  const check = e.check(s);
  return { ...check, near: check.complete || (e.near?.(s, check) ?? false) };
}

/** Whether `userId` has completed a mission: the ownership (or history) predicate alone. */
export function missionComplete(world: MissionWorld, userId: UserId, spec: MissionSpec): boolean {
  return evaluatorFor(spec).check(scopeOf(world, userId)).complete;
}

/**
 * Whether one conquest could complete the mission: a country held by another player that borders
 * the empire. Tokens, truces, locks and accords only delay such an attack, so they're ignored.
 */
function oneConquestAway(s: Scope, spec: MissionSpec): boolean {
  const e = evaluatorFor(spec);
  for (const id of frontier(s.world.idx, s.world.owners, s.held)) {
    const from = s.world.owners.get(id)!;
    const after = withTransfers(s.world, [{ territoryId: id, from, to: s.userId }]);
    if (e.check(scopeOf(after, s.userId)).complete) return true;
  }
  return false;
}

function evaluatorFor(spec: MissionSpec): Evaluator {
  switch (spec.kind) {
    case 'expansion':
      return { check: (s) => expansion(s, spec) };
    case 'regional_power':
      return { check: (s) => regionalPower(s, spec) };
    case 'strategic_positions':
      return { check: (s) => withConquest(s, spec, ownCount(s, spec.territories, spec.need, 'Positions held')) };
    case 'great_connection':
      return { check: (s) => connection(s, spec.endpoints, 'Endpoints held', spec.needsConquest) };
    case 'campaign_veteran':
      return { check: (s) => veteran(s, spec) };
    case 'great_powers':
      return { check: (s) => greatPowers(s, spec) };
    case 'across_the_seas':
      return { check: (s) => acrossTheSeas(s, spec) };
    case 'continental_bridge':
      return { check: (s) => continentalBridge(s, spec) };
    case 'consolidation':
      return { check: (s) => consolidation(s, spec) };
    case 'two_fronts':
      return { check: (s) => twoFronts(s, spec) };
    case 'mare_nostrum':
      return { check: (s) => mareNostrum(s, spec) };
    case 'one_billion':
      return { check: (s) => wonMeasure(s, 'population', 'People in countries won since the draft', spec.people) };
    case 'great_expanse':
      return { check: (s) => wonMeasure(s, 'areaKm2', 'Land won since the draft', spec.areaKm2) };
    case 'seven_wonders':
      return { check: (s) => sevenWonders(s, spec) };
    case 'kingslayer':
      return { check: (s) => kingslayer(s, spec) };
    case 'lightning_campaign':
      return { check: (s) => lightningCampaign(s, spec) };
    case 'northern_passage':
    case 'caribbean_chain':
    case 'pacific_passage':
    case 'mediterranean_arc':
    case 'central_asian_union':
    case 'black_sea':
    case 'baltic_league':
    case 'gulf_hegemon':
    case 'caspian':
    case 'nordic':
    case 'horn_of_africa':
    case 'andean_spine':
    case 'mekong':
    case 'mountain_kingdom':
    case 'hidden_triangle':
      return {
        check: (s) => ownCount(s, spec.territories, spec.need, 'Targets held'),
        near: (s) => spec.territories.filter((id) => s.held.has(id)).length >= spec.reveal,
      };
    case 'silk_road':
    case 'cape_to_cairo':
    case 'pan_american_highway':
      return { check: (s) => connection(s, spec.endpoints, 'Ends held'), near: (s) => oneConquestAway(s, spec) };
    case 'buffer_zone':
      return {
        check: (s) => bufferZone(s, spec),
        near: (s) => [spec.center, ...spec.ring].filter((id) => !s.held.has(id)).length <= 1,
      };
    case 'strait_keeper':
      return {
        check: (s) => straitKeeper(s, spec),
        near: (s) => straitsHeld(s, spec).length >= spec.reveal,
      };
    case 'half_of_humanity':
      return { check: (s) => halfOfHumanity(s, spec), near: (s) => oneConquestAway(s, spec) };
    case 'nemesis':
      return { check: (s) => nemesis(s, spec), near: (s) => takenFrom(s, spec.rival).length >= spec.reveal };
    case 'backstab':
      return {
        check: (s) => backstab(s, spec),
        // An accord broken, and still time to strike.
        near: (s) => betrayals(s).some((b) => currentRound(s.world.history) <= b.round + spec.rounds),
      };
    case 'iron_wall':
      return { check: (s) => ironWall(s, spec), near: (s) => defensiveWins(s).length >= spec.wins - 1 };
    case 'checkmate_artist':
      return { check: (s) => checkmateArtist(s, spec), near: (s) => checkmates(s).length >= spec.wins - 1 };
    case 'island_empire':
      return {
        check: (s) => islandEmpire(s, spec),
        near: (s) =>
          spec.territories.filter((id) => s.held.has(id)).length >= spec.need - 1 && oneConquestAway(s, spec),
      };
    case 'unification':
      return { check: (s) => unification(s, spec), near: (s) => oneConquestAway(s, spec) };
    case 'encirclement':
      return {
        check: (s) => encirclement(s, spec),
        near: (s) => {
          const owner = s.world.owners.get(spec.center);
          const ring = spec.ring.filter((id) => s.held.has(id)).length;
          return owner !== undefined && owner !== s.userId && ring >= spec.ring.length - 1;
        },
      };
    case 'two_theater_power':
      return {
        check: (s) => twoTheaters(s, spec),
        near: (s) => theatersDone(s, spec) >= 1 && oneConquestAway(s, spec),
      };
    case 'protected_expansion':
      return {
        check: (s) => protectedExpansion(s, spec),
        near: (s) =>
          protectedEpisodes(s).some((e) => e.rounds >= spec.rounds && e.held.length >= spec.acquisitions - 1),
      };
    case 'measured_expansion':
      return {
        check: (s) => measuredExpansion(s, spec),
        near: (s) => {
          const net = valueOfSet(s.world.idx, s.held) - valueOfSet(s.world.idx, s.base);
          return (net >= spec.revealGain && s.fresh.size >= spec.revealNew) || oneConquestAway(s, spec);
        },
      };
  }
}

// ---------------------------------------------------------------------------------------------
// Ownership

function netValue(s: Scope): number {
  return valueOfSet(s.world.idx, s.held) - valueOfSet(s.world.idx, s.base);
}

function expansion(s: Scope, spec: SpecOf<'expansion'>): Check {
  const parts = [part('Value gained since the draft', netValue(s), spec.gain)];
  return { complete: allDone(parts), parts, evidence: { territories: sorted(s.fresh) } };
}

function measuredExpansion(s: Scope, spec: SpecOf<'measured_expansion'>): Check {
  const parts = [
    part('Value gained since the draft', netValue(s), spec.gain),
    part('Countries won since the draft', s.fresh.size, spec.newCount),
  ];
  return { complete: allDone(parts), parts, evidence: { territories: sorted(s.fresh) } };
}

/**
 * A position that counts only with at least one of its countries (the evidence) won since the
 * draft, when the spec asks for it. Holding more of the position never hurts, so the countries
 * held are the position.
 */
function withConquest(s: Scope, spec: { needsConquest?: boolean }, check: Check): Check {
  if (!spec.needsConquest) return check;
  const won = check.evidence.territories.filter((id) => s.fresh.has(id)).length;
  const parts = [...check.parts, part('Of them won since the draft', won, 1)];
  return { ...check, complete: allDone(parts), parts };
}

function regionalPower(s: Scope, spec: SpecOf<'regional_power'>): Check {
  const held = spec.territories.filter((id) => s.held.has(id)).sort();
  const parts = [
    part(`Value held in ${spec.region}`, valueOfSet(s.world.idx, held), spec.needValue),
    part(`Countries held in ${spec.region}`, held.length, spec.minTerritories),
  ];
  return withConquest(s, spec, { complete: allDone(parts), parts, evidence: { territories: held } });
}

function ownCount(s: Scope, targets: readonly TerritoryId[], need: number, label: string): Check {
  const held = targets.filter((id) => s.held.has(id)).sort();
  const parts = [part(label, held.length, need)];
  return { complete: allDone(parts), parts, evidence: { territories: held } };
}

function greatPowers(s: Scope, spec: SpecOf<'great_powers'>): Check {
  const big = [...s.held].filter((id) => (s.world.idx.byId.get(id)?.value ?? 0) >= spec.minValue).sort();
  const won = big.filter((id) => !s.base.has(id));
  const parts = [
    part(`Countries worth ${spec.minValue} or more`, big.length, spec.count),
    part('Of them won since the draft', won.length, spec.newCount),
  ];
  return { complete: allDone(parts), parts, evidence: { territories: big } };
}

function islandEmpire(s: Scope, spec: SpecOf<'island_empire'>): Check {
  const held = spec.territories.filter((id) => s.held.has(id)).sort();
  const won = held.filter((id) => !s.base.has(id));
  const parts = [
    part('Islands held', held.length, spec.need),
    part('Of them won since the draft', won.length, spec.newCount),
  ];
  return { complete: allDone(parts), parts, evidence: { territories: held } };
}

function encirclement(s: Scope, spec: SpecOf<'encirclement'>): Check {
  const held = spec.ring.filter((id) => s.held.has(id)).sort();
  const owner = s.world.owners.get(spec.center);
  const centerName = s.world.idx.byId.get(spec.center)?.name ?? spec.center;
  const parts = [
    part(`Neighbors of ${centerName} held`, held.length, spec.ring.length),
    part(`${centerName} held by someone else`, owner !== undefined && owner !== s.userId ? 1 : 0, 1),
  ];
  return { complete: allDone(parts), parts, evidence: { territories: held } };
}

function continentOf(s: Scope, id: TerritoryId): Continent | undefined {
  return s.world.idx.byId.get(id)?.continent;
}

function twoFronts(s: Scope, spec: SpecOf<'two_fronts'>): Check {
  const byContinent = new Map<Continent, TerritoryId[]>();
  for (const id of s.fresh) {
    const c = continentOf(s, id);
    if (c) byContinent.set(c, [...(byContinent.get(c) ?? []), id]);
  }
  const fronts = [...byContinent].filter(([, ids]) => ids.length >= spec.perContinent);
  const parts = [
    part(`Continents with ${spec.perContinent}+ countries won since the draft`, fronts.length, spec.continents),
  ];
  return { complete: allDone(parts), parts, evidence: { territories: sorted(fronts.flatMap(([, ids]) => ids)) } };
}

interface Theater {
  net: number;
  won: number;
  done: boolean;
}

function theater(s: Scope, spec: SpecOf<'two_theater_power'>, continent: Continent): Theater {
  const idx = s.world.idx;
  const held = [...s.held].filter((id) => continentOf(s, id) === continent);
  const base = [...s.base].filter((id) => continentOf(s, id) === continent);
  const net = valueOfSet(idx, held) - valueOfSet(idx, base);
  const won = held.filter((id) => !s.base.has(id)).length;
  return { net, won, done: net >= spec.netValue && won >= spec.newCount };
}

const theatersDone = (s: Scope, spec: SpecOf<'two_theater_power'>) =>
  spec.continents.filter((c) => theater(s, spec, c).done).length;

function twoTheaters(s: Scope, spec: SpecOf<'two_theater_power'>): Check {
  const parts: ProgressPart[] = [];
  for (const c of spec.continents) {
    const t = theater(s, spec, c);
    parts.push(part(`${CONTINENT_NAMES[c]}: value gained`, t.net, spec.netValue));
    parts.push(part(`${CONTINENT_NAMES[c]}: countries won`, t.won, spec.newCount));
  }
  const territories = [...s.fresh].filter((id) => spec.continents.includes(continentOf(s, id)!));
  return { complete: allDone(parts), parts, evidence: { territories: sorted(territories) } };
}

function mareNostrum(s: Scope, spec: SpecOf<'mare_nostrum'>): Check {
  const heldOn = (shore: Shore) => shore.territories.filter((id) => s.held.has(id));
  const held = sorted(new Set(spec.shores.flatMap(heldOn)));
  const parts = [
    part('Mediterranean countries held', held.length, spec.need),
    ...spec.shores.map((shore) => part(`Held on the ${shore.name} shore`, heldOn(shore).length, spec.perShore)),
  ];
  return withConquest(s, spec, { complete: allDone(parts), parts, evidence: { territories: held } });
}

/** A real-world figure summed over the countries won since the draft, and still held. */
function wonMeasure(s: Scope, key: 'population' | 'areaKm2', label: string, need: number): Check {
  const have = statOfSet(s.world.idx, s.fresh, key);
  const parts = [part(label, have, need, key === 'population' ? 'people' : 'km2')];
  return { complete: allDone(parts), parts, evidence: { territories: sorted(s.fresh) } };
}

function sevenWonders(s: Scope, spec: SpecOf<'seven_wonders'>): Check {
  const held = spec.territories.filter((id) => s.held.has(id)).sort();
  const won = held.filter((id) => !s.base.has(id));
  const parts = [
    part('Wonder countries held', held.length, spec.count),
    part('Of them won since the draft', won.length, spec.newCount),
  ];
  return { complete: allDone(parts), parts, evidence: { territories: held } };
}

function halfOfHumanity(s: Scope, spec: SpecOf<'half_of_humanity'>): Check {
  const idx = s.world.idx;
  const world = statOfSet(idx, idx.ids, 'population');
  const people = statOfSet(idx, s.held, 'population');
  const share = part(
    'Share of the world’s people',
    world > 0 ? Math.floor((people * 100) / world) : 0,
    spec.sharePct,
    'percent',
  );
  // The share is compared exactly, not rounded down.
  share.done = world > 0 && people * 100 >= spec.sharePct * world;
  return { complete: share.done, parts: [share], evidence: { territories: sorted(s.held) } };
}

/** Countries held now that were taken from `rival`: won in a war, or paid as tribute. */
/**
 * The wars battle missions count: every war that ended, except those won without a game because
 * the other side backed down after raising.
 */
const battles = (s: Scope) => s.world.history.wars.filter((w) => !conceded(w.outcome));

function takenFrom(s: Scope, rival: UserId): TerritoryId[] {
  const taken = new Set<TerritoryId>();
  for (const w of battles(s)) {
    for (const t of w.transfers) if (t.from === rival && t.to === s.userId) taken.add(t.territoryId);
  }
  return [...taken].filter((id) => s.held.has(id)).sort();
}

function nemesis(s: Scope, spec: SpecOf<'nemesis'>): Check {
  const held = takenFrom(s, spec.rival);
  const parts = [part('Countries taken from the rival and still held', held.length, spec.count)];
  return { complete: allDone(parts), parts, evidence: { territories: held } };
}

// ---------------------------------------------------------------------------------------------
// Routes and blocks

/**
 * Both ends held and joined through the player's countries (with `needsConquest`, by a chain
 * through a country won since the draft); otherwise the best route still open.
 */
function connection(
  s: Scope,
  [a, b]: readonly [TerritoryId, TerritoryId],
  endsLabel: string,
  needsConquest = false,
): Check {
  const idx = s.world.idx;
  const ends = [a, b].filter((id) => s.held.has(id)).length;
  const wonOn = (ids: readonly TerritoryId[]) =>
    part('Countries won since the draft on it', ids.filter((id) => s.fresh.has(id)).length, 1);
  const chain = pathWithin(idx, s.held, a, b);
  if (chain) {
    const through = needsConquest ? pathThrough(idx, s.held, a, b, s.fresh) : chain;
    const shown = through ?? chain;
    const parts = [part(endsLabel, 2, 2), part('Countries held on the route', shown.length, shown.length)];
    if (needsConquest) parts.push(wonOn(through ?? []));
    return { complete: through !== null, parts, evidence: { territories: shown, path: shown } };
  }
  const route = routeTo(captureCosts(idx, s.held, { sources: [a] }), b);
  const onRoute = route.filter((id) => s.held.has(id));
  const parts = [part(endsLabel, ends, 2), part('Countries held on the best route', onRoute.length, route.length || 1)];
  if (needsConquest) parts.push(wonOn(onRoute));
  return { complete: false, parts, evidence: { territories: onRoute, path: route } };
}

function unification(s: Scope, spec: SpecOf<'unification'>): Check {
  const idx = s.world.idx;
  const [a, b] = spec.marks;
  if (s.held.has(a) && s.held.has(b)) {
    // Within the empire, the route joining the marks through the fewest new countries. The marks
    // were chosen so that any route needs at least `newCount` of them.
    const notHeld = new Set(idx.ids.filter((id) => !s.held.has(id)));
    const inside = captureCosts(idx, new Set([...s.held].filter((id) => s.base.has(id))), {
      sources: [a],
      blocked: notHeld,
    });
    const newOnRoute = inside.cost.get(b);
    if (newOnRoute !== undefined) {
      const chain = routeTo(inside, b);
      const parts = [
        part('Marked countries held', 2, 2),
        part('Countries won since the draft on the link', newOnRoute, spec.newCount),
      ];
      return { complete: allDone(parts), parts, evidence: { territories: chain, path: chain } };
    }
  }
  const open = connection(s, spec.marks, 'Marked countries held');
  return { ...open, complete: false };
}

function bufferZone(s: Scope, spec: SpecOf<'buffer_zone'>): Check {
  const name = s.world.idx.byId.get(spec.center)?.name ?? spec.center;
  const center = s.held.has(spec.center);
  const ring = spec.ring.filter((id) => s.held.has(id)).sort();
  const parts = [
    part(`${name} held`, center ? 1 : 0, 1),
    part(`Neighbors of ${name} held`, ring.length, spec.ring.length),
  ];
  return { complete: allDone(parts), parts, evidence: { territories: sorted(center ? [spec.center, ...ring] : ring) } };
}

const straitsHeld = (s: Scope, spec: SpecOf<'strait_keeper'>) =>
  spec.straits.filter((strait) => strait.shores.every((id) => s.held.has(id)));

function straitKeeper(s: Scope, spec: SpecOf<'strait_keeper'>): Check {
  const parts = [part('Straits held on both shores', straitsHeld(s, spec).length, spec.straits.length)];
  const shores = spec.straits.flatMap((strait) => strait.shores).filter((id) => s.held.has(id));
  return { complete: allDone(parts), parts, evidence: { territories: sorted(new Set(shores)) } };
}

function continentalBridge(s: Scope, spec: SpecOf<'continental_bridge'>): Check {
  let best: { parts: ProgressPart[]; complete: boolean; block: TerritoryId[] } | null = null;
  for (const block of components(s.world.idx, s.held)) {
    const perContinent = new Map<Continent, number>();
    for (const id of block) {
      const c = continentOf(s, id);
      if (c) perContinent.set(c, (perContinent.get(c) ?? 0) + 1);
    }
    const spanned = [...perContinent.values()].filter((n) => n >= spec.perContinent).length;
    const parts = [
      part(`Continents with ${spec.perContinent}+ countries in one connected block`, spanned, spec.continents),
    ];
    if (spec.needsConquest) {
      parts.push(part('Countries won since the draft in it', block.filter((id) => s.fresh.has(id)).length, 1));
    }
    const complete = allDone(parts);
    // The block that completes it, else the one spanning most continents, then the one with most won.
    const better =
      !best ||
      (complete && !best.complete) ||
      (complete === best.complete &&
        (parts[0]!.have > best.parts[0]!.have ||
          (parts[0]!.have === best.parts[0]!.have && (parts[1]?.have ?? 0) > (best.parts[1]?.have ?? 0))));
    if (better) best = { parts, complete, block };
  }
  if (!best) {
    const parts = [part(`Continents with ${spec.perContinent}+ countries in one connected block`, 0, spec.continents)];
    if (spec.needsConquest) parts.push(part('Countries won since the draft in it', 0, 1));
    return { complete: false, parts, evidence: { territories: [] } };
  }
  return { complete: best.complete, parts: best.parts, evidence: { territories: best.block } };
}

/** Every way of choosing `k` of `items`, in order. */
function* choose<T>(items: readonly T[], k: number, from = 0): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = from; i <= items.length - k; i++) {
    for (const rest of choose(items, k - 1, i + 1)) yield [items[i]!, ...rest];
  }
}

/**
 * The fewest countries won since the draft that the drafted pieces inside a block need to be
 * joined up, counted up to `cap`. Parallel links count once, as does a country touching several
 * pieces: the question is how many new countries the join can't do without.
 */
function linkingCountries(
  s: Scope,
  block: ReadonlySet<TerritoryId>,
  pieceOf: ReadonlyMap<TerritoryId, number>,
  cap: number,
): number {
  const idx = s.world.idx;
  const drafted = new Map<number, TerritoryId[]>();
  const fresh: TerritoryId[] = [];
  for (const id of block) {
    if (!s.base.has(id)) fresh.push(id);
    else drafted.set(pieceOf.get(id)!, [...(drafted.get(pieceOf.get(id)!) ?? []), id]);
  }
  if (drafted.size < 2) return 0;
  // Whether the block's drafted countries and just these new ones join every piece. A piece counts
  // as one place, even if losses since the draft have split it.
  const joins = (links: ReadonlySet<TerritoryId>) => {
    const [first] = drafted.keys();
    const reached = new Set([first!]);
    const queue = [...drafted.get(first!)!];
    const seen = new Set(queue);
    const visit = (id: TerritoryId) => {
      if (seen.has(id)) return;
      seen.add(id);
      queue.push(id);
    };
    for (let i = 0; i < queue.length; i++) {
      for (const n of idx.neighbors(queue[i]!)) {
        if (!block.has(n) || !(s.base.has(n) || links.has(n))) continue;
        visit(n);
        const piece = s.base.has(n) ? pieceOf.get(n)! : null;
        if (piece !== null && !reached.has(piece)) {
          reached.add(piece);
          drafted.get(piece)!.forEach(visit);
        }
      }
    }
    return reached.size === drafted.size;
  };
  for (let k = 1; k < cap; k++) {
    for (const links of choose(fresh, k)) if (joins(new Set(links))) return k;
  }
  return cap;
}

function consolidation(s: Scope, spec: SpecOf<'consolidation'>): Check {
  const idx = s.world.idx;
  const total = valueOfSet(idx, s.held);
  const pieces = components(idx, new Set(s.base));
  const pieceOf = new Map<TerritoryId, number>();
  pieces.forEach((piece, i) => piece.forEach((id) => pieceOf.set(id, i)));
  const scattered = pieces.length > 1;

  interface Candidate {
    block: TerritoryId[];
    value: number;
    parts: ProgressPart[];
  }
  let best: (Candidate & { complete: boolean }) | null = null;
  for (const block of components(idx, s.held)) {
    const set = new Set(block);
    const value = valueOfSet(idx, block);
    const share = total > 0 ? Math.floor((value * 100) / total) : 0;
    const won = block.filter((id) => !s.base.has(id)).length;
    const joined = new Set(block.flatMap((id) => (s.base.has(id) ? [pieceOf.get(id)!] : [])));
    const parts = [part('Share of empire value in one connected block', share, spec.sharePct)];
    // The share is compared exactly, not rounded down.
    parts[0]!.done = value * 100 >= spec.sharePct * total && total > 0;
    if (scattered) {
      parts.push(part('Drafted pieces it joins', joined.size, 2));
      parts.push(
        part(
          'Countries won since the draft that the join needs',
          linkingCountries(s, set, pieceOf, spec.newCount),
          spec.newCount,
        ),
      );
    } else {
      parts.push(part('Countries won since the draft in it', won, spec.newCount));
      parts.push(part('Drafted countries in it', Math.min(joined.size, 1), 1));
    }
    const complete = allDone(parts);
    if (!best || (complete && !best.complete) || (complete === best.complete && value > best.value)) {
      best = { block, value, parts, complete };
    }
  }
  if (!best) {
    const parts = [part('Share of empire value in one connected block', 0, spec.sharePct)];
    return { complete: false, parts, evidence: { territories: [] } };
  }
  return { complete: best.complete, parts: best.parts, evidence: { territories: best.block } };
}

// ---------------------------------------------------------------------------------------------
// History

function isWin(war: MissionWorld['history']['wars'][number], userId: UserId): boolean {
  return (
    (war.outcome === 'attacker' && war.attackerId === userId) ||
    (war.outcome === 'defender' && war.defenderId === userId)
  );
}

function veteran(s: Scope, spec: SpecOf<'campaign_veteran'>): Check {
  const wins = s.world.history.wars.filter(
    (w) => isWin(w, s.userId) && (!spec.attackOnly || w.attackerId === s.userId),
  );
  const opponents = new Set(wins.map((w) => (w.attackerId === s.userId ? w.defenderId : w.attackerId)));
  const attacking = wins.filter((w) => w.attackerId === s.userId).length;
  // Nobody can beat more opponents than there are: with two players there is only one.
  const opponentsNeeded = Math.min(spec.opponents, Math.max(1, s.world.players.length - 1));
  const parts = spec.attackOnly
    ? [
        part('Wars won as the attacker', wins.length, spec.wins),
        part('Different opponents beaten', opponents.size, opponentsNeeded),
      ]
    : [
        part('Wars won', wins.length, spec.wins),
        part('Different opponents beaten', opponents.size, opponentsNeeded),
        part('Won as the attacker', attacking, spec.attackWins),
      ];
  return { complete: allDone(parts), parts, evidence: { territories: [], wars: wins.map((w) => w.id) } };
}

/** The wars that count, for missions about battles rather than countries. */
const warEvidence = (wars: readonly MissionWar[]): MissionEvidence => ({
  territories: [],
  wars: wars.map((w) => w.id),
});

/**
 * Whether a war was declared on the leader of the race by someone trailing: without a `lead`, the
 * leader on points, then value; with one, on points alone, at least `lead` points ahead.
 */
function declaredOnLeader(world: MissionWorld, war: MissionWar, lead: number | undefined): boolean {
  if (lead === undefined) {
    const leaders = leadersAt(world, war.declaredSeq);
    return leaders.includes(war.defenderId) && !leaders.includes(war.attackerId);
  }
  const points = pointsAt(world, war.declaredSeq);
  const top = Math.max(0, ...points.values());
  const theirs = points.get(war.defenderId) ?? 0;
  return theirs === top && theirs >= (points.get(war.attackerId) ?? 0) + lead;
}

function kingslayer(s: Scope, spec: SpecOf<'kingslayer'>): Check {
  const wins = s.world.history.wars.filter(
    (w) => w.attackerId === s.userId && w.outcome === 'attacker' && declaredOnLeader(s.world, w, spec.lead),
  );
  const parts = [part('Wars won against the leader', wins.length, 1)];
  return { complete: allDone(parts), parts, evidence: warEvidence(wins) };
}

function lightningCampaign(s: Scope, spec: SpecOf<'lightning_campaign'>): Check {
  const byRound = new Map<number, MissionWar[]>();
  for (const w of s.world.history.wars) {
    if (w.attackerId !== s.userId || w.outcome !== 'attacker') continue;
    byRound.set(w.declaredRound, [...(byRound.get(w.declaredRound) ?? []), w]);
  }
  const best = [...byRound.values()].reduce<MissionWar[]>((b, wars) => (wars.length > b.length ? wars : b), []);
  const parts = [part('Wars declared in one round and won', best.length, spec.wins)];
  return { complete: allDone(parts), parts, evidence: warEvidence(best) };
}

const defensiveWins = (s: Scope) =>
  s.world.history.wars.filter((w) => w.defenderId === s.userId && w.outcome === 'defender');

function ironWall(s: Scope, spec: SpecOf<'iron_wall'>): Check {
  const wins = defensiveWins(s);
  const parts = [part('Wars won as the defender', wins.length, spec.wins)];
  return { complete: allDone(parts), parts, evidence: warEvidence(wins) };
}

const checkmates = (s: Scope) => s.world.history.wars.filter((w) => isWin(w, s.userId) && w.endReason === 'checkmate');

function checkmateArtist(s: Scope, spec: SpecOf<'checkmate_artist'>): Check {
  const wins = checkmates(s);
  const parts = [part('Wars won by checkmate', wins.length, spec.wins)];
  return { complete: allDone(parts), parts, evidence: warEvidence(wins) };
}

interface Betrayal {
  partner: UserId;
  /** Where in the campaign's history the accord was broken, and in which round. */
  seq: number;
  round: number;
}

/** The accords the player broke. */
function betrayals(s: Scope): Betrayal[] {
  return s.world.history.accords.flatMap((a) => {
    if (a.brokenBy !== s.userId || a.to === null) return [];
    const partner = a.players[0] === s.userId ? a.players[1] : a.players[0];
    return [{ partner, seq: a.to, round: roundAt(s.world.history, a.to) }];
  });
}

function backstab(s: Scope, spec: SpecOf<'backstab'>): Check {
  const broken = betrayals(s);
  const need = spec.count ?? 1;
  // For each break, the wars declared on that partner after it and within the rounds allowed that
  // took countries from them (won, or paid as tribute). The best break counts.
  let best: { wars: MissionWar[]; taken: Set<TerritoryId> } = { wars: [], taken: new Set() };
  for (const b of broken) {
    const wars = battles(s).filter(
      (w) =>
        w.attackerId === s.userId &&
        w.defenderId === b.partner &&
        w.declaredSeq > b.seq &&
        w.declaredRound <= b.round + spec.rounds &&
        w.transfers.some((t) => t.from === b.partner && t.to === s.userId),
    );
    const taken = new Set(
      wars.flatMap((w) =>
        w.transfers.filter((t) => t.from === b.partner && t.to === s.userId).map((t) => t.territoryId),
      ),
    );
    if (taken.size > best.taken.size) best = { wars, taken };
  }
  const parts = [
    part('Accords broken', broken.length, 1),
    part('Countries taken from a betrayed partner in time', best.taken.size, need),
  ];
  return {
    complete: allDone(parts),
    parts,
    evidence: { territories: sorted(best.taken), wars: best.wars.map((w) => w.id) },
  };
}

function acrossTheSeas(s: Scope, spec: SpecOf<'across_the_seas'>): Check {
  const idx = s.world.idx;
  const taken = new Map<TerritoryId, string>();
  for (const w of s.world.history.wars) {
    if (w.attackerId !== s.userId || w.outcome !== 'attacker') continue;
    // Launched across a sea lane: judged on the country fought over in the end.
    if (!idx.byId.get(w.launchId)?.sea.includes(w.targetId)) continue;
    if (!s.held.has(w.targetId) || s.base.has(w.targetId)) continue;
    if (!taken.has(w.targetId)) taken.set(w.targetId, w.id);
  }
  const parts = [part('Countries taken across sea lanes and still held', taken.size, spec.count)];
  return {
    complete: allDone(parts),
    parts,
    evidence: { territories: sorted(taken.keys()), wars: [...taken.values()] },
  };
}

export interface ProtectedEpisode {
  partners: [UserId, UserId];
  /** Whole war rounds both accords were in force together. */
  rounds: number;
  /** Countries won from other players while both were in force, still held and not drafted. */
  held: TerritoryId[];
}

/** Stretches of history when the player had accords in force with two partners at once. */
export function protectedEpisodes(s: Pick<Scope, 'world' | 'userId' | 'held' | 'base'>): ProtectedEpisode[] {
  const { accords, roundStarts, wars } = s.world.history;
  const me = s.userId;
  // Each partner's accords, with renewals joined into one stretch.
  const spans = new Map<UserId, { from: number; to: number | null }[]>();
  for (const a of [...accords].sort((x, y) => x.from - y.from)) {
    if (!a.players.includes(me)) continue;
    const partner = a.players[0] === me ? a.players[1] : a.players[0];
    const list = spans.get(partner) ?? [];
    const last = list.at(-1);
    if (last && last.to !== null && a.from <= last.to) last.to = a.to === null ? null : Math.max(last.to, a.to);
    else list.push({ from: a.from, to: a.to });
    spans.set(partner, list);
  }
  const starts = [...roundStarts].sort((a, b) => a.round - b.round);
  const startOf = new Map(starts.map((r) => [r.round, r.seq]));
  const partners = [...spans.keys()].sort();
  const episodes: ProtectedEpisode[] = [];
  for (let i = 0; i < partners.length; i++) {
    for (let j = i + 1; j < partners.length; j++) {
      const [p, q] = [partners[i]!, partners[j]!];
      for (const x of spans.get(p)!) {
        for (const y of spans.get(q)!) {
          const from = Math.max(x.from, y.from);
          const to = x.to === null ? y.to : y.to === null ? x.to : Math.min(x.to, y.to);
          if (to !== null && to <= from) continue;
          // Whole rounds: begun after both were signed, and over (the next round has started) before either ended.
          let rounds = 0;
          for (const r of starts) {
            if (r.round < 1 || r.seq <= from) continue;
            const next = startOf.get(r.round + 1);
            if (next !== undefined && (to === null || to > next)) rounds++;
          }
          const won = new Set<TerritoryId>();
          for (const w of wars) {
            if (w.seq <= from || (to !== null && w.seq >= to)) continue;
            for (const t of w.transfers) if (t.to === me && t.from !== p && t.from !== q) won.add(t.territoryId);
          }
          const held = [...won].filter((id) => s.held.has(id) && !s.base.has(id)).sort();
          episodes.push({ partners: [p, q], rounds, held });
        }
      }
    }
  }
  return episodes;
}

function protectedExpansion(s: Scope, spec: SpecOf<'protected_expansion'>): Check {
  const episodes = protectedEpisodes(s);
  const score = (e: ProtectedEpisode) =>
    Math.min(e.rounds, spec.rounds) / spec.rounds + Math.min(e.held.length, spec.acquisitions) / spec.acquisitions;
  const best = episodes.reduce<ProtectedEpisode | null>((b, e) => (!b || score(e) > score(b) ? e : b), null);
  const complete = episodes.some((e) => e.rounds >= spec.rounds && e.held.length >= spec.acquisitions);
  const shown = complete ? episodes.find((e) => e.rounds >= spec.rounds && e.held.length >= spec.acquisitions)! : best;
  const parts = [
    part('Whole rounds with both accords in force', shown?.rounds ?? 0, spec.rounds),
    part('Countries won under them and still held', shown?.held.length ?? 0, spec.acquisitions),
  ];
  return { complete, parts, evidence: { territories: shown?.held ?? [] } };
}
