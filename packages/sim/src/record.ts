/** A finished campaign as one JSON line: what the report aggregates. */
import { valueOfSet, type TerritoryId, type UserId } from '@empire/rules';
import { heldBy, pointsToWin } from './engine/state';
import { titleRules, titlesOf } from './engine/titles';
import type { SimState, WarStats } from './engine/types';

export interface PlayerRecord {
  id: UserId;
  seat: number;
  elo: number;
  drafted: number;
  draftedCount: number;
  /** The countries drafted. Unset in older records. */
  draftedIds?: TerritoryId[];
  final: number;
  finalCount: number;
  vp: number;
  won: boolean;
  options: { kind: string; rank: number; conquests: number }[];
  secret: string | null;
  forced: boolean;
  revealed: number | null;
  secretRound: number | null;
  eliminated: number | null;
  reputation: number;
  /** Points at the end of each round, from round 1. */
  vpAt: number[];
  /** Value at the end of each round, from round 1. */
  valueAt: number[];
  attackWins: number;
  attackLosses: number;
  defenceWins: number;
  defenceLosses: number;
  mates: number;
  /** Titles held at the end, and when round 1 began (what-ifs with titles only). */
  titles?: string[];
  titlesAtStart?: string[];
}

export interface AwardRecord {
  p: UserId;
  key: string;
  kind: string;
  scope: 'public' | 'secret';
  pts: number;
  round: number;
  /** The round its claim started, null for historic missions. */
  claim: number | null;
  /** Scored from a position already complete when the draft ended. */
  draft: boolean;
}

export interface CampaignRecord {
  v: 1;
  scenario: string;
  variant: string | null;
  players: number;
  pace: string;
  draftMode: string;
  mode: string;
  seed: number;
  /** The mission rules version played, and the season's last round (null: none). Unset in older records. */
  missionVersion?: number;
  lastRound?: number | null;
  publics: string[];
  rounds: number;
  finished: boolean;
  winRound: number | null;
  winners: UserId[];
  shared: boolean;
  stalled: boolean;
  firstToWinRound: number | null;
  /** Won on points when the last round ended, not by reaching the points to win. */
  byLimit: boolean;
  /** Who led (points, then value) at the end of round 5. */
  leaderAt5: UserId[] | null;
  seats: PlayerRecord[];
  awards: AwardRecord[];
  claims: { p: UserId; key: string; kind: string; start: number; end: number | null; status: string }[];
  draftComplete: { p: UserId; key: string; kind: string }[];
  wars: WarStats;
  /** Wars declared in each round, from round 1. */
  warsByRound: number[];
  /** Countries that changed hands in wars: round, country, from, to. Unset in older records. */
  transfers?: [number, TerritoryId, UserId, UserId][];
  /** The dataset version played. Unset in older records. */
  dataset?: string;
  accords: SimState['accordStats'];
  tokensWasted: number;
  /** The points to win, and how often a title changed hands after round 1 began (what-ifs with titles). */
  toWin?: number;
  titleMoves?: number;
  /** Points a title is worth. */
  titlePoints?: number;
  ms: number;
}

function leadersAtRound(s: SimState, round: number): UserId[] | null {
  const t = s.timeline[round];
  if (!t) return null;
  const rank = (id: UserId) => [t.points[id] ?? 0, t.value[id] ?? 0] as const;
  let best: readonly [number, number] | null = null;
  for (const p of s.players) {
    const r = rank(p.id);
    if (!best || r[0] > best[0] || (r[0] === best[0] && r[1] > best[1])) best = r;
  }
  return s.players.filter((p) => rank(p.id)[0] === best![0] && rank(p.id)[1] === best![1]).map((p) => p.id);
}

export function recordOf(s: SimState, ms: number): CampaignRecord {
  const rounds = s.round;
  const series = (f: (t: SimState['timeline'][number]) => number) =>
    Array.from({ length: rounds }, (_, i) => {
      const t = s.timeline[i + 1];
      return t ? f(t) : NaN;
    });
  const warsByRound = Array.from({ length: rounds }, () => 0);
  for (const w of s.wars) if (w.declaredRound >= 1) warsByRound[w.declaredRound - 1]!++;
  const draftKeys = new Set(s.draftComplete.map((d) => `${d.userId}\n${d.missionKey}`));
  const seats: PlayerRecord[] = s.players.map((p) => {
    const secretAward = s.awards.find((a) => a.userId === p.id && a.scope === 'secret');
    const resolved = s.wars.filter((w) => w.status === 'resolved' && (w.attackerId === p.id || w.defenderId === p.id));
    const count = (f: (w: (typeof resolved)[number]) => boolean) => resolved.filter(f).length;
    const held = heldBy(s, p.id);
    return {
      id: p.id,
      seat: p.seat,
      elo: p.elo,
      drafted: valueOfSet(s.idx, p.baseline),
      draftedCount: p.baseline.size,
      draftedIds: [...p.baseline].sort(),
      final: valueOfSet(s.idx, held),
      finalCount: held.size,
      vp: s.points.get(p.id) ?? 0,
      won: s.winners.includes(p.id),
      options: p.options.map((o) => ({ kind: o.spec.kind, rank: o.rank, conquests: o.estimate.conquests })),
      secret: p.secret?.kind ?? null,
      forced: p.forced,
      revealed: p.revealedRound,
      secretRound: secretAward?.round ?? null,
      eliminated: p.eliminatedRound,
      reputation: p.reputation,
      vpAt: series((t) => t.points[p.id] ?? 0),
      valueAt: series((t) => t.value[p.id] ?? 0),
      attackWins: count((w) => w.attackerId === p.id && w.outcome === 'attacker'),
      attackLosses: count((w) => w.attackerId === p.id && w.outcome === 'defender'),
      defenceWins: count((w) => w.defenderId === p.id && w.outcome === 'defender'),
      defenceLosses: count((w) => w.defenderId === p.id && w.outcome === 'attacker'),
      ...(titleRules(s) ? { titles: titlesOf(s, p.id), titlesAtStart: s.titlesAtStart?.[p.id] ?? [] } : {}),
      mates: count(
        (w) =>
          w.endReason === 'checkmate' &&
          ((w.outcome === 'attacker' && w.attackerId === p.id) || (w.outcome === 'defender' && w.defenderId === p.id)),
      ),
    };
  });
  return {
    v: 1,
    scenario: s.cfg.scenario,
    variant: s.cfg.variant?.name ?? null,
    players: s.cfg.players,
    pace: s.cfg.pace,
    draftMode: s.cfg.draftMode,
    mode: s.cfg.mode,
    seed: s.seed,
    missionVersion: s.rules.victory.version,
    lastRound: s.rules.victory.lastRound,
    publics: s.publicSpecs.map((spec) => spec.kind),
    rounds,
    finished: s.status === 'finished',
    winRound: s.finishedRound,
    winners: s.winners,
    shared: s.winners.length > 1,
    stalled: s.cfg.mode === 'normal' && s.status !== 'finished',
    firstToWinRound: s.firstToWinRound,
    byLimit: s.endedByLimit,
    leaderAt5: leadersAtRound(s, 5),
    seats,
    awards: s.awards.map((a) => ({
      p: a.userId,
      key: a.missionKey,
      kind: a.kind,
      scope: a.scope,
      pts: a.points,
      round: a.round,
      claim: a.claimStartedRound,
      draft: a.claimStartedRound === 1 && draftKeys.has(`${a.userId}\n${a.missionKey}`),
    })),
    claims: s.claimLog.map((c) => ({
      p: c.userId,
      key: c.missionKey,
      kind: c.kind,
      start: c.startedRound,
      end: c.endedRound,
      status: c.status,
    })),
    draftComplete: s.draftComplete.map((d) => ({ p: d.userId, key: d.missionKey, kind: d.kind })),
    wars: s.stats,
    warsByRound,
    transfers: s.wars.flatMap((w) =>
      w.transfers.map((t): [number, TerritoryId, UserId, UserId] => [
        w.resolvedRound ?? w.declaredRound,
        t.territoryId,
        t.from,
        t.to,
      ]),
    ),
    dataset: s.idx.dataset.version,
    accords: s.accordStats,
    tokensWasted: s.tokensWasted,
    toWin: pointsToWin(s),
    ...(titleRules(s) ? { titleMoves: s.titleMoves, titlePoints: titleRules(s)!.points } : {}),
    ms: Math.round(ms),
  };
}
