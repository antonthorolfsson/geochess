/**
 * A campaign from the lobby to round 1, and each round start after that, in the server's order:
 * public missions in the lobby (apps/server/src/victory/lobby.ts), the snake draft, baselines and
 * secret options (victory/selection.ts), then rounds (wars/service.ts `nextRound`) and their turns.
 */
import {
  PUBLIC_MISSION_KINDS,
  drawPublicKinds,
  generatePublicMission,
  generatePublicMissions,
  legalPicks,
  missionComplete,
  pickerAt,
  publicMissionIssue,
  publicTargets,
  refillTokens,
  secretCandidates,
  secretOptions,
  seededRandom,
  shuffled,
  type PublicMissionKind,
  type PublicMissionSpec,
  type Random,
  type SecretCandidate,
  type SecretOption,
  type TerritoryId,
  type UserId,
} from '@empire/rules';
import { startRoundForAccords } from './diplomacy';
import { heldBy, nextSeq, note, valueOfPlayer } from './state';
import { titlesOf } from './titles';
import { beginTurns } from './turns';
import type { SimPlayer, SimState } from './types';
import { settle, slotsFor } from './victory';
import { missionWorld } from './world';

// ---------------------------------------------------------------------------------------------
// The lobby

const excludedPublic = (s: SimState, kind: PublicMissionKind) =>
  s.cfg.variant?.excludePublic?.(kind, { players: s.cfg.players }) ?? false;

/** The default missions, or as near as the map (and the variant) allow, like the server's lobby. */
function defaultPublic(s: SimState, random: Random): PublicMissionSpec[] {
  const defaults = s.mr.defaultPublic.filter((k) => !excludedPublic(s, k));
  if (defaults.length === s.mr.publicCount) {
    const result = generatePublicMissions(defaults, s.idx, s.rules, random);
    if ('missions' in result) return result.missions;
  }
  const taken = new Set<TerritoryId>();
  const out: PublicMissionSpec[] = [];
  const others = PUBLIC_MISSION_KINDS.filter((k) => !s.mr.defaultPublic.includes(k));
  for (const kind of [...defaults, ...others]) {
    if (out.length >= s.mr.publicCount) break;
    if (excludedPublic(s, kind) || !s.mr.publicKinds.includes(kind) || publicMissionIssue(kind, s.idx, s.rules)) {
      continue;
    }
    const spec = generatePublicMission(kind, s.idx, s.rules, random, taken);
    if (!spec) continue;
    out.push(spec);
    for (const id of publicTargets(spec)) taken.add(id);
  }
  return out;
}

/**
 * Four different kinds drawn from those playable at this table, as the server's lobby draws them
 * (`drawPublicKinds`); with a variant's exclusions, the same draw over what remains.
 */
function drawKinds(s: SimState, random: Random): PublicMissionKind[] {
  const players = s.cfg.players;
  if (!s.cfg.variant?.excludePublic) return drawPublicKinds(s.idx, s.rules, random, players);
  const playable = s.mr.publicKinds.filter(
    (kind) => publicMissionIssue(kind, s.idx, s.rules, players) === null && !excludedPublic(s, kind),
  );
  const drawn: PublicMissionKind[] = [];
  let long = 0;
  for (const kind of shuffled(playable, random)) {
    if (drawn.length >= s.mr.publicCount) break;
    if (s.mr.long.includes(kind)) {
      if (long >= s.mr.longDrawn) continue;
      long++;
    }
    drawn.push(kind);
  }
  return playable.filter((kind) => drawn.includes(kind));
}

export function setupPublicMissions(s: SimState): void {
  const random = s.rng.setup;
  const { publics } = s.cfg;
  let specs: PublicMissionSpec[] | null = null;
  if (publics === 'default') specs = defaultPublic(s, random);
  else if (publics === 'random') {
    for (let attempt = 0; attempt < 6 && !specs; attempt++) {
      const result = generatePublicMissions(drawKinds(s, random), s.idx, s.rules, random, s.cfg.players);
      if ('missions' in result) specs = result.missions;
    }
  } else {
    const result = generatePublicMissions(publics, s.idx, s.rules, random, s.cfg.players);
    if ('error' in result) throw new Error(`Public missions: ${result.error}`);
    specs = result.missions;
  }
  if (!specs || specs.length !== s.mr.publicCount) throw new Error('No playable set of public missions');
  specs = [...specs, ...extraPublic(s, specs, random)];
  const patch = s.cfg.variant?.patchPublic;
  s.publicSpecs = patch
    ? specs.map((spec, i) => {
        const taken = new Set(specs.flatMap((other, j) => (j === i ? [] : publicTargets(other))));
        return patch(spec, { players: s.cfg.players, idx: s.idx, random, taken });
      })
    : specs;
  s.rules = { ...s.rules, victory: { ...s.rules.victory, publicMissions: s.publicSpecs } };
}

/** A variant's public missions on top of the campaign's (`Variant.extraPublic`), clear of their targets. */
function extraPublic(s: SimState, specs: readonly PublicMissionSpec[], random: Random): PublicMissionSpec[] {
  const extra = s.cfg.variant?.extraPublic;
  if (!extra) return [];
  const players = s.cfg.players;
  const inPlay = new Set(specs.map((spec) => spec.kind));
  const playable = (kind: PublicMissionKind) =>
    !inPlay.has(kind) &&
    s.mr.publicKinds.includes(kind) &&
    !excludedPublic(s, kind) &&
    publicMissionIssue(kind, s.idx, s.rules, players) === null;
  const kinds =
    typeof extra === 'function'
      ? shuffled(
          s.mr.publicKinds.filter((kind) => playable(kind) && !s.mr.long.includes(kind)),
          random,
        ).slice(0, extra(players))
      : extra.filter(playable);
  const taken = new Set(specs.flatMap((spec) => publicTargets(spec)));
  const out: PublicMissionSpec[] = [];
  for (const kind of kinds) {
    const spec = generatePublicMission(kind, s.idx, s.rules, random, taken);
    if (!spec) continue;
    out.push(spec);
    for (const id of publicTargets(spec)) taken.add(id);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The draft

export type DraftPicker = (s: SimState, userId: UserId, legal: readonly TerritoryId[]) => TerritoryId;

/** A full-map snake draft, as the server runs it, each pick made by `pick`. */
export function runDraft(s: SimState, pick: DraftPicker): void {
  s.status = 'draft';
  for (let i = 0; i < s.idx.ids.length; i++) {
    const picker = pickerAt(s.order, i);
    const owners = new Map([...s.holdings].map(([id, h]) => [id, h.ownerId]));
    const legal = legalPicks(s.idx, s.rules, owners, picker);
    if (legal.length === 0) break;
    const choice = pick(s, picker, legal);
    if (!legal.includes(choice)) throw new Error(`Illegal draft pick ${choice} by ${picker}`);
    s.holdings.set(choice, { ownerId: picker, acquiredRound: 0 });
  }
}

// ---------------------------------------------------------------------------------------------
// Secret missions

export type SecretChooser = (s: SimState, player: SimPlayer, options: readonly SecretOption[]) => SecretOption | null;

/**
 * `secretOptions` with some kinds kept out (a variant's exclusions): the same drawing, over the
 * candidates that remain. The fallback (Measured Expansion) isn't reachable from here, so a hand
 * can come up short, which only happens when fewer than three candidates fit.
 */
function optionsWithout(
  s: SimState,
  userId: UserId,
  random: Random,
  excluded: (kind: SecretCandidate['spec']['kind']) => boolean,
): SecretOption[] {
  const valid = secretCandidates(missionWorld(s), userId, s.rules, random).filter((c) => !excluded(c.spec.kind));
  const chosen: SecretCandidate[] = [];
  const draw = (pool: readonly SecretCandidate[]) => {
    const left = pool.filter((c) => !chosen.includes(c));
    if (left.length > 0 && chosen.length < s.mr.secretOptions) chosen.push(left[Math.floor(random() * left.length)]!);
  };
  const families = s.mr.families.length > s.mr.secretOptions ? shuffled(s.mr.families, random) : s.mr.families;
  for (const family of families) draw(valid.filter((c) => c.family === family));
  while (chosen.length < Math.min(s.mr.secretOptions, valid.length)) draw(valid);
  return chosen
    .sort((a, b) => b.fit - a.fit)
    .map((c, i) => ({ id: `o${i + 1}`, rank: i + 1, spec: c.spec, estimate: c.estimate }));
}

/**
 * The draft is over: baselines are recorded, public missions already complete are noted, each
 * player (in id order, each with their own seed) is dealt options, and chooses one.
 */
export function beginSelection(s: SimState, choose: SecretChooser): void {
  s.status = 'selection';
  for (const p of s.players) p.baseline = heldBy(s, p.id);
  const world = missionWorld(s);
  for (const p of s.players) {
    s.publicSpecs.forEach((spec, i) => {
      if (missionComplete(world, p.id, spec))
        s.draftComplete.push({ userId: p.id, missionKey: `p${i}`, kind: spec.kind });
    });
  }
  const exclude = s.cfg.variant?.excludeSecret;
  // Forced assignment hands out kinds itself: dealing options would only be thrown away.
  const deal = s.cfg.bots.secretChoice !== 'forced';
  for (const p of [...s.players].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const seed = Math.floor(s.rng.deal() * 2 ** 31);
    if (!deal) continue;
    p.options = exclude
      ? optionsWithout(s, p.id, seededRandom(seed), (kind) => exclude(kind as never, { players: s.cfg.players }))
      : secretOptions(world, p.id, s.rules, seededRandom(seed));
  }
  for (const p of s.players) {
    const option = choose(s, p, p.options);
    if (!option) continue;
    const patch = s.cfg.variant?.patchSecret;
    p.secret = patch ? patch(option.spec, { players: s.cfg.players }) : option.spec;
  }
  note(s, () =>
    s.players
      .map((p) => `${p.id} (seat ${p.seat + 1}, value ${valueOfPlayer(s, p.id)}) secret: ${p.secret?.kind ?? 'none'}`)
      .join('; '),
  );
}

// ---------------------------------------------------------------------------------------------
// Rounds

function startRound(s: SimState, round: number): void {
  s.round = round;
  const every = s.cfg.variant?.tokenEvery ?? 1;
  for (const p of s.players) {
    if ((round - 1) % every !== 0) continue;
    const before = p.tokens;
    p.tokens = refillTokens(s.rules, p.tokens);
    if (round > 1 && p.tokens === before && p.eliminatedRound === null) s.tokensWasted++;
  }
  s.history.roundStarts.push({ round, seq: nextSeq(s) });
  startRoundForAccords(s);
  beginTurns(s);
}

/** Everyone is ready: round 1 begins, and drafted positions start their claims. */
export function openCampaign(s: SimState): void {
  s.actions.push({ t: 'open' });
  s.status = 'active';
  startRound(s, 1);
  settle(s);
  if (s.cfg.variant?.titles) {
    s.titlesAtStart = Object.fromEntries(s.players.map((p) => [p.id, titlesOf(s, p.id)]));
  }
}

/** The host starts the next round. */
export function nextRound(s: SimState): void {
  s.actions.push({ t: 'round', round: s.round + 1 });
  startRound(s, s.round + 1);
  settle(s);
}

/** Points and value at the end of the round, for the record. */
export function recordTimeline(s: SimState): void {
  const points: Record<UserId, number> = {};
  const value: Record<UserId, number> = {};
  for (const p of s.players) {
    points[p.id] = s.points.get(p.id) ?? 0;
    value[p.id] = valueOfPlayer(s, p.id);
  }
  s.timeline[s.round] = { points, value };
}

export { slotsFor };
