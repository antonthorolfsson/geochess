import {
  attackableTargets,
  suggestPick,
  suggestStake,
  type PublicMissionSpec,
  type SecretMissionSpec,
  type TerritoryId,
  type UserId,
} from '@empire/rules';
import { loadDataset } from '../src/dataset';
import { warBoard } from '../src/engine/board';
import type { PlayedGame } from '../src/engine/chess';
import { openCampaign, runDraft } from '../src/engine/lifecycle';
import { createState, heldBy } from '../src/engine/state';
import type { SimConfig, SimState, SimWar } from '../src/engine/types';
import { settle } from '../src/engine/victory';
import { declare, fight, respond, type Response } from '../src/engine/wars';
import { baseConfig, type ConfigOverrides } from '../src/scenarios';

export const idx = loadDataset();

/**
 * The original game's answers (a free raise, redirects anywhere, tribute), with declarations
 * whenever players like, for tests of those rules.
 */
export const ORIGINAL_ANSWERS = {
  raise: 'free',
  redirect: 'anywhere',
  redirectToken: false,
  fortify: false,
  peaceTerms: false,
  recall: false,
  turns: false,
} as const;

/**
 * A campaign on the real map set up by hand: an auto-draft for the given number of players, then
 * countries moved as asked (counted as drafted), these public missions and secrets, at round 1, on
 * mission rules version 4 unless the config says otherwise.
 * Players declare whenever the test likes, unless its config asks for turns.
 */
export function scripted(opts: {
  players: number;
  publics: (s: SimState) => PublicMissionSpec[];
  give?: (s: SimState) => Record<TerritoryId, UserId>;
  secrets?: (s: SimState) => Record<UserId, SecretMissionSpec>;
  config?: ConfigOverrides;
}): SimState {
  const cfg: SimConfig = baseConfig({
    players: opts.players,
    debug: true,
    // Missions alone: version 4, the last without titles (the titles tests ask for 5).
    missionVersion: 4,
    ...opts.config,
    war: { turns: false, ...opts.config?.war },
  });
  const s = createState(cfg, idx, 1);
  runDraft(s, (st, userId) => {
    const owners = new Map([...st.holdings].map(([id, h]) => [id, h.ownerId]));
    return suggestPick(st.idx, st.rules, owners, userId)!;
  });
  for (const [id, owner] of Object.entries(opts.give?.(s) ?? {}))
    s.holdings.set(id, { ownerId: owner, acquiredRound: 0 });
  for (const p of s.players) p.baseline = heldBy(s, p.id);
  s.publicSpecs = opts.publics(s);
  s.rules = { ...s.rules, victory: { ...s.rules.victory, publicMissions: s.publicSpecs } };
  for (const [id, spec] of Object.entries(opts.secrets?.(s) ?? {})) s.byId.get(id)!.secret = spec;
  s.status = 'selection';
  openCampaign(s);
  return s;
}

/** Moves countries as if won, and lets the missions react. */
export function give(s: SimState, ids: readonly TerritoryId[], to: UserId): void {
  for (const id of ids) s.holdings.set(id, { ownerId: to, acquiredRound: s.round });
  settle(s);
}

/** A country of `defender`'s that `attacker` can declare war on now. */
export function targetOf(
  s: SimState,
  attacker: UserId,
  defender: UserId,
  not: readonly TerritoryId[] = [],
): TerritoryId {
  const board = warBoard(s);
  const target = [...attackableTargets(board, attacker)]
    .sort()
    .find((id) => s.holdings.get(id)!.ownerId === defender && !not.includes(id));
  if (!target) throw new Error(`${attacker} can't attack ${defender}`);
  return target;
}

/** The game ends as asked: the attacker plays White outside Armageddon. */
export const result =
  (winner: 'attacker' | 'defender' | 'draw', reason: PlayedGame['reason'] = 'resignation') =>
  (_war: SimWar, armageddon: boolean): PlayedGame => {
    if (winner === 'draw') return { winner: null, reason: 'agreement' };
    const attackerWhite = !armageddon;
    return { winner: (winner === 'attacker') === attackerWhite ? 'white' : 'black', reason };
  };

/** Declares war with the cheapest stake, for which the attacker gets a token if needed. */
export function declareOn(s: SimState, attacker: UserId, targetId: TerritoryId): SimWar {
  const p = s.byId.get(attacker)!;
  p.tokens = Math.max(p.tokens, 1);
  const plan = suggestStake(warBoard(s), attacker, targetId);
  if (!plan) throw new Error(`${attacker} has no stake for ${targetId}`);
  const war = declare(s, attacker, { targetId, launchId: plan.launchId, stake: plan.stake });
  if (typeof war === 'string') throw new Error(`${attacker} can't declare on ${targetId}: ${war}`);
  return war;
}

/** A whole war: declared, accepted (or answered as given) and fought to the given result. */
export function war(
  s: SimState,
  attacker: UserId,
  targetId: TerritoryId,
  winner: 'attacker' | 'defender' | 'draw',
  opts: { reason?: PlayedGame['reason']; response?: Response } = {},
): SimWar {
  const w = declareOn(s, attacker, targetId);
  const refused = respond(s, w, opts.response ?? { kind: 'accept' });
  if (refused) throw new Error(refused);
  if (w.status === 'ready') fight(s, w, result(winner, opts.reason));
  return w;
}

export const pointsOf = (s: SimState, id: UserId) => s.points.get(id) ?? 0;
export const awardsOf = (s: SimState) => s.awards.map((a) => `${a.userId}:${a.kind}@${a.round}`);
