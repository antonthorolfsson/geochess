/**
 * Turns campaign records into the report's tables: game length and stalls, who wins and how, seats,
 * each public mission and each secret mission, and the war economy.
 */
import { MISSIONS, type MissionKind } from '@empire/rules';
import type { CampaignRecord } from '../record';
import { ci, mean, num, pct, quantile, table, wilson } from './stats';

type Rec = CampaignRecord;

export const TARGET_BAND: readonly [number, number] = [15, 25];

export function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
}

export const band = (players: number) => (players === 2 ? '2' : players <= 4 ? '3–4' : players <= 6 ? '5–6' : '7–8');
const name = (kind: string) => MISSIONS[kind as MissionKind]?.name ?? kind;

/** Round each campaign was won in (Infinity for a stall). */
const winRound = (r: Rec) => (r.finished && r.winRound !== null ? r.winRound : Infinity);

export function overview(recs: readonly Rec[]): string {
  const rows = [...groupBy(recs, (r) => `${r.scenario}|${r.pace}|${String(r.players).padStart(2)}`)].map(([k, rs]) => {
    const [scenario, pace, players] = k.split('|');
    const rounds = rs.map(winRound);
    const inBand = rs.filter((r) => winRound(r) >= TARGET_BAND[0] && winRound(r) <= TARGET_BAND[1]).length;
    const playerRounds = rs.reduce((n, r) => n + r.rounds * r.players, 0);
    const wars = rs.reduce((n, r) => n + r.wars.declared, 0);
    const eliminated = rs.reduce((n, r) => n + r.seats.filter((p) => p.eliminated !== null).length, 0);
    return [
      scenario!,
      pace!,
      players!.trim(),
      rs.length,
      num(quantile(rounds, 0.5), 0),
      `${num(quantile(rounds, 0.1), 0)}–${num(quantile(rounds, 0.9), 0)}`,
      pct(inBand / rs.length),
      pct(rs.filter((r) => r.stalled).length / rs.length),
      pct(rs.filter((r) => r.shared).length / rs.length),
      num(wars / playerRounds, 2),
      num(eliminated / rs.length, 2),
    ];
  });
  return table(
    [
      'Scenario',
      'Pace',
      'Players',
      'Campaigns',
      'Median win round',
      'Win round p10–p90',
      `Won in rounds ${TARGET_BAND[0]}–${TARGET_BAND[1]}`,
      'Stalled (no winner by cap)',
      'Shared wins',
      'Declarations per player-round',
      'Players eliminated per campaign',
    ],
    rows,
  );
}

/** How winners made their points: which missions, public and secret. */
export function winnerMix(recs: readonly Rec[]): string {
  const rows = [
    ...groupBy(
      recs.filter((r) => r.finished),
      (r) => `${r.pace}|${String(r.players).padStart(2)}`,
    ),
  ].map(([k, rs]) => {
    const [pace, players] = k.split('|');
    const mixes = new Map<string, number>();
    let winners = 0;
    for (const r of rs) {
      for (const w of r.winners) {
        winners++;
        const mine = r.awards.filter((a) => a.p === w);
        const pub = mine.filter((a) => a.scope === 'public').length;
        const secret = mine.some((a) => a.scope === 'secret');
        const mix = `${pub} public${secret ? ' + secret' : ''}`;
        mixes.set(mix, (mixes.get(mix) ?? 0) + 1);
      }
    }
    const top = [...mixes].sort((a, b) => b[1] - a[1]).map(([m, c]) => `${m} ${pct(c / winners)}`);
    const historic = rs.flatMap((r) => r.awards.filter((a) => r.winners.includes(a.p) && a.claim === null)).length;
    const all = rs.flatMap((r) => r.awards.filter((a) => r.winners.includes(a.p))).length;
    return [pace!, players!.trim(), winners, top.join(', '), pct(historic / all)];
  });
  return table(['Pace', 'Players', 'Winners', 'How the winners scored', 'Winner points from records (historic)'], rows);
}

/** Win rate by draft seat (shared wins split), and drafted value by seat. */
export function seats(recs: readonly Rec[]): string {
  const rows = [
    ...groupBy(
      recs.filter((r) => r.mode === 'normal'),
      (r) => String(r.players).padStart(2),
    ),
  ].map(([k, rs]) => {
    const n = Number(k);
    const wins = Array.from({ length: n }, () => 0);
    const drafted = Array.from({ length: n }, () => [] as number[]);
    for (const r of rs) {
      for (const p of r.seats) {
        drafted[p.seat]!.push(p.drafted);
        if (p.won) wins[p.seat]! += 1 / r.winners.length;
      }
    }
    const rates = wins.map((w) => w / rs.length);
    const cells = rates.map((rate, seat) => `${pct(rate)} (${num(mean(drafted[seat]!), 0)})`);
    const best = Math.max(...rates);
    const worst = Math.min(...rates);
    return [n, rs.length, cells.join(' · '), num(best / worst, 2)];
  });
  return table(
    ['Players', 'Campaigns', 'Win rate by seat, first to last (mean drafted value)', 'Best ÷ worst seat'],
    rows,
  );
}

/** Whether the leader after round 5 goes on to win, and whether drafting the most value does. */
export function leaders(recs: readonly Rec[]): string {
  const rows = [
    ...groupBy(
      recs.filter((r) => r.mode === 'normal' && r.finished),
      (r) => String(r.players).padStart(2),
    ),
  ].map(([k, rs]) => {
    const withLeader = rs.filter((r) => r.leaderAt5 && r.winRound !== null && r.winRound > 5);
    const leaderWon = withLeader.filter((r) => r.leaderAt5!.some((id) => r.winners.includes(id))).length;
    const topDraft = rs.filter((r) => {
      const best = Math.max(...r.seats.map((p) => p.drafted));
      return r.seats.some((p) => p.drafted === best && p.won);
    }).length;
    return [
      k.trim(),
      rs.length,
      `${pct(leaderWon / withLeader.length)} of ${withLeader.length}`,
      pct(topDraft / rs.length),
      pct(1 / Number(k)),
    ];
  });
  return table(
    ['Players', 'Won campaigns', 'Leader after round 5 wins (games past round 5)', 'Top drafter wins', 'Fair share'],
    rows,
  );
}

/** Each public mission: how often it's scored, how soon, and how much of it comes from the draft. */
export function publicMissions(recs: readonly Rec[], opts: { byRound?: number } = {}): string {
  const inPlay = recs.flatMap((r) => r.publics.map((kind) => ({ r, kind })));
  const rows: (string | number)[][] = [];
  for (const [k, items] of groupBy(inPlay, (x) => `${x.kind}|${band(x.r.players)}`)) {
    const [kind, b] = k.split('|');
    const awardsOf = (r: Rec) =>
      r.awards.filter((a) => a.kind === kind && a.scope === 'public' && (!opts.byRound || a.round <= opts.byRound));
    const campaigns = items.length;
    const any = items.filter(({ r }) => awardsOf(r).length > 0).length;
    const players = items.reduce((n, { r }) => n + r.players, 0);
    const awards = items.flatMap(({ r }) => awardsOf(r));
    const fromDraft = awards.filter((a) => a.draft).length;
    const winners = items.filter(({ r }) => r.finished).flatMap(({ r }) => r.winners.map((w) => ({ r, w })));
    const winnerScored = winners.filter(({ r, w }) => awardsOf(r).some((a) => a.p === w)).length;
    rows.push([
      name(kind!),
      b!,
      campaigns,
      pct(any / campaigns),
      pct(awards.length / players),
      num(
        quantile(
          awards.map((a) => a.round),
          0.5,
        ),
        0,
      ),
      pct(awards.length ? fromDraft / awards.length : NaN),
      winners.length ? pct(winnerScored / winners.length) : '–',
    ]);
  }
  return table(
    [
      'Mission',
      'Players',
      'Campaigns with it',
      'Scored by someone',
      'Share of players scoring it',
      'Median round scored',
      'Scored from drafted positions',
      'Winners who scored it',
    ],
    rows,
  );
}

/** Each secret kind, held by players it fits (forced assignment): completion and the holder's win rate. */
export function secretStrength(recs: readonly Rec[]): string {
  const holders = recs.flatMap((r) => r.seats.filter((p) => p.secret).map((p) => ({ r, p })));
  const rows: (string | number)[][] = [];
  for (const [k, items] of groupBy(holders, (x) => `${x.p.secret}|${band(x.r.players)}`)) {
    const [kind, b] = k.split('|');
    const n = items.length;
    const done = items.filter(({ p }) => p.secretRound !== null);
    const wins = items.reduce((w, { r, p }) => w + (p.won ? 1 / r.winners.length : 0), 0);
    const fair = mean(items.map(({ r }) => 1 / r.players));
    const rate = wilson(Math.round(wins), n);
    const revealedFirst = done.filter(({ p }) => p.revealed !== null && p.revealed < p.secretRound!).length;
    rows.push([
      name(kind!),
      b!,
      n,
      pct(done.length / n),
      num(
        quantile(
          done.map(({ p }) => p.secretRound!),
          0.5,
        ),
        0,
      ),
      `${pct(rate.p)} (${ci(rate)})`,
      num(rate.p / fair, 2),
      pct(done.length ? revealedFirst / done.length : NaN),
    ]);
  }
  return table(
    [
      'Secret mission',
      'Players',
      'Holders',
      'Completed',
      'Median round completed',
      'Holder win rate (95% CI)',
      'Win rate ÷ fair share',
      'Revealed before completing',
    ],
    rows,
  );
}

/** How often each secret is dealt, chosen when dealt, and completed when chosen (the chooser's view). */
export function secretChoice(recs: readonly Rec[]): string {
  const seatsAll = recs.flatMap((r) => r.seats);
  const kinds = new Set(seatsAll.flatMap((p) => p.options.map((o) => o.kind)));
  const rows = [...kinds].sort().map((kind) => {
    const dealt = seatsAll.filter((p) => p.options.some((o) => o.kind === kind));
    const chosen = dealt.filter((p) => p.secret === kind);
    const done = chosen.filter((p) => p.secretRound !== null);
    return [
      name(kind),
      pct(dealt.length / seatsAll.length),
      pct(chosen.length / Math.max(1, dealt.length)),
      chosen.length,
      pct(chosen.length ? done.length / chosen.length : NaN),
    ];
  });
  return table(
    ['Secret mission', 'Hands it is in', 'Chosen when dealt', 'Times chosen', 'Completed when chosen'],
    rows,
  );
}

/** Wars: how they're answered and how they end. */
export function warEconomy(recs: readonly Rec[]): string {
  const rows = [...groupBy(recs, (r) => `${r.scenario}|${r.pace}|${String(r.players).padStart(2)}`)].map(([k, rs]) => {
    const [scenario, pace, players] = k.split('|');
    const sum = (f: (r: Rec) => number) => rs.reduce((n, r) => n + f(r), 0);
    const declared = sum((r) => r.wars.declared);
    const games = sum((r) => r.wars.games);
    const o = (key: keyof Rec['wars']['outcomes']) => sum((r) => r.wars.outcomes[key]);
    const resp = (key: keyof Rec['wars']['responses']) => sum((r) => r.wars.responses[key]);
    return [
      scenario!,
      pace!,
      players!.trim(),
      pct(resp('raise') / declared),
      pct(resp('redirect') / declared),
      pct((resp('tribute-country') + resp('tribute-tokens')) / declared),
      pct(o('withdrawn') / declared),
      pct(o('attacker') / games),
      pct(o('defender') / games),
      pct(o('held') / games),
      num(sum((r) => r.wars.valueTaken) / Math.max(1, o('attacker')), 1),
      num(sum((r) => r.wars.valueRepelled) / Math.max(1, o('defender')), 1),
      num(sum((r) => r.tokensWasted) / sum((r) => r.rounds * r.players), 2),
    ];
  });
  return table(
    [
      'Scenario',
      'Pace',
      'Players',
      'Raised',
      'Redirected',
      'Tribute offered',
      'Withdrawn',
      'Attacker wins game',
      'Defender wins game',
      'Drawn (held)',
      'Value taken per attacker win',
      'Stake value per defender win',
      'Tokens wasted per player-round',
    ],
    rows,
  );
}
