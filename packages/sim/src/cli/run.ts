/**
 * Plays many campaigns in parallel child processes:
 *
 *   pnpm sim --scenario baseline,secrets --players 2-8 --paces live,correspondence --seeds 400
 *
 * `--mission-rules 2` plays an earlier mission rules version, `--last-round 30` (or `none`) another
 * season length than new campaigns get, `--dataset 2026.1` another dataset than the latest.
 *
 * Records go to `out/<name>/shard-*.jsonl` (one line per campaign). Campaigns already recorded
 * there are skipped, so an interrupted run picks up where it stopped.
 */
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from '../scenarios';
import { VARIANTS } from '../variants-catalog';
import { parseArgs, parseRange } from './args';
import type { Job } from './worker';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const scenarios = (args.get('scenario') ?? 'baseline').split(',');
for (const name of scenarios) {
  const known = name.startsWith('whatif:') ? VARIANTS[name.slice(7)] : SCENARIOS[name];
  if (!known) throw new Error(`Unknown scenario: ${name}`);
}
const players = parseRange(args.get('players') ?? '2-8');
const paces = (args.get('paces') ?? 'live,correspondence').split(',') as Job['pace'][];
const seeds = Number(args.get('seeds') ?? 100);
const seedStart = Number(args.get('seed-start') ?? 1);
const workers = Number(args.get('workers') ?? Math.max(1, availableParallelism() - 2));
const missionVersion = args.has('mission-rules') ? Number(args.get('mission-rules')) : undefined;
const lastRoundArg = args.get('last-round');
const lastRound = lastRoundArg === undefined ? undefined : lastRoundArg === 'none' ? null : Number(lastRoundArg);
const dataset = args.get('dataset');
const out = path.resolve(here, '../../out', args.get('out') ?? scenarios.join('+').replace(/[:/]/g, '-'));
mkdirSync(out, { recursive: true });

const key = (j: Pick<Job, 'scenario' | 'players' | 'pace' | 'seed'>) =>
  `${j.scenario}|${j.players}|${j.pace}|${j.seed}`;
const done = new Set<string>();
for (const file of readdirSync(out).filter((f) => f.startsWith('shard-') && f.endsWith('.jsonl'))) {
  for (const line of readFileSync(path.join(out, file), 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line) as Job;
    done.add(key(r));
  }
}

const jobs: Job[] = [];
for (let seed = seedStart; seed < seedStart + seeds; seed++) {
  for (const scenario of scenarios) {
    for (const pace of paces) {
      for (const n of players) {
        const job: Job = {
          scenario,
          players: n,
          pace,
          seed,
          ...(missionVersion !== undefined && { missionVersion }),
          ...(lastRound !== undefined && { lastRound }),
          ...(dataset !== undefined && { dataset }),
        };
        if (!done.has(key(job))) jobs.push(job);
      }
    }
  }
}
console.log(`${jobs.length} campaigns to play (${done.size} already recorded) on ${workers} workers → ${out}`);
if (jobs.length === 0) process.exit(0);

const started = Date.now();
let finished = 0;
const stamp = Date.now();
const children = Array.from({ length: Math.min(workers, jobs.length) }, (_, w) => {
  const share = jobs.filter((_, i) => i % workers === w);
  const jobFile = path.join(out, `.jobs-${stamp}-${w}.json`);
  writeFileSync(jobFile, JSON.stringify(share));
  const child = fork(path.join(here, 'worker.ts'), [
    jobFile,
    path.join(out, `shard-${stamp}-${w}.jsonl`),
    path.join(out, `errors-${stamp}.jsonl`),
  ]);
  child.on('message', () => finished++);
  return new Promise<void>((resolve) => child.on('exit', () => resolve()));
});

const progress = setInterval(() => {
  const secs = (Date.now() - started) / 1000;
  const rate = finished / Math.max(secs, 1);
  const eta = rate > 0 ? Math.round((jobs.length - finished) / rate) : NaN;
  console.log(`${finished}/${jobs.length} · ${rate.toFixed(1)}/s · ~${eta}s left`);
}, 15_000);

await Promise.all(children);
clearInterval(progress);
const errors = path.join(out, `errors-${stamp}.jsonl`);
const failed = existsSync(errors) ? readFileSync(errors, 'utf8').split('\n').filter(Boolean).length : 0;
console.log(
  `Done: ${finished} campaigns in ${Math.round((Date.now() - started) / 1000)}s${failed ? `, ${failed} failed (${errors})` : ''}`,
);
