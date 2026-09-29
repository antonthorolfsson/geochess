/** What-if variants against the scenario they're paired with, on the same seeds. */
import type { CampaignRecord } from '../record';
import { TARGET_BAND, groupBy } from './aggregate';
import { num, pct, quantile, table } from './stats';

type Rec = CampaignRecord;

const BATTLE = new Set(['backstab', 'iron_wall', 'checkmate_artist', 'nemesis']);
const winRound = (r: Rec) => (r.finished && r.winRound !== null ? r.winRound : Infinity);
const key = (r: Rec) => `${r.pace}|${r.players}|${r.seed}`;

function metrics(rs: readonly Rec[]) {
  const rounds = rs.map(winRound);
  const players = rs.reduce((n, r) => n + r.players, 0);
  const share = (kind: string) =>
    rs.reduce((n, r) => n + r.awards.filter((a) => a.kind === kind && a.scope === 'public').length, 0) / players;
  const secrets = rs.flatMap((r) => r.seats.filter((p) => p.secret));
  const done = (f: (kind: string) => boolean) => {
    const held = secrets.filter((p) => f(p.secret!));
    return held.length ? held.filter((p) => p.secretRound !== null).length / held.length : NaN;
  };
  return {
    median: quantile(rounds, 0.5),
    inBand: rs.filter((r) => winRound(r) >= TARGET_BAND[0] && winRound(r) <= TARGET_BAND[1]).length / rs.length,
    stalled: rs.filter((r) => r.stalled).length / rs.length,
    veteran: share('campaign_veteran'),
    positions: share('strategic_positions'),
    connection: share('great_connection'),
    expansion: share('expansion'),
    battle: done((k) => BATTLE.has(k)),
    other: done((k) => !BATTLE.has(k)),
  };
}

export function compareToBase(recs: readonly Rec[], base: string): string {
  const baseByKey = new Map(recs.filter((r) => r.scenario === base).map((r) => [key(r), r]));
  const variants = recs.filter((r) => r.scenario !== base && baseByKey.has(key(r)));
  const rows = [...groupBy(variants, (r) => `${r.scenario}|${String(r.players).padStart(2)}`)].map(([k, rs]) => {
    const [scenario, players] = k.split('|');
    const b = metrics(rs.map((r) => baseByKey.get(key(r))!));
    const v = metrics(rs);
    const arrow = (x: number, y: number, f: (n: number) => string) => `${f(x)} → ${f(y)}`;
    return [
      scenario!.replace(/^whatif:/, ''),
      players!.trim(),
      rs.length,
      arrow(b.median, v.median, (n) => num(n, 0)),
      arrow(b.inBand, v.inBand, (n) => pct(n)),
      arrow(b.stalled, v.stalled, (n) => pct(n)),
      arrow(b.veteran, v.veteran, (n) => pct(n)),
      arrow(b.positions, v.positions, (n) => pct(n)),
      arrow(b.connection, v.connection, (n) => pct(n)),
      arrow(b.expansion, v.expansion, (n) => pct(n)),
      arrow(b.battle, v.battle, (n) => pct(n)),
      arrow(b.other, v.other, (n) => pct(n)),
    ];
  });
  return table(
    [
      'Variant',
      'Players',
      'Paired campaigns',
      'Median win round',
      `Won in rounds ${TARGET_BAND[0]}–${TARGET_BAND[1]}`,
      'Stalled',
      'Players scoring Campaign Veteran',
      'Strategic Positions',
      'Great Connection',
      'Expansion',
      'Battle secrets completed',
      'Other secrets completed',
    ],
    rows,
  );
}

/** Each public mission in a variant against the scenario it's paired with: players scoring it, and when. */
export function compareMissions(recs: readonly Rec[], base: string): string {
  const baseByKey = new Map(recs.filter((r) => r.scenario === base).map((r) => [key(r), r]));
  const variants = recs.filter((r) => r.scenario !== base && baseByKey.has(key(r)));
  const rows: (string | number)[][] = [];
  for (const [k, rs] of groupBy(
    variants,
    (r) => `${r.scenario}|${r.players <= 3 ? '2–3' : r.players <= 5 ? '4–5' : '6–8'}`,
  )) {
    const [scenario, band] = k.split('|');
    const kinds = [...new Set(rs.flatMap((r) => r.publics))].sort();
    for (const kind of kinds) {
      const side = (list: readonly Rec[]) => {
        const withIt = list.filter((r) => r.publics.includes(kind));
        const players = withIt.reduce((n, r) => n + r.players, 0);
        const awards = withIt.flatMap((r) => r.awards.filter((a) => a.kind === kind && a.scope === 'public'));
        return {
          share: awards.length / Math.max(1, players),
          median: quantile(
            awards.map((a) => a.round),
            0.5,
          ),
        };
      };
      const b = side(rs.map((r) => baseByKey.get(key(r))!));
      const v = side(rs);
      rows.push([
        scenario!.replace(/^whatif:/, ''),
        band!,
        kind,
        `${pct(b.share)} → ${pct(v.share)}`,
        `${num(b.median, 0)} → ${num(v.median, 0)}`,
      ]);
    }
  }
  return table(['Variant', 'Players', 'Mission', 'Players scoring it', 'Median round scored'], rows);
}
