import {
  REVISED_WAR_RULES,
  missionRules,
  parseRules,
  type CampaignRules,
  type DatasetIndex,
  type TerritoryId,
  type UserId,
  type WarOutcome,
} from '@empire/rules';
import { normal, shuffledIndexes, streams } from '../random';
import type { SimConfig, SimPlayer, SimState, WarStats } from './types';

const OUTCOMES: WarOutcome[] = ['attacker', 'defender', 'held', 'tribute', 'settled', 'withdrawn', 'cancelled'];

function emptyStats(): WarStats {
  return {
    declared: 0,
    responses: { accept: 0, raise: 0, redirect: 0, 'tribute-country': 0, 'tribute-tokens': 0, peace: 0 },
    replies: { accept: 0, withdraw: 0, refuse: 0 },
    outcomes: Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<WarOutcome, number>,
    games: 0,
    checkmates: 0,
    armageddons: 0,
    valueTaken: 0,
    valueRepelled: 0,
    valueTribute: 0,
    valueSettled: 0,
    fromReserves: 0,
    recalled: 0,
    fortified: 0,
    peaceOffered: 0,
    peaceAccepted: 0,
  };
}

/**
 * The campaign's rules: Objectives at the configured mission rules version and last round, the
 * scenario's draft mode and war settings (over a new campaign's answers), the variant's too.
 */
export function simRules(cfg: SimConfig): CampaignRules {
  const lastRound = cfg.variant?.lastRound !== undefined ? cfg.variant.lastRound : cfg.lastRound;
  return parseRules({
    maxPlayers: 8,
    draft: { mode: cfg.draftMode },
    war: { ...REVISED_WAR_RULES, pace: cfg.pace, ...cfg.war, ...cfg.variant?.war },
    victory: { mode: 'objectives', version: cfg.missionVersion, lastRound },
  });
}

/**
 * A fresh campaign in the lobby. Player ids are `p1`…`pN`; seats (the draft order) and ratings are
 * drawn at random, so ties the rules break by id never line up with a seat.
 */
export function createState(cfg: SimConfig, idx: DatasetIndex, seed: number): SimState {
  const rules = simRules(cfg);
  const rng = streams(seed);
  const ids = Array.from({ length: cfg.players }, (_, i) => `p${i + 1}`);
  const seats = shuffledIndexes(cfg.players, rng.setup);
  const elos = ids.map(() => {
    switch (cfg.elo.kind) {
      case 'equal':
        return 1500;
      case 'spread':
        return Math.round(1500 + cfg.elo.sd * normal(rng.setup));
      case 'star':
        return 1500;
    }
  });
  if (cfg.elo.kind === 'star') elos[Math.floor(rng.setup() * cfg.players)] = 1500 + cfg.elo.bonus;
  const players: SimPlayer[] = ids.map((id, i) => ({
    id,
    seat: seats[i]!,
    elo: elos[i]!,
    tokens: 0,
    reputation: 100,
    baseline: new Set(),
    options: [],
    secret: null,
    forced: false,
    revealedRound: null,
    eliminatedRound: null,
  }));
  const order = [...players].sort((a, b) => a.seat - b.seat).map((p) => p.id);
  return {
    cfg,
    rules,
    mr: missionRules(rules.victory.version),
    idx,
    rng,
    seed,
    players,
    byId: new Map(players.map((p) => [p.id, p])),
    order,
    round: 0,
    status: 'lobby',
    holdings: new Map(),
    wars: [],
    peaceOffers: [],
    accords: [],
    history: { wars: [], accords: [], roundStarts: [], awards: [] },
    seq: 0,
    publicSpecs: [],
    claims: new Map(),
    claimLog: [],
    awards: [],
    points: new Map(ids.map((id) => [id, 0])),
    winners: [],
    finishedRound: null,
    draftComplete: [],
    stats: emptyStats(),
    accordStats: { proposed: 0, signed: 0, renewed: 0, broken: 0, kept: 0 },
    tokensWasted: 0,
    timeline: [],
    firstToWinRound: null,
    endedByLimit: false,
    nextId: 1,
    log: [],
    actions: [],
  };
}

/** The next id in the campaign's history (the server's event ids). */
export const nextSeq = (s: SimState) => ++s.seq;
export const newId = (s: SimState, prefix: string) => `${prefix}${s.nextId++}`;

export function heldBy(s: SimState, userId: UserId): Set<TerritoryId> {
  const out = new Set<TerritoryId>();
  for (const [id, h] of s.holdings) if (h.ownerId === userId) out.add(id);
  return out;
}

export function valueOfPlayer(s: SimState, userId: UserId): number {
  let sum = 0;
  for (const [id, h] of s.holdings) if (h.ownerId === userId) sum += s.idx.byId.get(id)?.value ?? 0;
  return sum;
}

export const valueOfIds = (s: SimState, ids: Iterable<TerritoryId>) => {
  let sum = 0;
  for (const id of ids) sum += s.idx.byId.get(id)?.value ?? 0;
  return sum;
};

export const nameOf = (s: SimState, id: TerritoryId) => s.idx.byId.get(id)?.name ?? id;

/** A line in the campaign's readable log, when tracing. */
export function note(s: SimState, text: string | (() => string)): void {
  if (s.cfg.trace) s.log.push(`[r${s.round}] ${typeof text === 'function' ? text() : text}`);
}

/** The points needed to win, the variant's if it changes them. */
export const pointsToWin = (s: SimState) => s.cfg.variant?.points?.toWin ?? s.mr.points.toWin;
export const publicPoints = (s: SimState) => s.cfg.variant?.points?.public ?? s.mr.points.public;
export const secretPoints = (s: SimState) => s.cfg.variant?.points?.secret ?? s.mr.points.secret;
