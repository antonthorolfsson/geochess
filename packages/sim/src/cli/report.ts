/**
 * Aggregates recorded campaigns into markdown tables:
 *
 *   pnpm sim:report baseline secrets …   (directories under packages/sim/out, or paths)
 *
 * Writes the tables to stdout, and to `report.md` in the first directory given.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CampaignRecord } from '../record';
import {
  leaders,
  overview,
  publicMissions,
  secretChoice,
  secretStrength,
  seats,
  warEconomy,
  winnerMix,
} from '../report/aggregate';
import { compareMissions, compareToBase } from '../report/compare';
import { attackerValue, draftComplete, earlyDraftPoints, secretPooled, skill, titles } from '../report/extra';
import { parseArgs } from './args';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const args = parseArgs(argv);
const dirs = argv
  .filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1]!.startsWith('--') && !argv[i - 1]!.includes('=')))
  .map((d) => (existsSync(d) ? d : path.resolve(here, '../../out', d)));
if (dirs.length === 0) throw new Error('Name one or more output directories.');

export function loadRecords(dir: string): CampaignRecord[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith('shard-') && f.endsWith('.jsonl'))
    .flatMap((f) =>
      readFileSync(path.join(dir, f), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CampaignRecord),
    );
}

const recs = dirs.flatMap(loadRecords);
const only = args.get('scenario');
const chosen = only ? recs.filter((r) => only.split(',').includes(r.scenario)) : recs;
const normal = chosen.filter((r) => r.mode === 'normal');
const horizon = chosen.filter((r) => r.mode === 'horizon');
const forced = chosen.filter((r) => r.seats.some((p) => p.forced));
const chosenSecrets = normal.filter((r) => !r.seats.some((p) => p.forced));

const base = args.get('compare');
const sections = [
  `# Simulation report\n\n${chosen.length} campaigns from ${dirs.map((d) => path.basename(d)).join(', ')}.`,
  base && `## Against ${base}, seed for seed\n\n${compareToBase(recs, base)}`,
  base && args.has('missions') && `## Missions against ${base}, seed for seed\n\n${compareMissions(recs, base)}`,
  normal.length && `## Game length\n\n${overview(normal)}`,
  normal.some((r) => r.titleMoves !== undefined) && `## Titles\n\n${titles(normal)}`,
  normal.length && `## How winners scored\n\n${winnerMix(normal)}`,
  normal.length && `## Draft seats\n\n${seats(normal)}`,
  normal.length && `## Leaders and snowballing\n\n${leaders(normal)}`,
  normal.length && `## Public missions (campaigns played to a win)\n\n${publicMissions(normal)}`,
  normal.length && `## Public missions complete at the draft\n\n${draftComplete(normal)}`,
  normal.length && `## Points from drafted positions\n\n${earlyDraftPoints(normal)}`,
  horizon.length &&
    `## Public missions by round 25 (played on, whoever reaches 7)\n\n${publicMissions(horizon, { byRound: 25 })}`,
  forced.length && `## Secret missions, each held by players it fits\n\n${secretStrength(forced)}`,
  forced.length && `## Secret missions pooled over player counts\n\n${secretPooled(forced)}`,
  chosenSecrets.length && `## Secret missions as chosen\n\n${secretChoice(chosenSecrets)}`,
  `## Wars\n\n${warEconomy(chosen)}`,
  `## What a war is worth\n\n${attackerValue(chosen)}`,
  chosen.some((r) => new Set(r.seats.map((p) => p.elo)).size > 1) && `## Chess skill\n\n${skill(chosen)}`,
].filter(Boolean);
const text = sections.join('\n\n') + '\n';
writeFileSync(path.join(dirs[0]!, 'report.md'), text);
console.log(text);
