import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RAW_DIR } from './paths';

export interface FetchOptions {
  /** Re-download even when a cached copy exists. */
  refresh: boolean;
}

/** Text of `url`, served from raw/`file` when cached so reruns work offline. */
export async function cachedText(url: string, file: string, opts: FetchOptions): Promise<string> {
  const target = path.join(RAW_DIR, file);
  if (!opts.refresh && existsSync(target)) return readFileSync(target, 'utf8');
  const text = await fetchWithRetry(url);
  mkdirSync(RAW_DIR, { recursive: true });
  // Write-then-rename so an interrupted download never leaves a truncated cache file behind.
  writeFileSync(`${target}.tmp`, text);
  renameSync(`${target}.tmp`, target);
  console.log(`  downloaded ${file} (${Math.round(text.length / 1024)} KB)`);
  return text;
}

async function fetchWithRetry(url: string, attempts = 3): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** i));
    }
  }
  throw new Error(`Download failed: ${url}: ${String(lastError)}`);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
