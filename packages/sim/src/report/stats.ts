/** Small statistics helpers for the report. */

/** Wilson score interval for a proportion, 95% by default. */
export function wilson(successes: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: NaN, lo: NaN, hi: NaN };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** A quantile of numbers (Infinity allowed, for campaigns that never ended). */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1) + 0.5)));
  return sorted[i]!;
}

export const mean = (values: readonly number[]) =>
  values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length;

/** Pearson correlation. */
export function correlation(xs: readonly number[], ys: readonly number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

export const pct = (x: number, digits = 0) => (Number.isFinite(x) ? `${(100 * x).toFixed(digits)}%` : '–');
export const num = (x: number, digits = 1) => (Number.isFinite(x) ? x.toFixed(digits) : x === Infinity ? '∞' : '–');
export const ci = (w: { lo: number; hi: number }) => `${pct(w.lo)}–${pct(w.hi)}`;

/** A markdown table. */
export function table(head: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const line = (cells: readonly (string | number)[]) => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}
