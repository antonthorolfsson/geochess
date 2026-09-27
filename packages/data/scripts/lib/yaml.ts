import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { CONFIG_DIR } from './paths';

/** Tiny validators for hand-edited YAML: each takes the value and a readable location for errors. */

export class ConfigError extends Error {}

export function loadConfigFile(name: string): unknown {
  const file = path.join(CONFIG_DIR, name);
  try {
    return parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ConfigError(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function fail(where: string, message: string): never {
  throw new ConfigError(`${where}: ${message}`);
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asRecord(v: unknown, where: string): Record<string, unknown> {
  if (!isRecord(v)) fail(where, 'expected a mapping');
  return v;
}

/** A mapping that may be absent (null/undefined) and must only use `allowed` keys. */
export function asOptionalRecord(v: unknown, where: string, allowed?: readonly string[]): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  const r = asRecord(v, where);
  if (allowed) {
    for (const key of Object.keys(r)) {
      if (!allowed.includes(key)) fail(where, `unknown key "${key}" (allowed: ${allowed.join(', ')})`);
    }
  }
  return r;
}

export function asString(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(where, 'expected a non-empty string');
  return v;
}

export function asNumber(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(where, 'expected a number');
  return v;
}

export function asArray(v: unknown, where: string): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(where, 'expected a list');
  return v;
}

export function asStringList(v: unknown, where: string): string[] {
  return asArray(v, where).map((x, i) => asString(x, `${where}[${i}]`));
}

export function asLonLat(v: unknown, where: string): [number, number] {
  const a = asArray(v, where);
  if (a.length !== 2) fail(where, 'expected [lon, lat]');
  const lon = asNumber(a[0], `${where}[0]`);
  const lat = asNumber(a[1], `${where}[1]`);
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) fail(where, 'lon/lat out of range');
  return [lon, lat];
}

export function asBBox(v: unknown, where: string): [number, number, number, number] {
  const a = asArray(v, where);
  if (a.length !== 4) fail(where, 'expected [west, south, east, north]');
  const [w, s, e, n] = a.map((x, i) => asNumber(x, `${where}[${i}]`)) as [number, number, number, number];
  if (w >= e || s >= n) fail(where, 'bbox must have west < east and south < north');
  return [w, s, e, n];
}
