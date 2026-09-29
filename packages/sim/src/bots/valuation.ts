/**
 * What countries and wars are worth to a player's missions. Two layers:
 *
 * - A cheap progress model per mission (`MissionModel`): how far along it is, as the mean of its
 *   requirements met (0 to 1), and how that changes if countries are won or lost. Used to rank
 *   every candidate.
 * - Exact checks (`missionComplete` on a hypothetical world, with the war added to the history for
 *   the battle missions), for the few candidates worth working out in full.
 */
import {
  captureCosts,
  components,
  leadersAt,
  missionInfo,
  pathWithin,
  pointsAt,
  routeTo,
  statOfSet,
  type Continent,
  type GameEndReason,
  type MissionSpec,
  type MissionWar,
  type MissionWorld,
  type TerritoryId,
  type Transfer,
  type UserId,
} from '@empire/rules';
import type { MissionSlot, SimState } from '../engine/types';
import { hasScored, isComplete, slotsFor } from '../engine/victory';

/** What a war means to a battle mission. */
export interface BattleEvent {
  role: 'attacker' | 'defender';
  won: boolean;
  opponentId: UserId;
  /** The chance a win comes by checkmate. */
  mateChance: number;
  /** Launched across a sea lane at a country won since the draft. */
  viaSea: boolean;
  /** Countries taken from the opponent (a win or tribute). */
  takes: boolean;
}

export interface MissionModel {
  slot: MissionSlot;
  owner: UserId;
  complete: boolean;
  pending: boolean;
  /** Progress now, 0 to 1. */
  progress: number;
  /** Progress if these countries were won (and nothing lost). */
  withGain(ids: readonly TerritoryId[]): number;
  /** Progress if these countries were lost. */
  withLoss(ids: readonly TerritoryId[]): number;
  /** Progress a war would add to a battle mission (0 for the rest). */
  battle(e: BattleEvent): number;
  /** Countries on the way to open targets, worth a little. */
  stepping: ReadonlySet<TerritoryId>;
  /** Countries the mission leans on: losing one could break or set it back. */
  critical: ReadonlySet<TerritoryId>;
}

interface Scope {
  s: SimState;
  world: MissionWorld;
  owner: UserId;
  held: Set<TerritoryId>;
  base: ReadonlySet<TerritoryId>;
  /** Conquests to reach each country, worked out when first needed. */
  readonly costs: ReturnType<typeof captureCosts>;
}

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const frac = (have: number, need: number) => (need <= 0 ? 1 : clamp01(have / need));
const mean = (xs: readonly number[]) => (xs.length === 0 ? 1 : xs.reduce((a, b) => a + b, 0) / xs.length);
const value = (sc: Scope, id: TerritoryId) => sc.s.idx.byId.get(id)?.value ?? 0;
const continentOf = (sc: Scope, id: TerritoryId): Continent | undefined => sc.s.idx.byId.get(id)?.continent;

/** A holdings-based model: progress is `parts(held)` averaged. */
function holdingsModel(
  sc: Scope,
  slot: MissionSlot,
  parts: (held: ReadonlySet<TerritoryId>) => number[],
  opts: { targets?: readonly TerritoryId[]; critical?: Iterable<TerritoryId> } = {},
): Omit<MissionModel, 'complete' | 'pending'> {
  const progressOf = (held: ReadonlySet<TerritoryId>) => mean(parts(held));
  const stepping = new Set<TerritoryId>();
  if (opts.targets) {
    const open = opts.targets
      .filter((t) => !sc.held.has(t))
      .map((t) => [t, sc.costs.cost.get(t) ?? Infinity] as const)
      .filter(([, c]) => c < Infinity)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2);
    for (const [t] of open) for (const id of routeTo(sc.costs, t)) if (!sc.held.has(id) && id !== t) stepping.add(id);
  }
  const critical = new Set(opts.critical ?? (opts.targets ?? []).filter((t) => sc.held.has(t)));
  return {
    slot,
    owner: sc.owner,
    progress: progressOf(sc.held),
    withGain: (ids) => progressOf(new Set([...sc.held, ...ids])),
    withLoss: (ids) => {
      const held = new Set(sc.held);
      for (const id of ids) held.delete(id);
      return progressOf(held);
    },
    battle: () => 0,
    stepping,
    critical,
  };
}

function battleModel(
  sc: Scope,
  slot: MissionSlot,
  progress: number,
  step: (e: BattleEvent) => number,
): Omit<MissionModel, 'complete' | 'pending'> {
  return {
    slot,
    owner: sc.owner,
    progress,
    withGain: () => progress,
    withLoss: () => progress,
    battle: step,
    stepping: new Set(),
    critical: new Set(),
  };
}

const heldCount = (held: ReadonlySet<TerritoryId>, ids: readonly TerritoryId[]) =>
  ids.reduce((n, id) => n + (held.has(id) ? 1 : 0), 0);

function modelOf(sc: Scope, slot: MissionSlot): Omit<MissionModel, 'complete' | 'pending'> {
  const spec: MissionSpec = slot.spec;
  const { s, base } = sc;
  const idx = s.idx;
  const fresh = (held: ReadonlySet<TerritoryId>) => [...held].filter((id) => !base.has(id));
  const history = sc.world.history;
  const mine = history.wars.filter((w) => w.attackerId === sc.owner || w.defenderId === sc.owner);
  const winsOf = (role?: 'attacker' | 'defender') =>
    mine.filter(
      (w) =>
        (w.outcome === 'attacker' && w.attackerId === sc.owner && role !== 'defender') ||
        (w.outcome === 'defender' && w.defenderId === sc.owner && role !== 'attacker'),
    );

  // A position that needs a conquest (version 3): any of these held and won since the draft.
  const conquest = (needs: boolean | undefined, ids: readonly TerritoryId[]) => (held: ReadonlySet<TerritoryId>) =>
    needs ? [ids.some((id) => held.has(id) && !base.has(id)) ? 1 : 0] : [];

  switch (spec.kind) {
    case 'expansion':
    case 'measured_expansion': {
      const baseValue = [...base].reduce((n, id) => n + value(sc, id), 0);
      const newCount = spec.kind === 'measured_expansion' ? spec.newCount : 0;
      return holdingsModel(sc, slot, (held) => {
        const net = [...held].reduce((n, id) => n + value(sc, id), 0) - baseValue;
        const parts = [frac(net, spec.gain)];
        if (newCount > 0) parts.push(frac(fresh(held).length, newCount));
        return parts;
      });
    }
    case 'regional_power':
      return holdingsModel(
        sc,
        slot,
        (held) => {
          const inRegion = spec.territories.filter((id) => held.has(id));
          return [
            frac(
              inRegion.reduce((n, id) => n + value(sc, id), 0),
              spec.needValue,
            ),
            frac(inRegion.length, spec.minTerritories),
            ...conquest(spec.needsConquest, spec.territories)(held),
          ];
        },
        { targets: spec.territories },
      );
    case 'strategic_positions':
      return holdingsModel(
        sc,
        slot,
        (held) => [
          frac(heldCount(held, spec.territories), spec.need),
          ...conquest(spec.needsConquest, spec.territories)(held),
        ],
        { targets: spec.territories },
      );
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
      return holdingsModel(sc, slot, (held) => [frac(heldCount(held, spec.territories), spec.need)], {
        targets: spec.territories,
      });
    case 'seven_wonders':
    case 'island_empire': {
      const need = spec.kind === 'seven_wonders' ? spec.count : spec.need;
      return holdingsModel(
        sc,
        slot,
        (held) => {
          const have = spec.territories.filter((id) => held.has(id));
          return [frac(have.length, need), frac(have.filter((id) => !base.has(id)).length, spec.newCount)];
        },
        { targets: spec.territories.filter((id) => !base.has(id) || sc.held.has(id)) },
      );
    }
    case 'mare_nostrum':
      return holdingsModel(
        sc,
        slot,
        (held) => {
          const all = spec.shores.flatMap((shore) => shore.territories);
          return [
            frac(heldCount(held, all), spec.need),
            ...spec.shores.map((shore) => frac(heldCount(held, shore.territories), spec.perShore)),
            ...conquest(spec.needsConquest, all)(held),
          ];
        },
        { targets: spec.shores.flatMap((shore) => shore.territories) },
      );
    case 'buffer_zone':
      return holdingsModel(
        sc,
        slot,
        (held) => [frac(heldCount(held, [spec.center, ...spec.ring]), spec.ring.length + 1)],
        {
          targets: [spec.center, ...spec.ring],
        },
      );
    case 'encirclement':
      return holdingsModel(
        sc,
        slot,
        // Taking the centre would break it, so holding the centre counts against it.
        (held) => [frac(heldCount(held, spec.ring), spec.ring.length), held.has(spec.center) ? 0 : 1],
        { targets: spec.ring },
      );
    case 'strait_keeper':
      return holdingsModel(
        sc,
        slot,
        (held) =>
          spec.straits.map((st) => (st.shores.every((id) => held.has(id)) ? 1 : 0.4 * heldCount(held, [...st.shores]))),
        { targets: spec.straits.flatMap((st) => [...st.shores]) },
      );
    case 'great_connection':
    case 'silk_road':
    case 'cape_to_cairo':
    case 'pan_american_highway':
    case 'unification': {
      const [a, b] = spec.kind === 'unification' ? spec.marks : spec.endpoints;
      const chain = pathWithin(idx, sc.held, a, b);
      const route = chain ?? routeTo(captureCosts(idx, sc.held, { sources: [a] }), b);
      const onRoute = route.length > 0 ? route : [a, b];
      return holdingsModel(
        sc,
        slot,
        (held) => {
          const parts = [frac(heldCount(held, onRoute), onRoute.length)];
          if (spec.kind === 'unification')
            parts.push(frac(onRoute.filter((id) => held.has(id) && !base.has(id)).length, spec.newCount));
          if (spec.kind === 'great_connection') parts.push(...conquest(spec.needsConquest, onRoute)(held));
          return parts;
        },
        { targets: onRoute, critical: chain ?? onRoute.filter((id) => sc.held.has(id)) },
      );
    }
    case 'great_powers':
      return holdingsModel(sc, slot, (held) => {
        const big = [...held].filter((id) => value(sc, id) >= spec.minValue);
        return [frac(big.length, spec.count), frac(big.filter((id) => !base.has(id)).length, spec.newCount)];
      });
    case 'two_fronts':
    case 'two_theater_power': {
      const perContinent = spec.kind === 'two_fronts' ? spec.perContinent : spec.newCount;
      const continents = spec.kind === 'two_fronts' ? spec.continents : 2;
      const fixed = spec.kind === 'two_theater_power' ? spec.continents : null;
      const baseValueOn = (c: Continent) =>
        [...base].filter((id) => continentOf(sc, id) === c).reduce((n, id) => n + value(sc, id), 0);
      return holdingsModel(sc, slot, (held) => {
        const byContinent = new Map<Continent, TerritoryId[]>();
        for (const id of fresh(held)) {
          const c = continentOf(sc, id);
          if (c) byContinent.set(c, [...(byContinent.get(c) ?? []), id]);
        }
        if (fixed) {
          return fixed.flatMap((c) => {
            const net =
              [...held].filter((id) => continentOf(sc, id) === c).reduce((n, id) => n + value(sc, id), 0) -
              baseValueOn(c);
            return [
              frac(byContinent.get(c)?.length ?? 0, perContinent),
              frac(net, spec.kind === 'two_theater_power' ? spec.netValue : 1),
            ];
          });
        }
        const best = [...byContinent.values()].map((ids) => frac(ids.length, perContinent)).sort((x, y) => y - x);
        return Array.from({ length: continents }, (_, i) => best[i] ?? 0);
      });
    }
    case 'one_billion':
    case 'great_expanse':
    case 'half_of_humanity': {
      const key = spec.kind === 'great_expanse' ? 'areaKm2' : 'population';
      const need =
        spec.kind === 'one_billion'
          ? spec.people
          : spec.kind === 'great_expanse'
            ? spec.areaKm2
            : (statOfSet(idx, idx.ids, 'population') * spec.sharePct) / 100;
      return holdingsModel(sc, slot, (held) => [
        frac(statOfSet(idx, spec.kind === 'half_of_humanity' ? held : fresh(held), key), need),
      ]);
    }
    case 'continental_bridge':
    case 'consolidation': {
      // The largest block, and how many countries it has on each continent.
      return holdingsModel(sc, slot, (held) => {
        const blocks = components(idx, held);
        if (spec.kind === 'consolidation') {
          const total = [...held].reduce((n, id) => n + value(sc, id), 0);
          const top = blocks[0] ?? [];
          const topValue = top.reduce((n, id) => n + value(sc, id), 0);
          return [
            frac(total > 0 ? (topValue * 100) / total : 0, spec.sharePct),
            frac(top.filter((id) => !base.has(id)).length, spec.newCount),
          ];
        }
        let best: number[] = [];
        for (const block of blocks.slice(0, 3)) {
          const per = new Map<Continent, number>();
          for (const id of block) {
            const c = continentOf(sc, id);
            if (c) per.set(c, (per.get(c) ?? 0) + 1);
          }
          const scores = [...per.values()].map((n) => frac(n, spec.perContinent)).sort((x, y) => y - x);
          const top = [
            ...Array.from({ length: spec.continents }, (_, i) => scores[i] ?? 0),
            ...conquest(spec.needsConquest, block)(held),
          ];
          if (mean(top) > mean(best)) best = top;
        }
        return best.length > 0 ? best : [0];
      });
    }
    case 'across_the_seas': {
      const taken = new Set(
        winsOf('attacker')
          .filter(
            (w) =>
              idx.byId.get(w.launchId)?.sea.includes(w.targetId) && sc.held.has(w.targetId) && !base.has(w.targetId),
          )
          .map((w) => w.targetId),
      );
      return {
        ...battleModel(sc, slot, frac(taken.size, spec.count), (e) =>
          e.role === 'attacker' && e.won && e.viaSea ? 1 / spec.count : 0,
        ),
        critical: taken,
      };
    }
    case 'nemesis': {
      const taken = new Set<TerritoryId>();
      for (const w of history.wars)
        for (const t of w.transfers) if (t.from === spec.rival && t.to === sc.owner) taken.add(t.territoryId);
      const held = [...taken].filter((id) => sc.held.has(id));
      return {
        ...battleModel(sc, slot, frac(held.length, spec.count), (e) =>
          e.opponentId === spec.rival && e.takes && e.role === 'attacker' ? 1 / spec.count : 0,
        ),
        critical: new Set(held),
      };
    }
    case 'campaign_veteran': {
      // Version 3 counts only wars won as the attacker, opponents included.
      const wins = spec.attackOnly ? winsOf('attacker') : winsOf();
      const opponents = new Set(wins.map((w) => (w.attackerId === sc.owner ? w.defenderId : w.attackerId)));
      const needOpp = Math.min(spec.opponents, Math.max(1, sc.world.players.length - 1));
      const attacking = winsOf('attacker').length;
      const score = (won: number, opp: number, att: number) =>
        mean([frac(won, spec.wins), frac(opp, needOpp), ...(spec.attackOnly ? [] : [frac(att, spec.attackWins)])]);
      const now = score(wins.length, opponents.size, attacking);
      return battleModel(sc, slot, now, (e) => {
        if (!e.won || (spec.attackOnly && e.role !== 'attacker')) return 0;
        const opp = opponents.has(e.opponentId) ? opponents.size : opponents.size + 1;
        const att = attacking + (e.role === 'attacker' ? 1 : 0);
        return score(wins.length + 1, opp, att) - now;
      });
    }
    case 'kingslayer': {
      if (spec.lead !== undefined) {
        // Version 3: the leader on points, at least `lead` ahead.
        const points = pointsAt(sc.world, sc.s.seq + 1);
        const top = Math.max(0, ...points.values());
        const behind = top >= (points.get(sc.owner) ?? 0) + spec.lead;
        return battleModel(sc, slot, 0, (e) =>
          e.role === 'attacker' && e.won && behind && (points.get(e.opponentId) ?? 0) === top ? 1 : 0,
        );
      }
      const leaders = leadersAt(sc.world, sc.s.seq + 1);
      const trailing = !leaders.includes(sc.owner);
      return battleModel(sc, slot, 0, (e) =>
        e.role === 'attacker' && e.won && trailing && leaders.includes(e.opponentId) ? 1 : 0,
      );
    }
    case 'lightning_campaign': {
      const round = sc.s.round;
      const thisRound = sc.s.wars.filter((w) => w.attackerId === sc.owner && w.declaredRound === round);
      const won = thisRound.filter((w) => w.outcome === 'attacker').length;
      const open = thisRound.filter((w) => w.status !== 'resolved').length;
      return battleModel(sc, slot, frac(won, spec.wins) * 0.5, (e) => {
        if (e.role !== 'attacker' || !e.won) return 0;
        if (won + 1 >= spec.wins) return 1;
        return open > 0 ? 0.5 : 0.2;
      });
    }
    case 'iron_wall': {
      const have = winsOf('defender').length;
      return battleModel(sc, slot, frac(have, spec.wins), (e) => (e.role === 'defender' && e.won ? 1 / spec.wins : 0));
    }
    case 'checkmate_artist': {
      const have = mine.filter(
        (w) =>
          w.endReason === 'checkmate' &&
          ((w.outcome === 'attacker' && w.attackerId === sc.owner) ||
            (w.outcome === 'defender' && w.defenderId === sc.owner)),
      ).length;
      return battleModel(sc, slot, frac(have, spec.wins), (e) => (e.won ? e.mateChance / spec.wins : 0));
    }
    case 'backstab': {
      const broken = history.accords.filter((a) => a.brokenBy === sc.owner && a.to !== null);
      const partners = new Set(broken.map((a) => (a.players[0] === sc.owner ? a.players[1] : a.players[0])));
      // Countries already taken from a betrayed partner since the break (the rules check the timing).
      const count = spec.count ?? 1;
      const taken = new Set(
        history.wars.flatMap((w) =>
          w.attackerId === sc.owner && partners.has(w.defenderId)
            ? w.transfers.filter((t) => t.to === sc.owner && t.from === w.defenderId).map((t) => t.territoryId)
            : [],
        ),
      );
      const now = broken.length === 0 ? 0 : 0.5 + (0.5 * Math.min(taken.size, count - 1)) / count;
      return battleModel(sc, slot, now, (e) =>
        e.role === 'attacker' && e.takes && partners.has(e.opponentId) ? (taken.size + 1 >= count ? 1 : 1 / count) : 0,
      );
    }
    case 'protected_expansion': {
      const partners = sc.s.accords
        .filter((a) => a.status === 'active' && (a.proposerId === sc.owner || a.recipientId === sc.owner))
        .map((a) => (a.proposerId === sc.owner ? a.recipientId : a.proposerId));
      const guarded = partners.length >= spec.partners;
      return battleModel(sc, slot, guarded ? 0.3 : 0, (e) =>
        guarded && e.role === 'attacker' && e.takes && !partners.includes(e.opponentId) ? 1 / spec.acquisitions : 0,
      );
    }
  }
}

/** Models for the missions a player still has to score (all of them, for the owner). */
export function missionModels(
  s: SimState,
  world: MissionWorld,
  owner: UserId,
  slots: readonly MissionSlot[],
): MissionModel[] {
  const held = new Set<TerritoryId>();
  for (const [id, o] of world.owners) if (o === owner) held.add(id);
  let costs: ReturnType<typeof captureCosts> | null = null;
  const sc: Scope = {
    s,
    world,
    owner,
    held,
    base: s.byId.get(owner)!.baseline,
    get costs() {
      return (costs ??= captureCosts(s.idx, held));
    },
  };
  return slots.map((slot) => {
    const m = modelOf(sc, slot);
    const complete = isComplete(s, world, owner, slot.spec);
    const pending = s.claims.has(`${owner}\n${slot.key}`);
    return { ...m, complete, pending, progress: complete ? 1 : m.progress };
  });
}

/** A player's missions not yet scored. */
export const openSlots = (s: SimState, userId: UserId): MissionSlot[] =>
  slotsFor(s, s.byId.get(userId)!).filter((slot) => !hasScored(s, userId, slot.key));

/**
 * What a rival shows the table: public missions not yet scored, and their secret once revealed.
 * Unrevealed secrets are never seen.
 */
export function visibleSlots(s: SimState, rivalId: UserId): MissionSlot[] {
  const rival = s.byId.get(rivalId)!;
  return openSlots(s, rivalId).filter((slot) => slot.scope === 'public' || rival.revealedRound !== null);
}

/** The world after a war (or tribute) that moves `transfers`, with the war in the history. */
export function worldAfter(
  s: SimState,
  world: MissionWorld,
  transfers: readonly Transfer[],
  war?: Omit<MissionWar, 'seq' | 'declaredSeq' | 'declaredRound' | 'round' | 'id'> & { declaredSeq?: number },
): MissionWorld {
  const owners = new Map(world.owners);
  for (const t of transfers) owners.set(t.territoryId, t.to);
  if (!war) return { ...world, owners };
  const hypothetical: MissionWar = {
    id: 'hypothetical',
    declaredRound: s.round,
    round: s.round,
    declaredSeq: war.declaredSeq ?? s.seq + 1,
    seq: s.seq + 2,
    ...war,
  };
  return { ...world, owners, history: { ...world.history, wars: [...world.history.wars, hypothetical] } };
}

/** Whether the mission's timing makes breaking it matter (claims) or only its completion (records). */
export const isClaim = (spec: MissionSpec) => missionInfo(spec.kind).timing === 'claim';

export type { GameEndReason };
