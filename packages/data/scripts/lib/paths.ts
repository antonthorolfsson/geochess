import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG_DIR = path.join(DATA_DIR, 'config');
/** Download cache and scratch output (gitignored). */
export const RAW_DIR = path.join(DATA_DIR, 'raw');
export const DATASETS_DIR = path.join(DATA_DIR, 'datasets');
