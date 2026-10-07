import {
  SECRET_MISSION_KEY,
  type CampaignStats,
  type DatasetIndex,
  type MemberView,
  type VictoryResultView,
} from '@empire/rules';
import { chessResults, leaderOf, resultsPlayed, score, warResults, type Leader } from './compare';
import { formatDay, ordinal } from './format';
import { tiebreakClause } from './victory';

/**
 * The end of a campaign: the finale that plays for each player (victory or defeat), and the
 * results page that follows it, with the final standings, honors and the campaign's totals.
 */

export type ResultStanding = VictoryResultView['standings'][number];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pointsText = (n: number) => plural(n, 'victory point');

/** Names in a sentence: "Ann", "Ann and Bo", "Ann, Bo and Cy". */
export function listNames(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** When a finished campaign goes for everyone, said on its results. */
export const deletionText = (deleteAt: string) =>
  `The campaign and its results are deleted for everyone on ${formatDay(deleteAt)}.`;

// ---------------------------------------------------------------------------------------------
// Places and points

/**
 * Each player's place, 1 for the winners. Players level share a place: on points, and when the
 * season ran to its last round, on the tiebreak that decided it too.
 */
export function placesOf(result: VictoryResultView): Map<string, number> {
  const winners = new Set(result.winners);
  const sameMeasures = (a: ResultStanding, b: ResultStanding) =>
    (a.measures ?? []).length === (b.measures ?? []).length && (a.measures ?? []).every((m, i) => m === b.measures![i]);
  const level = (a: ResultStanding, b: ResultStanding) =>
    a.points === b.points && (!result.seasonEnd || sameMeasures(a, b));
  // The standings list the winners first, then the rest as they finished.
  const places = new Map<string, number>();
  result.standings.forEach((s, i) => {
    const before = result.standings[i - 1];
    const place = winners.has(s.userId) ? 1 : before && level(s, before) ? places.get(before.userId)! : i + 1;
    places.set(s.userId, place);
  });
  return places;
}

/** A place in words: "1st", "joint 2nd". */
export function placeText(result: VictoryResultView, places: ReadonlyMap<string, number>, userId: string): string {
  const place = places.get(userId);
  if (place === undefined) return '';
  const shared = [...places.values()].filter((p) => p === place).length > 1;
  return `${shared ? 'joint ' : ''}${ordinal(place)}`;
}

/** Where a player's points came from: the public missions, their secret mission, and titles they held at the end. */
export interface PointsBreakdown {
  public: number;
  secret: number;
  titles: number;
}

export function breakdownOf(standing: ResultStanding, titlePoints: number): PointsBreakdown {
  let pub = 0;
  let secret = 0;
  for (const a of standing.awards) {
    if (a.missionKey === SECRET_MISSION_KEY) secret += a.points;
    else pub += a.points;
  }
  return { public: pub, secret, titles: (standing.titles?.length ?? 0) * titlePoints };
}

// ---------------------------------------------------------------------------------------------
// The finale

/** What the ending says to one player. */
export interface FinaleText {
  outcome: 'victory' | 'defeat';
  /** The stamp: "Victory" or "Defeat". */
  stamp: string;
  /** Over it: "Campaign over · round 12", "Shared victory · round 25, the last". */
  label: string;
  /** Who it's about: the viewer and anyone they share it with, or the winners. */
  subjects: string[];
  /** Who won: "You won.", "Ann and Bo share the victory." */
  who: string;
  /** How it was won. */
  line: string;
  /** Where the viewer finished, or who they share it with. */
  place: string | null;
  /** All of it in a few sentences, for screen readers. */
  summary: string;
}

export function finaleText(
  result: VictoryResultView,
  viewerId: string,
  nameOf: (userId: string) => string,
): FinaleText {
  const won = result.winners.includes(viewerId);
  const shared = result.winners.length > 1;
  const top = result.standings.find((s) => result.winners.includes(s.userId))?.points ?? 0;
  const mine = result.standings.find((s) => s.userId === viewerId);
  const round = `round ${result.round}${result.seasonEnd && !result.endedEarly ? ', the last' : ''}`;
  const label = `${won && shared ? 'Shared victory' : 'Campaign over'} · ${round}`;
  const others = result.winners.filter((id) => id !== viewerId).map(nameOf);
  const winners = listNames(result.winners.map(nameOf));

  let line: string;
  if (result.endedEarly) {
    line = `The host ended the campaign in round ${result.round}, and the most points won${tiebreakClause(result)}.`;
  } else if (result.seasonEnd) {
    line = `Round ${result.round} was the last, and the most points won${tiebreakClause(result)}.`;
  } else if (won) {
    line = `${shared ? `You and ${listNames(others)}` : 'You'} reached ${pointsText(top)} in round ${result.round}.`;
  } else {
    line = `${winners} reached ${pointsText(top)} in round ${result.round}.`;
  }

  // The winners' points are shown beside them: what's left to say is who shares it, or where the
  // viewer finished.
  let place: string | null = null;
  if (won && shared) place = result.seasonEnd ? `You share it with ${listNames(others)}.` : null;
  else if (!won && mine) {
    place = `You finished ${placeText(result, placesOf(result), viewerId)} with ${pointsText(mine.points)}.`;
  }

  const stamp = won ? 'Victory' : 'Defeat';
  const who = won
    ? shared
      ? `You and ${listNames(others)} share the victory.`
      : 'You won.'
    : `${winners} ${shared ? 'share the victory' : 'won'}.`;
  return {
    outcome: won ? 'victory' : 'defeat',
    stamp,
    label,
    subjects: won ? [viewerId, ...result.winners.filter((id) => id !== viewerId)] : [...result.winners],
    who,
    line,
    place,
    summary: [`${stamp}.`, who, line, won && shared ? null : place].filter(Boolean).join(' '),
  };
}

/** The campaign's ending has played for this player in this browser. */
const seenInMemory = new Set<string>();
const finaleKey = (campaignId: string, userId: string) => `geochess:finale:${campaignId}:${userId}`;

export function finaleSeen(campaignId: string, userId: string): boolean {
  const key = finaleKey(campaignId, userId);
  if (seenInMemory.has(key)) return true;
  try {
    return globalThis.localStorage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function markFinaleSeen(campaignId: string, userId: string): void {
  const key = finaleKey(campaignId, userId);
  seenInMemory.add(key);
  try {
    globalThis.localStorage?.setItem(key, '1');
  } catch {
    // Private windows and blocked storage: it plays again next visit.
  }
}

// ---------------------------------------------------------------------------------------------
// Honors

export type HonorKey =
  | 'conqueror'
  | 'warlord'
  | 'bulwark'
  | 'spoils'
  | 'grandmaster'
  | 'swift'
  | 'marathon'
  | 'warmonger'
  | 'diplomat'
  | 'oathbreaker';

/** A superlative from the campaign's records, and who earned it (several when they're level). */
export interface Honor {
  key: HonorKey;
  name: string;
  /** What it's for: "Most countries taken". */
  what: string;
  holders: string[];
  /** Their figure: "7 countries taken", "Mate in 9 against Bo". */
  figure: string;
}

export interface HonorsInput {
  stats: CampaignStats;
  idx: DatasetIndex;
  /** The players, for their reputation. */
  members: readonly MemberView[];
  nameOf(userId: string): string;
  countryName(territoryId: string): string;
}

const HONORS: Record<HonorKey, { name: string; what: string }> = {
  conqueror: { name: 'Conqueror', what: 'Most countries taken' },
  warlord: { name: 'Warlord', what: 'Most wars won' },
  bulwark: { name: 'Bulwark', what: 'Most attacks repelled' },
  spoils: { name: 'Spoils of War', what: 'Most value taken in one war' },
  grandmaster: { name: 'Grandmaster', what: 'Best chess score' },
  swift: { name: 'Swift Strike', what: 'Fastest checkmate' },
  marathon: { name: 'Marathon', what: 'Longest game' },
  warmonger: { name: 'Warmonger', what: 'Most wars declared' },
  diplomat: { name: 'Diplomat', what: 'Best reputation' },
  oathbreaker: { name: 'Oathbreaker', what: 'Most accords broken' },
};

/**
 * The campaign's honors, those anyone earned, in a fixed order: territory and wars first, then
 * chess, then diplomacy. Only current players count.
 */
export function honorsOf({ stats, idx, members, nameOf, countryName }: HonorsInput): Honor[] {
  const ids = new Set(members.map((m) => m.userId));
  const empires = stats.empires.filter((e) => ids.has(e.userId));
  const valueOf = (territoryId: string) => idx.byId.get(territoryId)?.value ?? 0;
  const honors: Honor[] = [];
  const add = (key: HonorKey, leader: Leader | null, figure: (amount: number) => string) => {
    if (leader) honors.push({ key, ...HONORS[key], holders: leader.userIds, figure: figure(leader.amount) });
  };

  add(
    'conqueror',
    leaderOf(
      empires.map((e) => ({
        userId: e.userId,
        amount: e.wars.gained.length,
        then: e.wars.gained.reduce((sum, c) => sum + valueOf(c.territoryId), 0),
      })),
    ),
    (n) => `${plural(n, 'country', 'countries')} taken`,
  );
  add(
    'warlord',
    leaderOf(empires.map((e) => ({ userId: e.userId, amount: warResults(e.wars).won }))),
    (n) => `${plural(n, 'war')} won`,
  );
  add(
    'bulwark',
    leaderOf(empires.map((e) => ({ userId: e.userId, amount: e.wars.defending.won + e.wars.defending.drawn }))),
    (n) => `${plural(n, 'attack')} repelled`,
  );

  // The biggest haul: everything one war handed one player, the earliest of the largest.
  let haul: { userId: string; ids: string[]; value: number } | null = null;
  for (const war of stats.history.wars) {
    const byGainer = new Map<string, string[]>();
    for (const t of war.transfers) byGainer.set(t.to, [...(byGainer.get(t.to) ?? []), t.territoryId]);
    for (const [userId, taken] of byGainer) {
      const value = taken.reduce((sum, id) => sum + valueOf(id), 0);
      if (ids.has(userId) && value > (haul?.value ?? 0)) haul = { userId, ids: taken, value };
    }
  }
  if (haul) {
    const names = haul.ids.map(countryName);
    const what = names.length > 2 ? `${names[0]} and ${names.length - 1} more` : listNames(names);
    honors.push({ key: 'spoils', ...HONORS.spoils, holders: [haul.userId], figure: `${what}, worth ${haul.value}` });
  }

  // Chess: a score needs two games or more; level scores go to whoever played more.
  add(
    'grandmaster',
    leaderOf(
      empires.map((e) => {
        const results = chessResults(e.chess);
        const played = resultsPlayed(results);
        return { userId: e.userId, amount: played >= 2 ? score(results) : null, then: played };
      }),
      { zero: true },
    ),
    (n) => `${Math.round(n * 100)}% score`,
  );
  // Games played on the board here, by their moves: the quickest mate (a resignation could be a
  // war given up at once), and the longest game of all.
  const online = empires.flatMap((e) =>
    e.chess.games.filter((g) => g.moves > 0 && g.reason !== 'over-the-board').map((g) => ({ ...g, userId: e.userId })),
  );
  const swift = online
    .filter((g) => g.result === 'won' && g.reason === 'checkmate')
    .sort((a, b) => a.moves - b.moves || (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''))[0];
  if (swift) {
    const against = ids.has(swift.opponentId) ? ` against ${nameOf(swift.opponentId)}` : '';
    honors.push({ key: 'swift', ...HONORS.swift, holders: [swift.userId], figure: `Mate in ${swift.moves}${against}` });
  }
  const marathon = [...online].sort(
    (a, b) => b.moves - a.moves || (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''),
  )[0];
  if (marathon) {
    const holders = [marathon.userId, marathon.opponentId].filter((id) => ids.has(id));
    honors.push({ key: 'marathon', ...HONORS.marathon, holders, figure: `${plural(marathon.moves, 'move')}` });
  }

  add(
    'warmonger',
    leaderOf(
      empires.map((e) => ({
        userId: e.userId,
        amount: Object.values(e.wars.attacking).reduce((sum, n) => sum + n, 0),
      })),
    ),
    (n) => `${plural(n, 'war')} declared`,
  );
  // Reputation only singles someone out when it differs.
  const players = members.filter((m) => ids.has(m.userId));
  if (new Set(players.map((m) => m.reputation)).size > 1) {
    add(
      'diplomat',
      leaderOf(
        players.map((m) => ({ userId: m.userId, amount: m.reputation })),
        { zero: true },
      ),
      (n) => `Reputation ${n}`,
    );
  }
  add(
    'oathbreaker',
    leaderOf(empires.map((e) => ({ userId: e.userId, amount: e.accords.broken }))),
    (n) => `${plural(n, 'accord')} broken`,
  );
  return honors;
}

// ---------------------------------------------------------------------------------------------
// The campaign in numbers

export interface CampaignTotals {
  rounds: number;
  /** Wars declared, however they ended. */
  wars: number;
  /** Countries that changed hands, in wars, as tribute or by peace terms. */
  countries: number;
  /** Games finished. */
  battles: number;
  checkmates: number;
  /** Moves played in games finished online. */
  moves: number;
  accordsSigned: number;
  accordsBroken: number;
}

export function campaignTotals(stats: CampaignStats, rounds: number): CampaignTotals {
  // Every game is in both players' profiles, and every accord in both partners' tallies.
  const games = new Map(stats.empires.flatMap((e) => e.chess.games.map((g) => [g.gameId, g] as const)));
  const all = [...games.values()];
  return {
    rounds,
    wars: stats.empires.reduce((sum, e) => sum + Object.values(e.wars.attacking).reduce((a, n) => a + n, 0), 0),
    countries: stats.history.wars.reduce((sum, w) => sum + w.transfers.length, 0),
    battles: all.length,
    checkmates: all.filter((g) => g.reason === 'checkmate').length,
    moves: all.filter((g) => g.reason !== 'over-the-board').reduce((sum, g) => sum + g.moves, 0),
    accordsSigned: Math.round(stats.empires.reduce((sum, e) => sum + e.accords.signed, 0) / 2),
    accordsBroken: stats.empires.reduce((sum, e) => sum + e.accords.broken, 0),
  };
}
