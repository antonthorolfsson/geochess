import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG_DIR = path.join(DATA_DIR, 'config');
/** Download cache and scratch output (gitignored). */
export const RAW_DIR = path.join(DATA_DIR, 'raw');
export const DATASETS_DIR = path.join(DATA_DIR, 'datasets');
/** The opening names table, built from the Lichess openings list. */
export const OPENINGS_DIR = path.join(DATA_DIR, 'openings');
/** The arsenals and energy table, shown on the statistics pages and read by no rule. */
export const FACTS_DIR = path.join(DATA_DIR, 'facts');
