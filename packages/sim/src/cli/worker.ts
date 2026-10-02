/** A runner's child process: plays its share of the campaigns and appends one JSON line per campaign. */
import { appendFileSync, readFileSync } from 'node:fs';
import { loadDataset } from '../dataset';
import { recordOf } from '../record';
import { runScenarioCampaign, scenarioConfig } from '../scenarios';

export interface Job {
  scenario: string;
  players: number;
  pace: 'live' | 'correspondence';
  seed: number;
  /** Overrides from the command line: another mission rules version, last round (null: none) or dataset. */
  missionVersion?: number;
  lastRound?: number | null;
  dataset?: string;
}

const [jobFile, outFile, errFile] = process.argv.slice(2) as [string, string, string];
const jobs = JSON.parse(readFileSync(jobFile, 'utf8')) as Job[];
for (const job of jobs) {
  const cfg = scenarioConfig(job.scenario, {
    players: job.players,
    pace: job.pace,
    ...(job.missionVersion !== undefined && { missionVersion: job.missionVersion }),
    ...(job.lastRound !== undefined && { lastRound: job.lastRound }),
    ...(job.dataset !== undefined && { dataset: job.dataset }),
  });
  const started = performance.now();
  try {
    const s = runScenarioCampaign(cfg, job.seed, loadDataset(cfg.dataset ?? undefined));
    appendFileSync(outFile, `${JSON.stringify(recordOf(s, performance.now() - started))}\n`);
  } catch (error) {
    appendFileSync(errFile, `${JSON.stringify({ job, error: String((error as Error).stack ?? error) })}\n`);
  }
  process.send?.({ done: 1 });
}
