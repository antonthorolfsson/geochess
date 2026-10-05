/** Further tables for the balance report: the draft's share, early leads, the war economy per player. */
import { MISSIONS, type MissionKind } from '@empire/rules';
import type { CampaignRecord } from '../record';
import { band, groupBy } from './aggregate';
import { mean, num, pct, quantile, table, wilson } from './stats';

type Rec = CampaignRecord;
const name = (kind: string) => MISSIONS[kind as MissionKind]?.name ?? kind;

/** Public missions already complete when the draft ends, by player count. */
export function draftComplete(recs: readonly Rec[]): string {
  const inPlay = recs.flatMap((r) => r.publics.map((kind) => ({ r, kind })));
  const rows = [...groupBy(inPlay, (x) => `${x.kind}|${String(x.r.players).padStart(2)}`)].map(([k, items]) => {
    const [kind, players] = k.split('|');
    const anyone = items.filter(({ r }) => r.draftComplete.some((d) => d.kind === kind)).length;
    const players_ = items.reduce((n, { r }) => n + r.players, 0);
    const holders = items.reduce((n, { r }) => n + r.draftComplete.filter((d) => d.kind === kind).length, 0);
    return [name(kind!), players!.trim(), items.length, pct(anyone / items.length), pct(holders / players_)];
  });
  return table(
    ['Mission', 'Players', 'Campaigns', 'Someone has it at the draft', 'Players who have it at the draft'],
    rows,
  );
}

/** Campaigns where someone banks 4 or more points from drafted positions by round 3. */
export function earlyDraftPoints(recs: readonly Rec[]): string {
  const rows = [...groupBy(recs, (r) => `${r.pace}|${String(r.players).padStart(2)}`)].map(([k, rs]) => {
    const [pace, players] = k.split('|');
    const early = rs.filter((r) =>
      r.seats.some(
        (p) => r.awards.filter((a) => a.p === p.id && a.draft && a.round <= 3).reduce((n, a) => n + a.pts, 0) >= 4,
      ),
    ).length;
    const any = rs.filter((r) => r.awards.some((a) => a.draft)).length;
    return [pace!, players!.trim(), rs.length, pct(any / rs.length), pct(early / rs.length)];
  });
  return table(
    [
      'Pace',
      'Players',
      'Campaigns',
      'Someone scores from drafted positions',
      'Someone has 4+ points from the draft by round 3',
    ],
    rows,
  );
}

/** What a declaration is worth to the attacker, in country value, and how often players lose everything. */
export function attackerValue(recs: readonly Rec[]): string {
  const rows = [...groupBy(recs, (r) => `${r.pace}|${String(r.players).padStart(2)}`)].map(([k, rs]) => {
    const [pace, players] = k.split('|');
    const sum = (f: (r: Rec) => number) => rs.reduce((n, r) => n + f(r), 0);
    const declared = sum((r) => r.wars.declared);
    const gained = sum((r) => r.wars.valueTaken + r.wars.valueTribute) - sum((r) => r.wars.valueRepelled);
    const eliminated = sum((r) => r.seats.filter((p) => p.eliminated !== null).length);
    const seatsN = sum((r) => r.players);
    return [pace!, players!.trim(), num(gained / declared, 2), pct(eliminated / seatsN, 1)];
  });
  return table(['Pace', 'Players', 'Net value to the attacker per declaration', 'Players eliminated'], rows);
}

/** Each secret kind's holder win rate, pooled over player counts (forced assignment). */
export function secretPooled(recs: readonly Rec[]): string {
  const holders = recs.flatMap((r) => r.seats.filter((p) => p.forced && p.secret).map((p) => ({ r, p })));
  const rows = [...groupBy(holders, (x) => x.p.secret!)]
    .map(([kind, items]) => {
      const wins = items.reduce((w, { r, p }) => w + (p.won ? 1 / r.winners.length : 0), 0);
      const fair = mean(items.map(({ r }) => 1 / r.players));
      const rate = wilson(Math.round(wins), items.length);
      const done = items.filter(({ p }) => p.secretRound !== null).length;
      const byBand = [...groupBy(items, (x) => band(x.r.players))]
        .map(([b, xs]) => `${b}: ${pct(xs.filter(({ p }) => p.secretRound !== null).length / xs.length)}`)
        .join(', ');
      return {
        kind,
        n: items.length,
        done: done / items.length,
        lift: rate.p / fair,
        lo: rate.lo / fair,
        hi: rate.hi / fair,
        byBand,
      };
    })
    .sort((a, b) => b.lift - a.lift);
  return table(
    ['Secret mission', 'Holders', 'Completed', 'Completed by player count', 'Win rate ÷ fair share (95% CI)'],
    rows.map((r) => [name(r.kind), r.n, pct(r.done), r.byBand, `${num(r.lift, 2)} (${num(r.lo, 2)}–${num(r.hi, 2)})`]),
  );
}

/** Win rate by rating rank, strongest first (for the rating-spread scenarios). */
export function skill(recs: readonly Rec[]): string {
  const spread = recs.filter((r) => new Set(r.seats.map((p) => p.elo)).size > 1);
  const rows = [...groupBy(spread, (r) => `${r.scenario}|${String(r.players).padStart(2)}`)].map(([k, rs]) => {
    const [scenario, players] = k.split('|');
    const n = Number(players);
    const wins = Array.from({ length: n }, () => 0);
    for (const r of rs) {
      const ranked = [...r.seats].sort((a, b) => b.elo - a.elo);
      ranked.forEach((p, i) => {
        if (p.won) wins[i]! += 1 / r.winners.length;
      });
    }
    return [scenario!, n, rs.length, wins.map((w) => pct(w / rs.length)).join(' · '), pct(1 / n)];
  });
  return table(['Scenario', 'Players', 'Campaigns', 'Win rate by rating, strongest first', 'Fair share'], rows);
}

/** Points a winner holds in titles at the end (what-ifs with titles), from their record. */
function titlePointsAtEnd(r: Rec, p: Rec['seats'][number]): number {
  const per = r.titlePoints ?? Number(r.variant?.match(/^titles-(\d)/)?.[1] ?? 0);
  return (p.titles?.length ?? 0) * per;
}

/**
 * How campaigns end with titles (points for leading the table on a real-world figure) against
 * without: game length, how they're won, what winners hold, and whether the draft's biggest
 * empire, or the one starting with the most titles, runs away with it.
 */
export function titles(recs: readonly Rec[]): string {
  const rows = [...groupBy(recs, (r) => `${r.scenario}|${String(r.players).padStart(2)}`)].map(([k, rs]) => {
    const [scenario, players] = k.split('|');
    const won = rs.filter((r) => r.finished);
    const rounds = rs.map((r) => (r.finished && r.winRound !== null ? r.winRound : Infinity));
    const winners = won.flatMap((r) => r.seats.filter((p) => p.won).map((p) => ({ r, p })));
    const shareOf = (pick: (r: Rec) => Rec['seats'][number][]) =>
      rs.reduce((n, r) => {
        const picked = pick(r);
        return n + picked.filter((p) => p.won).length / Math.max(1, picked.length);
      }, 0) / rs.length;
    const biggest = (r: Rec) => {
      const top = Math.max(...r.seats.map((p) => p.drafted));
      return r.seats.filter((p) => p.drafted === top);
    };
    const mostTitles = (r: Rec) => {
      const top = Math.max(...r.seats.map((p) => p.titlesAtStart?.length ?? 0));
      return top === 0 ? [] : r.seats.filter((p) => (p.titlesAtStart?.length ?? 0) === top);
    };
    const withTitles = rs.some((r) => r.titleMoves !== undefined);
    return [
      scenario!,
      players!.trim(),
      rs.length,
      rs[0]?.toWin ?? '',
      num(quantile(rounds, 0.5), 0),
      pct(won.filter((r) => !r.byLimit).length / rs.length),
      pct(rs.filter((r) => r.byLimit).length / rs.length),
      num(mean(winners.map(({ r, p }) => p.vp - titlePointsAtEnd(r, p))), 1),
      withTitles ? num(mean(winners.map(({ r, p }) => titlePointsAtEnd(r, p))), 1) : '–',
      withTitles ? num(mean(rs.map((r) => Math.max(...r.seats.map((p) => p.titlesAtStart?.length ?? 0)))), 1) : '–',
      withTitles ? pct(shareOf(mostTitles)) : '–',
      pct(shareOf(biggest)),
      pct(rs.filter((r) => r.leaderAt5?.some((id) => r.winners.includes(id))).length / rs.length),
      withTitles ? num(mean(rs.map((r) => r.titleMoves ?? 0)), 1) : '–',
      num(mean(rs.map((r) => r.wars.declared / (r.rounds * r.players))), 2),
    ];
  });
  return table(
    [
      'Scenario',
      'Players',
      'Campaigns',
      'To win',
      'Median win round',
      'Reached the points to win',
      'Won on points at the last round',
      "Winners' mission points",
      "Winners' title points",
      'Most titles one player starts with',
      'Who starts with the most titles wins',
      'Biggest drafted empire wins',
      'Round-5 leader wins',
      'Titles changing hands',
      'Declarations per player-round',
    ],
    rows,
  );
}
