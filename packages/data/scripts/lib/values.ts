import type { RealStats } from '@empire/rules';
import { VALUE_METRICS, type ValueMetric, type ValuesConfig } from './config';

export { loadValues } from './config';

export interface ValueRow {
  id: string;
  name: string;
  /** Weighted mean of the normalized log metrics, 0-1. */
  score: number;
  inputs: Record<ValueMetric, number | null>;
  /** Metrics the score is based on; fewer than all when data is missing. */
  metrics: ValueMetric[];
  generated: number;
  override: number | null;
  overrideReason: string | null;
  value: number;
}

export interface ValuesResult {
  /** Sorted by score, highest first. */
  rows: ValueRow[];
  /** Target number of territories per value (the top value down to 1). */
  targets: Map<number, number>;
}

/** The highest value the shares give out (values.yaml allows up to 10; trial curves go higher). */
const topValue = (shares: ReadonlyMap<number, number>) => Math.max(10, ...shares.keys());

/**
 * Counts per value from the configured shares. Boundaries are rounded cumulative shares, so the
 * counts always add up to `n` and rounding errors never accumulate.
 */
export function valueTargets(n: number, shares: ReadonlyMap<number, number>): Map<number, number> {
  const targets = new Map<number, number>();
  let cumulative = 0;
  let placed = 0;
  for (let value = topValue(shares); value >= 2; value--) {
    cumulative += shares.get(value) ?? 0;
    const boundary = Math.min(n, Math.round(cumulative * n));
    targets.set(value, boundary - placed);
    placed = boundary;
  }
  targets.set(1, n - placed);
  return targets;
}

export function computeValues(
  items: readonly { id: string; name: string; stats: RealStats }[],
  cfg: ValuesConfig,
): ValuesResult {
  const ranges = {} as Record<ValueMetric, { min: number; max: number }>;
  for (const m of VALUE_METRICS) {
    const logs = items
      .map((t) => t.stats[m])
      .filter((v): v is number => v !== null && v > 0)
      .map(Math.log10);
    ranges[m] = { min: Math.min(...logs), max: Math.max(...logs) };
  }

  const scored = items.map((t) => {
    let sum = 0;
    let weight = 0;
    const inputs = {} as Record<ValueMetric, number | null>;
    const metrics: ValueMetric[] = [];
    for (const m of VALUE_METRICS) {
      const v = t.stats[m];
      inputs[m] = v;
      const w = cfg.weights[m];
      if (v === null || v <= 0 || w === 0) continue;
      const { min, max } = ranges[m];
      sum += (w * (Math.log10(v) - min)) / (max - min || 1);
      weight += w;
      metrics.push(m);
    }
    if (weight === 0) throw new Error(`${t.id}: no metric available to score it`);
    return { id: t.id, name: t.name, score: sum / weight, inputs, metrics };
  });
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

  for (const id of cfg.overrides.keys()) {
    if (!items.some((t) => t.id === id)) throw new Error(`values.yaml overrides: unknown territory ${id}`);
  }
  const targets = valueTargets(scored.length, cfg.shares);
  const rows: ValueRow[] = [];
  let rank = 0;
  for (let value = topValue(cfg.shares); value >= 1; value--) {
    for (let k = 0; k < (targets.get(value) ?? 0); k++, rank++) {
      const s = scored[rank]!;
      const o = cfg.overrides.get(s.id) ?? null;
      rows.push({
        ...s,
        score: Math.round(s.score * 1e4) / 1e4,
        generated: value,
        override: o?.value ?? null,
        overrideReason: o?.reason ?? null,
        value: o?.value ?? value,
      });
    }
  }
  return { rows, targets };
}
