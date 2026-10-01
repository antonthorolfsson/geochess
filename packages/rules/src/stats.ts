/**
 * Empire statistics, derived from a campaign's history: territory over time, how each country was
 * acquired, the war record, accords kept and broken, and a chess profile. The server gathers the
 * rows on request and the stats page draws the results.
 */
import { winnerOf, type Color, type GameEndReason, type GameResult } from './chess';
import type { TerritoryId } from './dataset';
import type { AccordRecord, AccordStatus } from './diplomacy';
import type { UserId } from './draft';
import type { DatasetIndex } from './graph';
import { openingFamily, type Opening } from './openings';
import type {
  AccordTally,
  Acquisition,
  CampaignStats,
  ChessProfile,
  CountryChange,
  GameLine,
  GameStatus,
  HistoryPoint,
  HistoryView,
  OpeningStat,
  PlayerResult,
  ResultTally,
  WarRecord,
  WarStatus,
  WarTally,
} from './protocol';
import type { PeaceTerms, Transfer, WarOutcome } from './war';

/** A war that ended, from its `war.resolved` event and the war it settled. */
export interface Resolution {
  warId: string;
  round: number;
  attackerId: UserId;
  defenderId: UserId;
  outcome: WarOutcome;
  transfers: readonly Transfer[];
  /** Tokens paid as tribute. */
  tokens: number;
  /** The terms of a war the two settled. */
  terms?: PeaceTerms | null;
}

/** How a resolution moved countries, for the record: in a war, as tribute, or by peace terms. */
const viaOf = (outcome: WarOutcome): CountryChange['via'] =>
  outcome === 'tribute' ? 'tribute' : outcome === 'settled' ? 'peace' : 'war';

/** A war as the record counts it. */
export interface WarFacts {
  attackerId: UserId;
  defenderId: UserId;
  status: WarStatus;
  outcome: WarOutcome | null;
}

/** A game as the chess profile counts it. */
export interface GameFacts {
  id: string;
  warId: string;
  whiteId: UserId;
  blackId: UserId;
  armageddon: boolean;
  status: GameStatus;
  result: GameResult | null;
  reason: GameEndReason | null;
  /** Half-moves played. */
  plies: number;
  finishedAt: string | null;
  opening: Opening | null;
}

export interface StatsInput {
  idx: DatasetIndex;
  memberIds: readonly UserId[];
  /** Today's owner of every claimed country. */
  holdings: ReadonlyMap<TerritoryId, UserId>;
  /** Zero-based draft pick numbers, where known. */
  picks: ReadonlyMap<TerritoryId, number>;
  /** The current round: 0 until the draft ends. */
  round: number;
  /** Oldest first. */
  resolutions: readonly Resolution[];
  wars: readonly WarFacts[];
  accords: readonly Pick<AccordRecord, 'proposerId' | 'recipientId' | 'status' | 'brokenBy'>[];
  /** Oldest first. */
  games: readonly GameFacts[];
}

export function campaignStats(input: StatsInput): CampaignStats {
  return {
    history: empireHistory(input.idx, input.memberIds, input.holdings, input.round, input.resolutions),
    empires: input.memberIds.map((userId) => ({
      userId,
      wars: warRecord(userId, input.wars, input.resolutions),
      accords: accordTally(userId, input.accords),
      chess: chessProfile(userId, input.games),
    })),
    acquisitions: acquisitions(input.holdings, input.picks, input.resolutions),
  };
}

// ---------------------------------------------------------------------------------------------
// Territory over time

/**
 * Each player's game value and country count at the end of every round, from round 0 (the end of
 * the draft) to `round`, which is now. Worked backwards from today's holdings by undoing each
 * war's transfers, so the last point always matches the map.
 */
export function empireHistory(
  idx: DatasetIndex,
  memberIds: readonly UserId[],
  holdings: ReadonlyMap<TerritoryId, UserId>,
  round: number,
  resolutions: readonly Resolution[],
): HistoryView {
  const owners = new Map(holdings);
  const snapshot = (at: number): HistoryPoint => {
    const value = new Map(memberIds.map((id) => [id, 0]));
    const countries = new Map(value);
    for (const [territoryId, ownerId] of owners) {
      const territory = idx.byId.get(territoryId);
      if (!territory || !value.has(ownerId)) continue;
      value.set(ownerId, value.get(ownerId)! + territory.value);
      countries.set(ownerId, countries.get(ownerId)! + 1);
    }
    return { round: at, value: Object.fromEntries(value), countries: Object.fromEntries(countries) };
  };
  const points: HistoryPoint[] = [];
  const undo = [...resolutions].reverse();
  for (let r = round; r >= 0; r--) {
    points.push(snapshot(r));
    for (const resolution of undo) {
      if (resolution.round !== r) continue;
      for (const t of [...resolution.transfers].reverse()) owners.set(t.territoryId, t.from);
    }
  }
  return {
    points: points.reverse(),
    wars: resolutions
      .filter((r) => r.transfers.length > 0)
      .map((r) => ({
        warId: r.warId,
        round: r.round,
        attackerId: r.attackerId,
        defenderId: r.defenderId,
        outcome: r.outcome,
        transfers: [...r.transfers],
      })),
  };
}

/** How every held country came to its owner: its last war, tribute or peace, or else the draft. */
export function acquisitions(
  holdings: ReadonlyMap<TerritoryId, UserId>,
  picks: ReadonlyMap<TerritoryId, number>,
  resolutions: readonly Resolution[],
): Record<TerritoryId, Acquisition> {
  const last = new Map<TerritoryId, { resolution: Resolution; transfer: Transfer }>();
  for (const resolution of resolutions) {
    for (const transfer of resolution.transfers) last.set(transfer.territoryId, { resolution, transfer });
  }
  const out: Record<TerritoryId, Acquisition> = {};
  for (const [territoryId, ownerId] of holdings) {
    const change = last.get(territoryId);
    out[territoryId] =
      change && change.transfer.to === ownerId
        ? {
            via: viaOf(change.resolution.outcome),
            warId: change.resolution.warId,
            round: change.resolution.round,
            from: change.transfer.from,
          }
        : { via: 'draft', pick: picks.get(territoryId) ?? null };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Wars and accords

const emptyWarTally = (): WarTally => ({
  won: 0,
  lost: 0,
  drawn: 0,
  tribute: 0,
  settled: 0,
  withdrawn: 0,
  cancelled: 0,
  underway: 0,
});

/** What each outcome counts as for the attacker and for the defender. */
const OUTCOME_COUNTS: Record<WarOutcome, readonly [attacker: keyof WarTally, defender: keyof WarTally]> = {
  attacker: ['won', 'lost'],
  defender: ['lost', 'won'],
  held: ['drawn', 'drawn'],
  tribute: ['tribute', 'tribute'],
  settled: ['settled', 'settled'],
  withdrawn: ['withdrawn', 'withdrawn'],
  cancelled: ['cancelled', 'cancelled'],
};

export function warRecord(userId: UserId, wars: readonly WarFacts[], resolutions: readonly Resolution[]): WarRecord {
  const attacking = emptyWarTally();
  const defending = emptyWarTally();
  for (const war of wars) {
    const side = war.attackerId === userId ? 0 : war.defenderId === userId ? 1 : null;
    if (side === null) continue;
    const tally = side === 0 ? attacking : defending;
    if (war.status !== 'resolved' || !war.outcome) tally.underway++;
    else tally[OUTCOME_COUNTS[war.outcome][side]]++;
  }

  let tokensTaken = 0;
  let tokensPaid = 0;
  const gained: CountryChange[] = [];
  const lost: CountryChange[] = [];
  for (const r of resolutions) {
    if (r.outcome === 'tribute') {
      if (r.attackerId === userId) tokensTaken += r.tokens;
      if (r.defenderId === userId) tokensPaid += r.tokens;
    }
    if (r.outcome === 'settled' && r.terms) {
      const [taken, paid] =
        r.attackerId === userId
          ? [r.terms.tokensToAttacker, r.terms.tokensToDefender]
          : r.defenderId === userId
            ? [r.terms.tokensToDefender, r.terms.tokensToAttacker]
            : [0, 0];
      tokensTaken += taken;
      tokensPaid += paid;
    }
    const via = viaOf(r.outcome);
    for (const t of r.transfers) {
      const change = { territoryId: t.territoryId, warId: r.warId, round: r.round, via } as const;
      if (t.to === userId) gained.push({ ...change, otherId: t.from });
      if (t.from === userId) lost.push({ ...change, otherId: t.to });
    }
  }
  return { attacking, defending, tokensTaken, tokensPaid, gained, lost };
}

/** Statuses of accords that were signed, and so are public. */
const SIGNED: ReadonlySet<AccordStatus> = new Set(['active', 'kept', 'broken', 'renewed']);

export function accordTally(
  userId: UserId,
  accords: readonly Pick<AccordRecord, 'proposerId' | 'recipientId' | 'status' | 'brokenBy'>[],
): AccordTally {
  const tally: AccordTally = { signed: 0, kept: 0, broken: 0, betrayed: 0, inForce: 0 };
  for (const a of accords) {
    if (a.proposerId !== userId && a.recipientId !== userId) continue;
    // Proposals that came to nothing are private to the two players.
    if (!SIGNED.has(a.status)) continue;
    tally.signed++;
    if (a.status === 'active') tally.inForce++;
    else if (a.status === 'kept') tally.kept++;
    else if (a.status === 'broken') tally[a.brokenBy === userId ? 'broken' : 'betrayed']++;
  }
  return tally;
}

// ---------------------------------------------------------------------------------------------
// Chess

/** A finished game's result for the player who had `color`. */
export function resultFor(result: GameResult, color: Color): PlayerResult {
  const winner = winnerOf(result);
  return winner === null ? 'drawn' : winner === color ? 'won' : 'lost';
}

/** Moves (as counted in a score sheet) in a game of `plies` half-moves. */
export const movesOf = (plies: number) => Math.ceil(plies / 2);

const emptyResults = (): ResultTally => ({ won: 0, drawn: 0, lost: 0 });

export function chessProfile(userId: UserId, games: readonly GameFacts[]): ChessProfile {
  const asWhite = emptyResults();
  const asBlack = emptyResults();
  const endings: ChessProfile['endings'] = {};
  const openings = new Map<string, OpeningStat>();
  const lines: GameLine[] = [];
  let underway = 0;
  let totalMoves = 0;
  let onlineGames = 0;
  for (const g of games) {
    const color: Color | null = g.whiteId === userId ? 'white' : g.blackId === userId ? 'black' : null;
    if (!color) continue;
    if (g.status === 'playing') underway++;
    if (g.status !== 'finished' || !g.result) continue;
    const result = resultFor(g.result, color);
    (color === 'white' ? asWhite : asBlack)[result]++;
    if (g.reason) (endings[g.reason] ??= emptyResults())[result]++;
    // A game played over the board has no moves here (or only its first few), so neither a length nor an opening.
    const online = g.reason !== 'over-the-board';
    if (online) {
      totalMoves += movesOf(g.plies);
      onlineGames++;
    }
    if (g.opening && online) {
      const family = openingFamily(g.opening.name);
      const key = `${color} ${family}`;
      const stat = openings.get(key) ?? { family, color, games: 0, ...emptyResults() };
      stat.games++;
      stat[result]++;
      openings.set(key, stat);
    }
    lines.push({
      gameId: g.id,
      warId: g.warId,
      opponentId: color === 'white' ? g.blackId : g.whiteId,
      color,
      armageddon: g.armageddon,
      result,
      reason: g.reason,
      moves: movesOf(g.plies),
      opening: g.opening,
      finishedAt: g.finishedAt,
    });
  }
  return {
    played: lines.length,
    underway,
    asWhite,
    asBlack,
    endings,
    averageMoves: onlineGames > 0 ? totalMoves / onlineGames : null,
    openings: [...openings.values()].sort(
      (a, b) => b.games - a.games || b.won - a.won || a.family.localeCompare(b.family),
    ),
    // Most recent first; games that finished together keep their order, reversed.
    games: lines.reverse().sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? '')),
  };
}
