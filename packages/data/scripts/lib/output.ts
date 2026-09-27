import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const INLINE_MAX = 120;

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v !== 'object';
}

/**
 * Pretty JSON that keeps short arrays and flat objects on one line, so the committed dataset stays
 * readable and diffs stay small.
 */
export function formatJson(value: unknown, indent = ''): string {
  if (isPrimitive(value)) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const flat = `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    if (value.every(isPrimitive) && flat.length <= INLINE_MAX) return flat;
    if (value.every(isPrimitive)) {
      return `[\n${inner}${value.map((v) => JSON.stringify(v)).join(`,\n${inner}`)}\n${indent}]`;
    }
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  const flat = `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${formatJson(v)}`).join(', ')} }`;
  const shallow = entries.every(([, v]) => isPrimitive(v) || (Array.isArray(v) && v.every(isPrimitive)));
  if (shallow && flat.length <= INLINE_MAX) return flat;
  const lines = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`);
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

export function writeText(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
}

/**
 * Keeps the previous `generatedAt` when nothing else changed, so rebuilding an unchanged dataset
 * produces no diff.
 */
export function stableGeneratedAt<T extends { generatedAt: string }>(file: string, next: T): T {
  if (!existsSync(file)) return next;
  try {
    const previous = JSON.parse(readFileSync(file, 'utf8')) as T;
    const same = JSON.stringify({ ...previous, generatedAt: '' }) === JSON.stringify({ ...next, generatedAt: '' });
    return same ? { ...next, generatedAt: previous.generatedAt } : next;
  } catch {
    return next;
  }
}

/** Adds `version` to datasets/index.json and marks it as the latest. */
export function updateIndex(file: string, version: string): void {
  let versions: string[] = [];
  if (existsSync(file)) {
    const index = JSON.parse(readFileSync(file, 'utf8')) as { versions?: string[] };
    versions = index.versions ?? [];
  }
  if (!versions.includes(version)) versions.push(version);
  versions.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  writeText(file, formatJson({ latest: versions[versions.length - 1], versions }));
}
