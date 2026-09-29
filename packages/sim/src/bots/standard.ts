/**
 * Bots that chase their missions. Every decision is a one-step expected value in country-value
 * units, a victory point being worth `vpValue`:
 *
 * - declaring: the chance of winning times what the target is worth (value, mission progress,
 *   missions it completes, rivals' claims it breaks), less the chance of losing times what the
 *   stake is worth (value, progress, claims of ours it breaks, rivals' missions it hands them),
 *   allowing for a raise;
 * - answering: the best of accepting, raising, redirecting and tribute, given how the attacker
 *   would reply;
 * - accords with neighbours not worth attacking, broken when a partner's country is worth much more
 *   than any other target (or when the secret mission is Backstab).
 */
import {
  attackableTargets,
  bordersAny,
  canRaise,
  clockModifiers,
  hopDistances,
  leadersAt,
  raiseFloor,
  redirectOptions,
  shuffled,
  stakeFloor,
  tributeOptions,
  valueOf,
  type MissionWorld,
  type PublicMissionSpec,
  type TerritoryId,
  type Transfer,
  type UserId,
  type WarBoard,
} from '@empire/rules';
import { warBoard } from '../engine/board';
import { oddsWithModifier, type WarOdds } from '../engine/chess';
import { accordInForce, answer, propose, renounce } from '../engine/diplomacy';
import type { DraftPicker } from '../engine/lifecycle';
import { heldBy, pointsToWin } from '../engine/state';
import type { SimPlayer, SimState, SimWar } from '../engine/types';
import { hasScored, isComplete } from '../engine/victory';
import type { Declaration, Reply, Response } from '../engine/wars';
import { missionWorld } from '../engine/world';
import { gumbel } from '../random';
import { boardKeeping, lightningOpen, secretChooser, stakeFor } from './common';
import type { Bots } from './index';
import type { BotKnobs } from './knobs';
import { missionModels, openSlots, visibleSlots, worldAfter, type BattleEvent, type MissionModel } from './valuation';

/** What a war token is worth when it isn't at the cap, in country value. */
const TOKEN_VALUE = 1;
/** What a withdrawn war is worth to the defender: the attacker wasted a token. */
const WITHDRAWAL_VALUE = 0.3;
/** What declaring a war the attacker will withdraw from is worth to them: nothing, and a token gone. */
const WASTED = -1;

// ---------------------------------------------------------------------------------------------
// The draft

const draftBonuses = new WeakMap<SimState, Map<TerritoryId, number>>();

/** Bonuses for drafting public mission targets, worked out once per campaign. */
function draftBonus(s: SimState): Map<TerritoryId, number> {
  let bonus = draftBonuses.get(s);
  if (bonus) return bonus;
  bonus = new Map();
  const add = (id: TerritoryId, x: number) => bonus!.set(id, (bonus!.get(id) ?? 0) + x);
  const giants = (ids: readonly TerritoryId[]) => ids.forEach((id) => add(id, -1));
  for (const spec of s.publicSpecs as PublicMissionSpec[]) {
    switch (spec.kind) {
      case 'strategic_positions':
        spec.territories.forEach((id) => add(id, 3));
        break;
      case 'great_connection': {
        const [a, b] = spec.endpoints;
        const da = hopDistances(s.idx, a);
        const db = hopDistances(s.idx, b);
        const d = da.get(b) ?? Infinity;
        for (const id of s.idx.ids) if ((da.get(id) ?? Infinity) + (db.get(id) ?? Infinity) === d) add(id, 1.5);
        add(a, 1.5);
        add(b, 1.5);
        break;
      }
      case 'regional_power':
        spec.territories.forEach((id) => add(id, 1));
        break;
      case 'mare_nostrum':
        spec.shores.flatMap((shore) => shore.territories).forEach((id) => add(id, 0.8));
        break;
      case 'seven_wonders':
        spec.territories.forEach((id) => add(id, 1));
        break;
      case 'continental_bridge':
        for (const id of s.idx.ids) {
          const c = s.idx.byId.get(id)!.continent;
          if (s.idx.neighbors(id).some((n) => s.idx.byId.get(n)!.continent !== c)) add(id, 1);
        }
        break;
      case 'one_billion':
        giants(['CHN', 'IND']);
        break;
      case 'great_expanse':
        giants(['AUS', 'BRA', 'CAN', 'CHN', 'RUS', 'USA']);
        break;
      default:
        break;
    }
  }
  draftBonuses.set(s, bonus);
  return bonus;
}

function draftPicker(knobs: BotKnobs): DraftPicker {
  return (s, userId, legal) => {
    const bonus = knobs.draft === 'missions' ? draftBonus(s) : null;
    const mine = heldBy(s, userId);
    let best: { id: TerritoryId; score: number } | null = null;
    for (const id of legal) {
      const t = s.idx.byId.get(id)!;
      let score = t.value + (bonus ? knobs.draftMissionWeight * (knobs.vpValue / 4) * (bonus.get(id) ?? 0) : 0);
      // In a free draft players still like an empire that hangs together.
      if (s.rules.draft.mode === 'free' && mine.size > 0 && bordersAny(s.idx, id, mine)) score += 0.5;
      score += knobs.draftNoise * gumbel(s.rng.draft);
      if (!best || score > best.score) best = { id, score };
    }
    return best!.id;
  };
}

// ---------------------------------------------------------------------------------------------
// Valuing wars

interface Ctx {
  s: SimState;
  knobs: BotKnobs;
  world: MissionWorld;
  board: WarBoard;
  me: UserId;
  mine: MissionModel[];
  rivals: Map<UserId, MissionModel[]>;
}

function context(s: SimState, knobs: BotKnobs, me: UserId, board = warBoard(s)): Ctx {
  const world = missionWorld(s);
  return { s, knobs, world, board, me, mine: missionModels(s, world, me, openSlots(s, me)), rivals: new Map() };
}

/** A rival's missions as the table sees them (public ones, and a revealed secret). */
function rivalModels(ctx: Ctx, rivalId: UserId): MissionModel[] {
  let models = ctx.rivals.get(rivalId);
  if (!models) {
    models = missionModels(ctx.s, ctx.world, rivalId, visibleSlots(ctx.s, rivalId));
    ctx.rivals.set(rivalId, models);
  }
  return models;
}

const worth = (ctx: Ctx, m: MissionModel) => m.slot.points * ctx.knobs.vpValue;

/** What stopping (or allowing) a rival's mission is worth, more when it would win them the campaign. */
function rivalStake(ctx: Ctx, rivalId: UserId, m: MissionModel): number {
  const points = ctx.s.points.get(rivalId) ?? 0;
  const deciding = points + m.slot.points >= pointsToWin(ctx.s);
  return ctx.knobs.blockWeight * worth(ctx, m) * 0.5 * (deciding ? 2.5 : 1);
}

function leaderBonus(ctx: Ctx, rivalId: UserId): number {
  const points = ctx.s.points.get(rivalId) ?? 0;
  if (points < 3) return 0;
  const others = [...ctx.s.points].filter(([id]) => id !== rivalId).map(([, p]) => p);
  if (others.some((p) => p >= points)) return 0;
  return ctx.knobs.leaderWeight * (points / pointsToWin(ctx.s)) * 2;
}

function mateChance(ctx: Ctx, userId: UserId): number {
  const p = ctx.s.byId.get(userId)!;
  const denied = p.secret?.kind === 'checkmate_artist' && p.revealedRound !== null;
  return ctx.s.cfg.chess.mateShare * (denied ? 1 - ctx.s.cfg.chess.mateDenial : 1);
}

function odds(ctx: Ctx, attackerId: UserId, defenderId: UserId, targetId: TerritoryId): WarOdds {
  return oddsWithModifier(ctx.s, attackerId, defenderId, clockModifiers(ctx.board, attackerId, targetId).net);
}

/** Progress (in value) a set of models gains from winning countries and a war. */
function progressGain(ctx: Ctx, models: readonly MissionModel[], won: readonly TerritoryId[], e: BattleEvent | null) {
  let sum = 0;
  for (const m of models) {
    if (m.complete) continue;
    const delta = (won.length > 0 ? m.withGain(won) - m.progress : 0) + (e ? m.battle(e) : 0);
    const stepping = won.some((id) => m.stepping.has(id)) ? 0.1 : 0;
    sum += worth(ctx, m) * ctx.knobs.progressWeight * (Math.max(0, delta) + stepping);
  }
  return sum;
}

function progressLoss(ctx: Ctx, models: readonly MissionModel[], lost: readonly TerritoryId[]) {
  let sum = 0;
  for (const m of models) {
    if (lost.length === 0) continue;
    sum += worth(ctx, m) * ctx.knobs.progressWeight * Math.max(0, m.progress - m.withLoss(lost));
  }
  return sum;
}

/** Missions the outcome completes (+) or breaks (−), checked exactly, in value. */
function exactSwing(ctx: Ctx, owner: UserId, models: readonly MissionModel[], after: MissionWorld): number {
  let sum = 0;
  for (const m of models) {
    const done = isComplete(ctx.s, after, owner, m.slot.spec);
    if (!m.complete && done) sum += worth(ctx, m) * (1 - ctx.knobs.progressWeight);
    else if (m.complete && !done) sum -= worth(ctx, m) * (m.pending ? 1 : 0.8);
  }
  return sum;
}

/** What rivals' visible missions make of an outcome, from our side: + for breaking, − for handing over. */
function rivalSwing(ctx: Ctx, rivalId: UserId, after: MissionWorld): number {
  let sum = 0;
  for (const m of rivalModels(ctx, rivalId)) {
    const done = isComplete(ctx.s, after, rivalId, m.slot.spec);
    if (m.complete && !done) sum += rivalStake(ctx, rivalId, m);
    else if (!m.complete && done) sum -= rivalStake(ctx, rivalId, m);
  }
  return sum;
}

interface WarPlan {
  targetId: TerritoryId;
  defenderId: UserId;
  launchId: TerritoryId;
  stake: TerritoryId[];
}

/**
 * Whether the defender can see that this war matters: taking the target would complete one of the
 * attacker's visible missions (public, or a revealed secret) or break one of the defender's
 * complete visible ones. A defender facing that looks at every answer, and raises if they can.
 */
function contested(ctx: Ctx, plan: WarPlan): boolean {
  const { s, me } = ctx;
  const take: Transfer[] = [{ territoryId: plan.targetId, from: plan.defenderId, to: me }];
  const after = worldAfter(s, ctx.world, take, {
    attackerId: me,
    defenderId: plan.defenderId,
    launchId: plan.launchId,
    targetId: plan.targetId,
    outcome: 'attacker',
    transfers: take,
    endReason: 'resignation',
  });
  const revealed = s.byId.get(me)!.revealedRound !== null;
  const mineShown = ctx.mine.filter((m) => m.slot.scope === 'public' || revealed);
  if (mineShown.some((m) => !m.complete && isComplete(s, after, me, m.slot.spec))) return true;
  return rivalModels(ctx, plan.defenderId).some(
    (m) => m.complete && !isComplete(s, after, plan.defenderId, m.slot.spec),
  );
}

/** Whether the attacker withdrew from this target after a raise in the last two rounds. */
function recentlyWithdrawn(ctx: Ctx, targetId: TerritoryId): number | null {
  const war = ctx.s.wars.find(
    (w) =>
      w.attackerId === ctx.me &&
      w.redirectedFrom === null &&
      w.targetId === targetId &&
      w.outcome === 'withdrawn' &&
      w.counter?.kind === 'raise' &&
      (w.resolvedRound ?? -Infinity) >= ctx.s.round - 2,
  );
  return war?.counter?.kind === 'raise' ? war.counter.minValue : null;
}

/**
 * The attacker's expected value of a war as declared (from `ctx.me`'s side), with its models; the
 * defender's visible missions count as blocking or gifts.
 */
function attackValue(ctx: Ctx, plan: WarPlan, models: readonly MissionModel[] = ctx.mine): number {
  const { s } = ctx;
  const { targetId, defenderId, launchId, stake } = plan;
  const me = ctx.me;
  const o = odds(ctx, me, defenderId, targetId);
  const base = s.byId.get(me)!.baseline;
  const viaSea = (s.idx.byId.get(launchId)?.sea.includes(targetId) ?? false) && !base.has(targetId);
  const take: Transfer[] = [{ territoryId: targetId, from: defenderId, to: me }];
  const lose: Transfer[] = stake.map((id) => ({ territoryId: id, from: me, to: defenderId }));
  const winEvent: BattleEvent = {
    role: 'attacker',
    won: true,
    opponentId: defenderId,
    mateChance: mateChance(ctx, me),
    viaSea,
    takes: true,
  };
  const war = { attackerId: me, defenderId, launchId, targetId };
  const winWorld = worldAfter(s, ctx.world, take, {
    ...war,
    outcome: 'attacker',
    transfers: take,
    endReason: 'resignation',
  });
  const lossWorld = worldAfter(s, ctx.world, lose, {
    ...war,
    outcome: 'defender',
    transfers: lose,
    endReason: 'resignation',
  });
  const winMate = worldAfter(s, ctx.world, take, {
    ...war,
    outcome: 'attacker',
    transfers: take,
    endReason: 'checkmate',
  });

  let win = s.idx.byId.get(targetId)!.value + progressGain(ctx, models, [targetId], winEvent);
  win += exactSwing(ctx, me, models, winWorld);
  const artist = models.find((m) => m.slot.spec.kind === 'checkmate_artist' && !m.complete);
  if (artist && isComplete(s, winMate, me, artist.slot.spec)) {
    win += winEvent.mateChance * worth(ctx, artist) * (1 - ctx.knobs.progressWeight);
  }
  win += rivalSwing(ctx, defenderId, winWorld);

  let loss = valueOf(s.idx, stake) + progressLoss(ctx, models, stake);
  loss -= exactSwing(ctx, me, models, lossWorld);
  loss -= rivalSwing(ctx, defenderId, lossWorld);

  return o.attacker * win - o.defender * loss + leaderBonus(ctx, defenderId);
}

/** Countries a player should keep out of stakes: what complete or promising missions lean on. */
function keepSet(models: readonly MissionModel[]): Set<TerritoryId> {
  const keep = new Set<TerritoryId>();
  for (const m of models) if (m.complete || m.pending || m.progress >= 0.5) for (const id of m.critical) keep.add(id);
  return keep;
}

interface Candidate extends WarPlan {
  u: number;
}

/** The best way to attack a target: stake choice, and allowing for a raise. */
function bestPlanFor(ctx: Ctx, targetId: TerritoryId, keep: ReadonlySet<TerritoryId>): Candidate | null {
  const { s, board, me } = ctx;
  const defenderId = s.holdings.get(targetId)!.ownerId;
  const kept = boardKeeping(board, keep);
  const plans = [] as { launchId: TerritoryId; stake: TerritoryId[]; value: number }[];
  const across = ctx.mine.some((m) => m.slot.spec.kind === 'across_the_seas' && !m.complete);
  if (across) {
    for (const launchId of s.idx.neighbors(targetId)) {
      if (s.holdings.get(launchId)?.ownerId !== me || !s.idx.byId.get(launchId)!.sea.includes(targetId)) continue;
      const plan = stakeFor(kept, me, targetId, { launchId }) ?? stakeFor(board, me, targetId, { launchId });
      if (plan) plans.push(plan);
    }
  }
  const plain = stakeFor(kept, me, targetId) ?? stakeFor(board, me, targetId);
  if (plain) plans.push(plain);
  let best: Candidate | null = null;
  const floor = raiseFloor(s.rules, s.idx.byId.get(targetId)!.value);
  // Having just been raised off this target, only come back with a stake that meets the raise.
  const raisedBefore = recentlyWithdrawn(ctx, targetId);
  for (const plan of plans) {
    const asDeclared = attackValue(ctx, { targetId, defenderId, launchId: plan.launchId, stake: plan.stake });
    let u = asDeclared;
    let stake = plan.stake;
    if (plan.value < floor) {
      const raised =
        stakeFor(kept, me, targetId, { launchId: plan.launchId, minValue: floor }) ??
        stakeFor(board, me, targetId, { launchId: plan.launchId, minValue: floor });
      const raisedValue = raised
        ? attackValue(ctx, { targetId, defenderId, launchId: plan.launchId, stake: raised.stake })
        : -Infinity;
      // A defender with a mission at stake raises whenever they can; others now and then.
      const raiseChance =
        raisedBefore !== null || contested(ctx, { targetId, defenderId, launchId: plan.launchId, stake: plan.stake })
          ? 1
          : ctx.knobs.raiseRate;
      // After a raise: fight on the bigger stake if it's worth it, else withdraw, a wasted declaration.
      const afterRaise = raisedValue > 0 ? raisedValue : WASTED;
      u = (1 - raiseChance) * asDeclared + raiseChance * afterRaise;
      // Staking the raise up front takes the option away from the defender.
      if (raised && raisedValue > u) {
        u = raisedValue;
        stake = raised.stake;
      }
    }
    if (!best || u > best.u) best = { targetId, defenderId, launchId: plan.launchId, stake, u };
  }
  return best;
}

/** A quick score for ranking targets before working any out in full. */
function preScore(ctx: Ctx, targetId: TerritoryId): number {
  const { s } = ctx;
  const t = s.idx.byId.get(targetId)!;
  const defenderId = s.holdings.get(targetId)!.ownerId;
  const o = odds(ctx, ctx.me, defenderId, targetId);
  const e: BattleEvent = {
    role: 'attacker',
    won: true,
    opponentId: defenderId,
    mateChance: mateChance(ctx, ctx.me),
    viaSea: false,
    takes: true,
  };
  let block = 0;
  for (const m of rivalModels(ctx, defenderId))
    if (m.complete && m.critical.has(targetId)) block += rivalStake(ctx, defenderId, m);
  return (
    o.attacker * (t.value + progressGain(ctx, ctx.mine, [targetId], e) + block) -
    o.defender * stakeFloor(s.rules, t.value) +
    leaderBonus(ctx, defenderId)
  );
}

/** The best wars a player could declare, worked out in full for the top few targets. */
function bestWars(ctx: Ctx, targets: Iterable<TerritoryId>): Candidate[] {
  const ranked = [...targets].map((id) => ({ id, pre: preScore(ctx, id) })).sort((a, b) => b.pre - a.pre);
  const keep = keepSet(ctx.mine);
  const out: Candidate[] = [];
  for (const { id } of ranked.slice(0, ctx.knobs.topK)) {
    const c = bestPlanFor(ctx, id, keep);
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.u - a.u);
}

// ---------------------------------------------------------------------------------------------
// Declaring

function declareFor(s: SimState, player: SimPlayer, knobs: BotKnobs): Declaration | null {
  const board = warBoard(s);
  const targets = attackableTargets(board, player.id);
  if (targets.size === 0) return null;
  const ctx = context(s, knobs, player.id, board);
  const [best] = bestWars(ctx, targets);
  if (!best) return null;
  const atCap = player.tokens >= s.rules.war.tokenCap;
  let threshold = atCap ? knobs.declareThresholdAtCap : knobs.declareThreshold;
  // Keep two tokens for Lightning Campaign, unless this war is worth it anyway.
  if (knobs.saveForLightning && player.tokens < 2 && lightningOpen(s, player.id) && !atCap) threshold += TOKEN_VALUE;
  if (best.u <= threshold) return null;
  return { targetId: best.targetId, launchId: best.launchId, stake: best.stake };
}

// ---------------------------------------------------------------------------------------------
// Answering

/** The defender's expected value of fighting for `targetId` against this stake. */
function defendValue(ctx: Ctx, war: SimWar, targetId: TerritoryId, stake: readonly TerritoryId[]): number {
  const { s } = ctx;
  const me = ctx.me;
  const o = odds(ctx, war.attackerId, me, targetId);
  const won: Transfer[] = stake.map((id) => ({ territoryId: id, from: war.attackerId, to: me }));
  const lost: Transfer[] = [{ territoryId: targetId, from: me, to: war.attackerId }];
  const base = { attackerId: war.attackerId, defenderId: me, launchId: war.launchId, targetId };
  const winWorld = worldAfter(s, ctx.world, won, {
    ...base,
    outcome: 'defender',
    transfers: won,
    endReason: 'resignation',
  });
  const lossWorld = worldAfter(s, ctx.world, lost, {
    ...base,
    outcome: 'attacker',
    transfers: lost,
    endReason: 'resignation',
  });
  const e: BattleEvent = {
    role: 'defender',
    won: true,
    opponentId: war.attackerId,
    mateChance: mateChance(ctx, me),
    viaSea: false,
    takes: true,
  };
  let win = valueOf(s.idx, stake) + progressGain(ctx, ctx.mine, stake, e) + exactSwing(ctx, me, ctx.mine, winWorld);
  win += rivalSwing(ctx, war.attackerId, winWorld);
  let loss = s.idx.byId.get(targetId)!.value + progressLoss(ctx, ctx.mine, [targetId]);
  loss -= exactSwing(ctx, me, ctx.mine, lossWorld);
  loss -= rivalSwing(ctx, war.attackerId, lossWorld);
  return o.defender * win - o.attacker * loss;
}

/** What paying a country as tribute costs the defender. */
function tributeCost(ctx: Ctx, war: SimWar, id: TerritoryId): number {
  const { s } = ctx;
  const lost: Transfer[] = [{ territoryId: id, from: ctx.me, to: war.attackerId }];
  const after = worldAfter(s, ctx.world, lost, {
    attackerId: war.attackerId,
    defenderId: ctx.me,
    launchId: war.launchId,
    targetId: war.targetId,
    outcome: 'tribute',
    transfers: lost,
    endReason: null,
  });
  return (
    s.idx.byId.get(id)!.value +
    progressLoss(ctx, ctx.mine, [id]) -
    exactSwing(ctx, ctx.me, ctx.mine, after) -
    rivalSwing(ctx, war.attackerId, after)
  );
}

/** How the attacker values fighting on (their view: their own missions). */
function attackerValue(
  s: SimState,
  knobs: BotKnobs,
  war: SimWar,
  targetId: TerritoryId,
  stake: readonly TerritoryId[],
) {
  const ctx = context(s, knobs, war.attackerId);
  return attackValue(ctx, { targetId, defenderId: war.defenderId, launchId: war.launchId, stake: [...stake] });
}

/** How the attacker values a tribute country. */
function attackerTributeValue(s: SimState, knobs: BotKnobs, war: SimWar, id: TerritoryId): number {
  const ctx = context(s, knobs, war.attackerId);
  const take: Transfer[] = [{ territoryId: id, from: war.defenderId, to: war.attackerId }];
  const after = worldAfter(s, ctx.world, take, {
    attackerId: war.attackerId,
    defenderId: war.defenderId,
    launchId: war.launchId,
    targetId: war.targetId,
    outcome: 'tribute',
    transfers: take,
    endReason: null,
  });
  const e: BattleEvent = {
    role: 'attacker',
    won: false,
    opponentId: war.defenderId,
    mateChance: 0,
    viaSea: false,
    takes: true,
  };
  return (
    s.idx.byId.get(id)!.value +
    progressGain(ctx, ctx.mine, [id], e) +
    exactSwing(ctx, war.attackerId, ctx.mine, after) +
    rivalSwing(ctx, war.defenderId, after)
  );
}

/**
 * Whether losing the target breaks one of the defender's complete missions, or hands the attacker a
 * visible one.
 */
function missionAtStake(ctx: Ctx, war: SimWar): boolean {
  const lost: Transfer[] = [{ territoryId: war.targetId, from: ctx.me, to: war.attackerId }];
  const after = worldAfter(ctx.s, ctx.world, lost, {
    attackerId: war.attackerId,
    defenderId: ctx.me,
    launchId: war.launchId,
    targetId: war.targetId,
    outcome: 'attacker',
    transfers: lost,
    endReason: 'resignation',
  });
  return exactSwing(ctx, ctx.me, ctx.mine, after) < 0 || rivalSwing(ctx, war.attackerId, after) < 0;
}

function respondFor(s: SimState, war: SimWar, knobs: BotKnobs): Response {
  const board = warBoard(s);
  const ctx = context(s, knobs, war.defenderId, board);
  const active = board.wars.find((w) => w.id === war.id)!;
  const accept = defendValue(ctx, war, war.targetId, war.stake);
  let best: { r: Response; u: number } = { r: { kind: 'accept' }, u: accept };
  // When a mission hangs on the war (ours or the attacker's), the defender looks at every answer.
  const matters = missionAtStake(ctx, war);
  const consider = (r: Response, u: number) => {
    if (u > best.u + 0.05) best = { r, u };
  };

  if (canRaise(board, active) && (matters || s.rng.bots() < knobs.raiseRate)) {
    const floor = raiseFloor(s.rules, s.idx.byId.get(war.targetId)!.value);
    const raised = stakeFor(board, war.attackerId, war.targetId, {
      launchId: war.launchId,
      minValue: floor,
      exceptWarId: war.id,
    });
    const goesAhead = raised && attackerValue(s, knobs, war, war.targetId, raised.stake) > 0;
    consider({ kind: 'raise' }, goesAhead ? defendValue(ctx, war, war.targetId, raised.stake) : WITHDRAWAL_VALUE);
  }

  if (matters || s.rng.bots() < knobs.counterRate) {
    const fightOn = attackerValue(s, knobs, war, war.targetId, war.stake);
    for (const id of redirectOptions(board, active)) {
      const goesAhead = attackerValue(s, knobs, war, id, war.stake) > 0;
      consider({ kind: 'redirect', targetId: id }, goesAhead ? defendValue(ctx, war, id, war.stake) : WITHDRAWAL_VALUE);
    }
    const cheapest = tributeOptions(board, active)
      .map((id) => ({ id, cost: tributeCost(ctx, war, id) }))
      .sort((a, b) => a.cost - b.cost)
      .slice(0, 3);
    for (const { id, cost } of cheapest) {
      const taken = attackerTributeValue(s, knobs, war, id) >= fightOn;
      consider({ kind: 'tribute', territoryId: id }, taken ? -cost : accept);
    }
    const tokens = s.byId.get(ctx.me)!.tokens;
    for (let k = 1; k <= tokens; k++) {
      const taken = k * TOKEN_VALUE >= fightOn;
      consider({ kind: 'tribute', tokens: k }, taken ? -k * TOKEN_VALUE : accept);
      if (taken) break;
    }
  }
  return best.r;
}

function replyFor(s: SimState, war: SimWar, knobs: BotKnobs): Reply {
  const counter = war.counter!;
  const ctx = context(s, knobs, war.attackerId);
  switch (counter.kind) {
    case 'raise': {
      const keep = keepSet(ctx.mine);
      const opts = { launchId: war.launchId, minValue: counter.minValue, exceptWarId: war.id };
      const raised =
        stakeFor(boardKeeping(ctx.board, keep), war.attackerId, war.targetId, opts) ??
        stakeFor(ctx.board, war.attackerId, war.targetId, opts);
      if (!raised) return { kind: 'withdraw' };
      const u = attackValue(ctx, {
        targetId: war.targetId,
        defenderId: war.defenderId,
        launchId: war.launchId,
        stake: raised.stake,
      });
      return u > 0 ? { kind: 'accept', stake: raised.stake } : { kind: 'withdraw' };
    }
    case 'redirect': {
      const u = attackValue(ctx, {
        targetId: counter.targetId,
        defenderId: war.defenderId,
        launchId: war.launchId,
        stake: war.stake,
      });
      return u > 0 ? { kind: 'accept' } : { kind: 'withdraw' };
    }
    case 'tribute': {
      const fightOn = attackValue(ctx, {
        targetId: war.targetId,
        defenderId: war.defenderId,
        launchId: war.launchId,
        stake: war.stake,
      });
      const offer = counter.territoryId
        ? attackerTributeValue(s, knobs, war, counter.territoryId)
        : counter.tokens * TOKEN_VALUE;
      return offer >= fightOn ? { kind: 'accept' } : { kind: 'refuse' };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Diplomacy

/** The best quick score against each rival, ignoring accords (what breaking one would open up). */
function appetite(s: SimState, knobs: BotKnobs, me: UserId): Map<UserId, number> {
  const board = { ...warBoard(s), accords: [], renunciations: [] };
  const ctx = context(s, knobs, me, board);
  const best = new Map<UserId, number>();
  for (const id of attackableTargets(board, me)) {
    const owner = s.holdings.get(id)!.ownerId;
    const u = preScore(ctx, id);
    if (u > (best.get(owner) ?? -Infinity)) best.set(owner, u);
  }
  return best;
}

const secretIs = (s: SimState, p: SimPlayer, kind: string) => p.secret?.kind === kind && !hasScored(s, p.id, 'secret');

function neighboursOf(s: SimState, me: UserId): Set<UserId> {
  const out = new Set<UserId>();
  for (const id of heldBy(s, me)) {
    for (const n of s.idx.neighbors(id)) {
      const owner = s.holdings.get(n)?.ownerId;
      if (owner && owner !== me) out.add(owner);
    }
  }
  return out;
}

/** Whether the campaign has ended (read fresh: accords can end it through a settle). */
const over = (s: SimState) => s.status === 'finished';

function diplomacy(s: SimState, knobs: BotKnobs): void {
  if (!knobs.accords || over(s)) return;
  const order = shuffled(s.order, s.rng.bots);
  const appetites = new Map<UserId, Map<UserId, number>>();
  const appetiteOf = (id: UserId) => {
    let a = appetites.get(id);
    if (!a) appetites.set(id, (a = appetite(s, knobs, id)));
    return a;
  };

  // Breaking accords, in war rounds only.
  if (s.round >= 1) {
    for (const id of order) {
      const p = s.byId.get(id)!;
      for (const accord of s.accords.filter(
        (a) => a.status === 'active' && (a.proposerId === id || a.recipientId === id),
      )) {
        const partner = accord.proposerId === id ? accord.recipientId : accord.proposerId;
        const a = appetiteOf(id);
        const onPartner = a.get(partner) ?? -Infinity;
        const elsewhere = Math.max(-Infinity, ...[...a].filter(([o]) => o !== partner).map(([, u]) => u));
        const backstab = secretIs(s, p, 'backstab') && onPartner > 0;
        if (backstab || onPartner > elsewhere + knobs.betrayMargin) {
          renounce(s, accord, id);
          appetites.clear();
          if (over(s)) return;
        }
      }
    }
  }

  // Proposing, and answering at once.
  for (const id of order) {
    const p = s.byId.get(id)!;
    const wantsTwo = secretIs(s, p, 'protected_expansion');
    const wantsOne = secretIs(s, p, 'backstab');
    const partners = s.accords.filter(
      (a) => a.status === 'active' && (a.proposerId === id || a.recipientId === id) && (a.endsRound ?? 0) > s.round + 1,
    ).length;
    const eager = (wantsTwo && partners < 2) || (wantsOne && partners < 1);
    if (!eager && s.rng.bots() >= knobs.proposeRate) continue;
    const a = appetiteOf(id);
    const candidates = [...neighboursOf(s, id)].filter((q) => {
      const current = accordInForce(s, id, q);
      return (!current || (current.endsRound ?? 0) <= s.round + 1) && !betrayed(s, id, q) && !betrayed(s, q, id);
    });
    if (candidates.length === 0) continue;
    // A Backstab holder courts the neighbour it most wants to hit; everyone else the one it least does.
    const ranked = candidates.sort((x, y) =>
      wantsOne ? (a.get(y) ?? -99) - (a.get(x) ?? -99) : (a.get(x) ?? -99) - (a.get(y) ?? -99),
    );
    const partner = ranked[0]!;
    const best = Math.max(-Infinity, ...a.values());
    if (!eager && (a.get(partner) ?? -Infinity) >= best && best > knobs.declareThreshold) continue;
    const accord = propose(s, id, partner, 3);
    answer(s, accord, accepts(s, knobs, partner, id, appetiteOf(partner)));
    appetites.clear();
    if (over(s)) return;
  }
}

/** Whether `breakerId` has ever broken an accord with `victimId`: nobody signs with their betrayer again. */
const betrayed = (s: SimState, victimId: UserId, breakerId: UserId) =>
  s.accords.some(
    (a) =>
      a.status === 'broken' && a.brokenBy === breakerId && (a.proposerId === victimId || a.recipientId === victimId),
  );

function accepts(s: SimState, knobs: BotKnobs, me: UserId, proposerId: UserId, a: Map<UserId, number>): boolean {
  const p = s.byId.get(me)!;
  const proposer = s.byId.get(proposerId)!;
  if (betrayed(s, me, proposerId)) return false;
  const needs = secretIs(s, p, 'protected_expansion') || secretIs(s, p, 'backstab');
  if (proposer.reputation < knobs.grudge && !needs) return false;
  const onProposer = a.get(proposerId) ?? -Infinity;
  const elsewhere = Math.max(-Infinity, ...[...a].filter(([o]) => o !== proposerId).map(([, u]) => u));
  let chance = 0.55 + knobs.acceptBias + (needs ? 0.35 : 0);
  if (onProposer > elsewhere && onProposer > knobs.declareThreshold) chance -= 0.35;
  const leaders = leadersAt(missionWorld(s), s.seq + 1);
  if (leaders.length === 1 && leaders[0] === proposerId && (s.points.get(proposerId) ?? 0) >= 3) chance -= 0.3;
  return s.rng.bots() < chance;
}

// ---------------------------------------------------------------------------------------------

export function standardBots(knobs: BotKnobs): Bots {
  return {
    draftPick: draftPicker(knobs),
    chooseSecret: secretChooser(knobs),
    diplomacy: (s) => diplomacy(s, knobs),
    declare: (s, player) => (heldBy(s, player.id).size === 0 ? null : declareFor(s, player, knobs)),
    respond: (s, war) => respondFor(s, war, knobs),
    reply: (s, war) => replyFor(s, war, knobs),
  };
}
