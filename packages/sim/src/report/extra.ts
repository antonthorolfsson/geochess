/** Further tables for the balance report: the draft's share, early leads, the war economy per player. */
import { MISSIONS, type MissionKind } from '@empire/rules';
import type { CampaignRecord } from '../record';
import { band, groupBy } from './aggregate';
import { mean, num, pct, table, wilson } from './stats';

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
