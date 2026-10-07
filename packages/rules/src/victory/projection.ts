/**
 * What a war's endings would do to the race: who holds what, which titles move, the missions a
 * viewer may see, everyone's points and whether anyone would win the campaign there and then.
 *
 * A preview only, worked out with the functions `settleVictory` scores with (`titleHolders`,
 * `evaluateMission`, `claimBlockers`, `victoryWinners`) and in its order: titles from the map first,
 * then every mission, then the finish line. Nothing here is a second scoring system: change how
 * scoring works and the preview follows. Missions the viewer may not see (another player's
 * unrevealed secret) are never part of the input, so nothing about them can come out of it.
 */
import type { GameEndReason } from '../chess';
import type { CampaignView, WarView } from '../protocol';
import type { DatasetIndex } from '../graph';
import type { TerritoryId } from '../dataset';
import type { UserId } from '../draft';
import { activeWar, type Holding, type Transfer, type WarBoard, type WarOutcome } from '../war';
import { claimBlockers, type OpenWar } from './blockers';
import { missionInfo, type ClaimHold, type MissionSpec } from './catalog';
import { claimEligibleRound, claimTimeServed, victoryWinners } from './claims';
import { evaluateMission, type Evaluation } from './evaluate';
import { titleHolders, type TitleHolders, type TitleKind } from './titles';
import { EMPTY_HISTORY, type MissionHistory, type MissionWar, type MissionWorld } from './world';

/**
 * The part of a campaign's mission world that isn't already on the map, as the campaign view
 * carries it: every player's holdings when the draft ended, and the history the battle and accord
 * missions count. All of it is public (the draft, wars, accords, round starts and awards are in
 * every member's dispatches); nothing in it says which secret mission anyone has.
 */
export interface MissionWorldView {
  /** Each player's holdings when the draft finished, by player id. */
  baselines: Record<UserId, TerritoryId[]>;
  history: MissionHistory;
  /** Where each unresolved war's declaration falls in the history (its `war.declared` event id), by war id. */
  declared: Record<string, number>;
}

/** The mission world as the server builds it (`loadWorld`), from the map and the view's history. */
export function missionWorldFrom(
  idx: DatasetIndex,
  players: readonly UserId[],
  owners: ReadonlyMap<TerritoryId, UserId>,
  view: Pick<MissionWorldView, 'baselines' | 'history'>,
): MissionWorld {
  return {
    idx,
    players: [...players].sort(),
    owners,
    baseline: new Map(Object.entries(view.baselines).map(([userId, ids]) => [userId, new Set(ids)])),
    history: view.history,
  };
}

/** Where a war resolved now falls in the history: after everything that has happened. */
export const RESOLVED_NOW_SEQ = Number.MAX_SAFE_INTEGER;
/** Where a war declared now falls in the history: after everything so far, before its own end. */
export const DECLARED_NOW_SEQ = Number.MAX_SAFE_INTEGER - 1;

/** A mission one player can still score, as far as the viewer may see it. */
export interface PlayedSlot {
  userId: UserId;
  /** The mission's key: a public slot (`p0`…) or `secret`. */
  key: string;
  points: number;
  spec: MissionSpec;
  /** A secret mission not revealed yet: only ever the viewer's own. */
  hidden?: boolean;
}

/** A claim waiting to score. */
export interface PendingClaim {
  userId: UserId;
  missionKey: string;
  startedRound: number;
  eligibleRound: number;
  /** It has waited long enough: its round has come and the turns (or the holding time) are served. */
  served: boolean;
  /** Unresolved wars that could still break it, by id. */
  blockedBy: readonly string[];
}

/**
 * Whether a claim as the campaign view shows it has waited long enough, as `settleVictory` judges
 * it: `claimTurnsServed` where claims are held through a round's turns (`turnsHeld` is
 * `claimTurnsHeld` worked out on the server), `claimTimeServed` where they're held for a time.
 */
export function claimServed(
  claim: { startedRound: number; eligibleAt: number | null; turnsHeld: boolean },
  hold: ClaimHold,
  round: number,
  now: number,
): boolean {
  if (hold === 'turns') return round >= claimEligibleRound(claim.startedRound) && claim.turnsHeld;
  return claimTimeServed({ startedRound: claim.startedRound, eligibleAt: claim.eligibleAt }, round, now);
}

/** Everything the preview reads: the campaign as it stands. */
export interface ScoreState {
  world: MissionWorld;
  /** What the war rules see now: holdings, unresolved wars, truces and accords. */
  board: WarBoard;
  /** Unresolved wars, as claim blockers read them. */
  openWars: readonly OpenWar[];
  /** Everyone's points now: missions scored and titles held. */
  points: ReadonlyMap<UserId, number>;
  pointsToWin: number;
  /** Who holds each title. */
  titles: TitleHolders;
  /** The titles the campaign plays with (none before mission rules version 5). */
  titleKinds: readonly TitleKind[];
  titlePoints: number;
  /** Missions not scored yet, that the viewer may see. */
  missions: readonly PlayedSlot[];
  claims: readonly PendingClaim[];
}

/** A war, as far as the preview needs it. */
export interface ProjectedWar {
  id: string;
  attackerId: UserId;
  defenderId: UserId;
  launchId: TerritoryId;
  /** The country fought over in the end (a redirect's, once accepted). */
  targetId: TerritoryId;
  declaredRound: number;
  /** Where its declaration falls in the history: its event id, or `DECLARED_NOW_SEQ` for one not declared yet. */
  declaredSeq: number;
}

/** One way a war could end. */
export interface WarEnding {
  outcome: WarOutcome;
  transfers: readonly Transfer[];
  /** How the deciding game ended, where one did: a checkmate counts for Checkmate Artist. */
  endReason: GameEndReason | null;
}

export interface TitleMove {
  kind: TitleKind;
  from: UserId | null;
  to: UserId | null;
}

/**
 * What an ending means for one mission:
 * - `scores`: its points are awarded in the same change (a record completed, or a claim that has
 *   waited long enough with no war left that could break it);
 * - `claims`: a position is completed and a claim starts, scoring from `eligibleRound` if held;
 * - `keeps`: a pending claim this war could have broken survives it, still waiting;
 * - `breaks`: a pending claim is lost;
 * - `progress` and `setback`: nearer to completion, or further from it.
 */
export type MissionChange = 'scores' | 'claims' | 'keeps' | 'breaks' | 'progress' | 'setback';

export interface MissionEffect {
  userId: UserId;
  key: string;
  points: number;
  spec: MissionSpec;
  change: MissionChange;
  before: Evaluation;
  after: Evaluation;
  /** A hidden secret mission (the viewer's own) this would reveal to everyone. */
  reveals: boolean;
  /** When a claim this starts, or keeps, can score at the earliest. */
  eligibleRound?: number;
  /** Other unresolved wars that could still break a claim this starts or keeps, by id. */
  blockedBy?: string[];
}

export interface EndingProjection {
  ending: WarEnding;
  titles: TitleMove[];
  /** Missions this ending changes, for the two players at war (no one else's can change). */
  missions: MissionEffect[];
  /** Everyone's points right after it: titles moved and missions scored at once. */
  points: Map<UserId, number>;
  /** Who would win the campaign there and then (empty: nobody). */
  winners: UserId[];
  /** Claims this starts or keeps that would take their player to the points to win, if they score. */
  claimWins: MissionEffect[];
}

/** How far along a mission is, as one number: each part's share done, added up. */
const along = (e: Evaluation) =>
  e.parts.reduce((sum, p) => sum + (p.need > 0 ? Math.min(p.have, p.need) / p.need : 1), 0);

/**
 * The preview of one war: how each ending would change the race. Missions are evaluated for the two
 * players at war only (a war elsewhere never changes anyone's holdings or battles), and each
 * mission's standing before is worked out once for every ending.
 */
export function projectWar(state: ScoreState, war: ProjectedWar, endings: readonly WarEnding[]): EndingProjection[] {
  const players = [...new Set([war.attackerId, war.defenderId])];
  const slots = state.missions.filter((m) => players.includes(m.userId));
  const before = new Map(slots.map((m) => [m, evaluateMission(state.world, m.userId, m.spec)]));
  return endings.map((ending) => projectEnding(state, war, ending, slots, before));
}

function projectEnding(
  state: ScoreState,
  war: ProjectedWar,
  ending: WarEnding,
  slots: readonly PlayedSlot[],
  before: ReadonlyMap<PlayedSlot, Evaluation>,
): EndingProjection {
  const { world, board } = state;
  const round = board.round;
  // The map and history as they'd be once the war is resolved (see `resolveWar` and `loadHistory`).
  const owners = new Map(world.owners);
  for (const t of ending.transfers) owners.set(t.territoryId, t.to);
  const resolved: MissionWar = {
    id: war.id,
    attackerId: war.attackerId,
    defenderId: war.defenderId,
    launchId: war.launchId,
    targetId: war.targetId,
    outcome: ending.outcome,
    transfers: ending.transfers,
    declaredRound: war.declaredRound,
    round,
    declaredSeq: war.declaredSeq,
    seq: RESOLVED_NOW_SEQ,
    endReason: ending.endReason,
  };
  const after: MissionWorld = {
    ...world,
    owners,
    history: { ...world.history, wars: [...world.history.wars, resolved] },
  };
  const holdings = new Map<TerritoryId, Holding>(board.holdings);
  for (const t of ending.transfers)
    holdings.set(t.territoryId, { ownerId: t.to, acquiredRound: round, fortifiedUntil: null });
  const boardAfter: WarBoard = { ...board, holdings, wars: board.wars.filter((w) => w.id !== war.id) };
  const openAfter = state.openWars.filter((w) => w.id !== war.id);

  // Titles first, from the map as it would be.
  const points = new Map(state.points);
  const titles: TitleMove[] = [];
  if (state.titleKinds.length > 0) {
    const next = titleHolders(after.idx, owners, world.players, state.titles, state.titleKinds);
    for (const kind of state.titleKinds) {
      const from = state.titles[kind] ?? null;
      const to = next[kind];
      if (from === to) continue;
      titles.push({ kind, from, to });
      if (from) points.set(from, (points.get(from) ?? 0) - state.titlePoints);
      if (to) points.set(to, (points.get(to) ?? 0) + state.titlePoints);
    }
  }

  // Then every mission of the two players at war.
  const missions: MissionEffect[] = [];
  for (const slot of slots) {
    const was = before.get(slot)!;
    const now = evaluateMission(after, slot.userId, slot.spec);
    // The server reveals a hidden secret the moment it comes within a step (or is completed in one go).
    const reveals = Boolean(slot.hidden) && now.near && !was.near;
    const effect = (change: MissionChange, extra: Partial<MissionEffect> = {}): MissionEffect => ({
      userId: slot.userId,
      key: slot.key,
      points: slot.points,
      spec: slot.spec,
      change,
      before: was,
      after: now,
      reveals,
      ...extra,
    });
    const step = along(now) - along(was);
    const moved = step > 0 ? 'progress' : step < 0 ? 'setback' : null;
    if (missionInfo(slot.spec.kind).timing === 'historic') {
      if (now.complete && !was.complete) missions.push(effect('scores'));
      else if (moved || reveals) missions.push(effect(moved ?? 'progress'));
      continue;
    }
    const claim = state.claims.find((c) => c.userId === slot.userId && c.missionKey === slot.key);
    if (!now.complete) {
      if (claim) missions.push(effect('breaks'));
      else if (moved || reveals) missions.push(effect(moved ?? 'progress'));
      continue;
    }
    const blockers = claimBlockers(after, boardAfter, slot.userId, slot.spec, openAfter);
    if (!claim) {
      missions.push(effect('claims', { eligibleRound: claimEligibleRound(round), blockedBy: blockers }));
    } else if (claim.served && blockers.length === 0) {
      missions.push(effect('scores'));
    } else if (claim.blockedBy.includes(war.id)) {
      missions.push(effect('keeps', { eligibleRound: claim.eligibleRound, blockedBy: blockers }));
    }
  }

  // Every award of the change, then the finish line (only checked when something moved).
  for (const m of missions) if (m.change === 'scores') points.set(m.userId, (points.get(m.userId) ?? 0) + m.points);
  const moved = titles.length > 0 || missions.some((m) => m.change === 'scores');
  const winners = moved ? victoryWinners(points, state.pointsToWin) : [];
  const claimWins = missions.filter(
    (m) =>
      (m.change === 'claims' || m.change === 'keeps') && (points.get(m.userId) ?? 0) + m.points >= state.pointsToWin,
  );
  return { ending, titles, missions, points, winners, claimWins };
}

/** A war as the campaign view has it, for the preview: where its declaration falls comes from the world. */
export function projectedWarOf(
  war: Pick<WarView, 'id' | 'attackerId' | 'defenderId' | 'launchId' | 'targetId' | 'declaredRound'>,
  world: Pick<MissionWorldView, 'declared'> | undefined,
): ProjectedWar {
  return {
    id: war.id,
    attackerId: war.attackerId,
    defenderId: war.defenderId,
    launchId: war.launchId,
    targetId: war.targetId,
    declaredRound: war.declaredRound,
    declaredSeq: world?.declared[war.id] ?? DECLARED_NOW_SEQ,
  };
}

/** An unresolved war of the campaign view as the claim blockers read it. */
export const openWarOf = (w: WarView): OpenWar => ({
  id: w.id,
  attackerId: w.attackerId,
  defenderId: w.defenderId,
  targetId: w.targetId,
  launchId: w.launchId,
  stake: w.stake,
  status: w.status,
  counter: w.counter,
  reserves: w.reserves,
});

/**
 * The campaign as `viewerId` may preview it, from their campaign view: public missions for every
 * player, their own secret mission (hidden until revealed) and others' revealed ones, pending claims,
 * titles and points. Another player's unrevealed secret isn't in the view, so it isn't here either.
 * Null outside the war, or in campaigns without victory points. Where the server sent no mission
 * world (`VictoryView.world`, from servers before 2026-10-07), missions can't be previewed:
 * `missionsKnown` is false and only the map, titles and points are.
 */
export function scoreStateFrom(
  view: CampaignView,
  viewerId: UserId,
  board: WarBoard,
  now: number,
): (ScoreState & { missionsKnown: boolean }) | null {
  const victory = view.victory;
  if (!victory || view.status !== 'active') return null;
  const worldView = victory.world;
  const owners = new Map(Object.entries(view.holdings));
  const players = view.members.map((m) => m.userId);
  const world = missionWorldFrom(board.idx, players, owners, worldView ?? { baselines: {}, history: EMPTY_HISTORY });
  const missions: PlayedSlot[] = [];
  if (worldView) {
    for (const p of victory.players) {
      const scored = new Set(p.awards.map((a) => a.missionKey));
      const own = p.userId === viewerId ? view.mySecret : null;
      const secret = own ? own.mission : (p.secret?.mission ?? null);
      for (const m of [...victory.publicMissions, ...(secret ? [secret] : [])]) {
        if (scored.has(m.key)) continue;
        const hidden = m.scope === 'secret' && own !== null && !own.revealed;
        missions.push({ userId: p.userId, key: m.key, points: m.points, spec: m.spec, ...(hidden && { hidden }) });
      }
    }
  }
  return {
    world,
    board,
    openWars: view.wars.filter((w) => w.status !== 'resolved').map(openWarOf),
    points: new Map(victory.players.map((p) => [p.userId, p.points])),
    pointsToWin: victory.pointsToWin,
    titles: Object.fromEntries(victory.titles.map((t) => [t.kind, t.holderId])),
    titleKinds: victory.titles.map((t) => t.kind),
    titlePoints: victory.titlePoints,
    missions,
    claims: worldView
      ? victory.claims.map((c) => ({
          userId: c.userId,
          missionKey: c.missionKey,
          startedRound: c.startedRound,
          eligibleRound: c.eligibleRound,
          served: claimServed(
            {
              startedRound: c.startedRound,
              eligibleAt: c.eligibleAt ? Date.parse(c.eligibleAt) : null,
              turnsHeld: c.turnsHeld,
            },
            victory.hold,
            view.round,
            now,
          ),
          blockedBy: c.blockedBy,
        }))
      : [],
    missionsKnown: worldView !== undefined,
  };
}

/**
 * The pending claims a war declared now would hold up: claims of the two players that the new war
 * could break in some ending, so they can't score while it lasts (see `claimBlockers`).
 */
export function claimsHeldUp(state: ScoreState, war: OpenWar): PendingClaim[] {
  const board: WarBoard = { ...state.board, wars: [...state.board.wars, activeWar(war)] };
  const open = [...state.openWars, war];
  return state.claims.filter((claim) => {
    if (claim.userId !== war.attackerId && claim.userId !== war.defenderId) return false;
    const slot = state.missions.find((m) => m.userId === claim.userId && m.key === claim.missionKey);
    return slot !== undefined && claimBlockers(state.world, board, claim.userId, slot.spec, open).includes(war.id);
  });
}
