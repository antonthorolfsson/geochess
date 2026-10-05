/**
 * Scoring, as the server's `settleVictory` does it (apps/server/src/victory/settle.ts): reveals
 * first, then claims start, carry on or break, then every award of the pass goes in together and
 * the finish line is checked. Time is counted in rounds: a claim from round R scores from R+2,
 * the host being assumed to wait out the holding time before starting R+2.
 */
import {
  SECRET_MISSION_KEY,
  claimBlockers,
  evaluateMission,
  missionComplete,
  missionInfo,
  missionName,
  pathWithin,
  publicMissionKey,
  victoryWinners,
  type Evaluation,
  type MissionSpec,
  type MissionWorld,
  type UserId,
} from '@empire/rules';
import { openWarViews, warBoard } from './board';
import { nextSeq, note, pointsToWin, publicPoints, secretPoints } from './state';
import type { Award, Claim, MissionSlot, SimPlayer, SimState } from './types';
import { settleTitles } from './titles';
import { missionWorld } from './world';

/** Everything a player can score: the public missions, then their secret one. */
export function slotsFor(s: SimState, p: SimPlayer): MissionSlot[] {
  const slots: MissionSlot[] = s.publicSpecs.map((spec, i) => ({
    key: publicMissionKey(i),
    scope: 'public',
    points: publicPoints(s),
    spec,
  }));
  if (p.secret) {
    const points = s.cfg.variant?.secretPoints?.(p.secret.kind) ?? secretPoints(s);
    slots.push({ key: SECRET_MISSION_KEY, scope: 'secret', points, spec: p.secret });
  }
  return slots;
}

const scoredKey = (userId: UserId, missionKey: string) => `${userId}\n${missionKey}`;

export const hasScored = (s: SimState, userId: UserId, missionKey: string) =>
  s.awards.some((a) => a.userId === userId && a.missionKey === missionKey);

const CONNECTIONS = new Set(['great_connection', 'silk_road', 'cape_to_cairo', 'pan_american_highway']);

/**
 * The rules' completion predicate. For the connection missions it's asked directly (both ends held
 * and joined), which is what `missionComplete` decides first; the rules' evaluator would also work
 * out the best open route for its progress display, which completion doesn't need and costs most
 * of a simulated campaign's time.
 */
function rulesComplete(world: MissionWorld, userId: UserId, spec: MissionSpec): boolean {
  if (CONNECTIONS.has(spec.kind) && 'endpoints' in spec && !('needsConquest' in spec && spec.needsConquest)) {
    const held = new Set<string>();
    for (const [id, owner] of world.owners) if (owner === userId) held.add(id);
    return pathWithin(world.idx, held, spec.endpoints[0], spec.endpoints[1]) !== null;
  }
  return missionComplete(world, userId, spec);
}

/** Completion by the rules, and by the variant's extra condition if it has one. */
export function isComplete(s: SimState, world: MissionWorld, userId: UserId, spec: MissionSpec): boolean {
  if (!rulesComplete(world, userId, spec)) return false;
  return s.cfg.variant?.requires?.(world, userId, spec) ?? true;
}

export function evaluate(s: SimState, world: MissionWorld, userId: UserId, spec: MissionSpec): Evaluation {
  const ev = evaluateMission(world, userId, spec);
  if (!ev.complete || !s.cfg.variant?.requires || s.cfg.variant.requires(world, userId, spec)) return ev;
  return { ...ev, complete: false };
}

function reveal(s: SimState, p: SimPlayer, why: 'near' | 'claim'): void {
  p.revealedRound = s.round;
  note(s, () => `${p.id}'s secret revealed (${why}): ${missionName(p.secret!)}`);
}

interface Due {
  player: SimPlayer;
  slot: MissionSlot;
  claim: Claim | null;
}

/**
 * Brings missions up to date after a change. `only` limits the pass to the players the change
 * touched (a war's two sides): every mission depends only on its own player's holdings and
 * history, so the others can't have moved. Round starts pass everyone.
 */
export function settle(s: SimState, only?: ReadonlySet<UserId>): void {
  if (s.status !== 'active') return;
  // Titles follow the whole table's holdings, whoever the change touched.
  const moved = settleTitles(s);
  const world = missionWorld(s);
  const open = openWarViews(s);
  const board = open.length > 0 ? warBoard(s) : null;
  const scored = new Set(s.awards.map((a) => scoredKey(a.userId, a.missionKey)));
  const due: Due[] = [];

  for (const player of [...s.players].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (only && !only.has(player.id)) continue;
    for (const slot of slotsFor(s, player)) {
      const key = scoredKey(player.id, slot.key);
      if (scored.has(key)) continue;
      // Only a secret still hidden needs the reveal rule; everything else just needs completion.
      const hidden = slot.scope === 'secret' && player.revealedRound === null;
      const ev = hidden
        ? evaluate(s, world, player.id, slot.spec)
        : { complete: isComplete(s, world, player.id, slot.spec), near: false };
      if (hidden && (ev.near || ev.complete)) {
        reveal(s, player, ev.complete ? 'claim' : 'near');
      }
      if (missionInfo(slot.spec.kind).timing === 'historic') {
        if (ev.complete) due.push({ player, slot, claim: null });
        continue;
      }
      let claim = s.claims.get(key) ?? null;
      if (!ev.complete) {
        if (claim) {
          claim.status = 'interrupted';
          claim.endedRound = s.round;
          s.claims.delete(key);
          note(s, () => `${player.id} lost the claim on ${missionName(slot.spec)}`);
        }
        continue;
      }
      if (!claim) {
        claim = {
          userId: player.id,
          missionKey: slot.key,
          kind: slot.spec.kind,
          startedRound: s.round,
          status: 'pending',
          endedRound: null,
          blockedBy: [],
        };
        s.claims.set(key, claim);
        s.claimLog.push(claim);
        note(s, () => `${player.id} claims ${missionName(slot.spec)} (scores from round ${s.round + 2})`);
      }
      const served = s.round >= claim.startedRound + 2;
      claim.blockedBy = board ? claimBlockers(world, board, player.id, slot.spec, open) : [];
      if (served && claim.blockedBy.length === 0) due.push({ player, slot, claim });
    }
  }
  if (due.length === 0 && !moved) return;

  for (const { player, slot, claim } of due) {
    const seq = nextSeq(s);
    const award: Award = {
      userId: player.id,
      missionKey: slot.key,
      kind: slot.spec.kind,
      scope: slot.scope,
      points: slot.points,
      round: s.round,
      seq,
      claimStartedRound: claim?.startedRound ?? null,
    };
    s.awards.push(award);
    s.history.awards.push({ userId: player.id, points: slot.points, seq });
    s.points.set(player.id, (s.points.get(player.id) ?? 0) + slot.points);
    if (claim) {
      claim.status = 'awarded';
      claim.endedRound = s.round;
      s.claims.delete(scoredKey(player.id, slot.key));
    }
    note(s, () => `${player.id} scores ${missionName(slot.spec)} (+${slot.points}, ${s.points.get(player.id)})`);
  }
  const toWin = pointsToWin(s);
  const winners = victoryWinners(s.points, toWin);
  if (winners.length === 0) return;
  s.firstToWinRound ??= s.round;
  if (s.cfg.mode === 'normal') finish(s, winners);
}

/**
 * The campaign ends: unfinished wars are cancelled with nothing changing hands (tokens held back
 * as tribute, or paid for a counter still unanswered, go back), claims and peace offers lapse.
 */
export function finish(s: SimState, winners: UserId[]): void {
  s.status = 'finished';
  s.winners = winners;
  s.finishedRound = s.round;
  for (const offer of s.peaceOffers) if (offer.status === 'proposed') offer.status = 'lapsed';
  for (const war of s.wars) {
    if (war.status === 'resolved') continue;
    const held = war.status === 'countered' ? (war.counter?.tokens ?? 0) : 0;
    if (held > 0) s.byId.get(war.defenderId)!.tokens += held;
    war.status = 'resolved';
    war.outcome = 'cancelled';
    war.resolvedRound = s.round;
    war.seq = nextSeq(s);
    s.stats.outcomes.cancelled++;
  }
  for (const claim of s.claims.values()) {
    claim.status = 'cancelled';
    claim.endedRound = s.round;
  }
  s.claims.clear();
  note(s, () => `Campaign won by ${winners.join(' and ')} with ${s.points.get(winners[0]!)} points`);
}
