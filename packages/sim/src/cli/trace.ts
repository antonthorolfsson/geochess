/**
 * One campaign, told round by round: `pnpm --filter @empire/sim trace --scenario baseline
 * --players 4 --seed 7 [--pace correspondence] [--mission-rules 2] [--last-round none]`.
 */
import { missionName, valueOfSet } from '@empire/rules';
import { loadDataset } from '../dataset';
import { heldBy } from '../engine/state';
import { runScenarioCampaign, scenarioConfig } from '../scenarios';
import { parseArgs } from './args';

const args = parseArgs(process.argv.slice(2));
const players = Number(args.get('players') ?? 4);
const seed = Number(args.get('seed') ?? 1);
const lastRound = args.get('last-round');
const cfg = scenarioConfig(args.get('scenario') ?? 'baseline', {
  players,
  pace: (args.get('pace') as 'live' | 'correspondence' | undefined) ?? 'live',
  trace: true,
  debug: true,
  ...(args.has('mission-rules') && { missionVersion: Number(args.get('mission-rules')) }),
  ...(lastRound !== undefined && { lastRound: lastRound === 'none' ? null : Number(lastRound) }),
});
const idx = loadDataset();
const s = runScenarioCampaign(cfg, seed, idx);

const out: string[] = [];
out.push(
  `${cfg.scenario} · ${players} players · ${cfg.pace} · ${cfg.draftMode} draft · seed ${seed} · ` +
    `mission rules ${s.rules.victory.version} · last round ${s.rules.victory.lastRound ?? 'none'}`,
);
out.push('Public missions:');
for (const spec of s.publicSpecs) out.push(`  ${missionName(spec)}: ${JSON.stringify(spec)}`);
out.push('Empires after the draft:');
for (const p of [...s.players].sort((a, b) => a.seat - b.seat)) {
  const drafted = valueOfSet(idx, p.baseline);
  out.push(
    `  ${p.id} seat ${p.seat + 1}, Elo ${p.elo}: ${p.baseline.size} countries worth ${drafted}; ` +
      `options ${p.options.map((o) => `${o.spec.kind}(${o.estimate.conquests})`).join(', ')}; ` +
      `secret ${p.secret ? missionName(p.secret) : 'none'}`,
  );
}
out.push(`Complete at the draft: ${s.draftComplete.map((d) => `${d.userId} ${d.kind}`).join(', ') || 'nothing'}`);
out.push(...s.log);
out.push('Final:');
for (const p of s.players) {
  out.push(
    `  ${p.id}: ${s.points.get(p.id)} points, ${heldBy(s, p.id).size} countries worth ${valueOfSet(idx, heldBy(s, p.id))}, reputation ${p.reputation}` +
      (p.eliminatedRound ? `, eliminated in round ${p.eliminatedRound}` : ''),
  );
}
out.push(
  s.winners.length > 0
    ? `Won by ${s.winners.join(', ')} in round ${s.finishedRound}${s.endedByLimit ? ', on points when the last round ended' : ''}`
    : `No winner by round ${s.round}`,
);
console.log(out.join('\n'));
