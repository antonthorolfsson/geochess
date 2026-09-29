import { seededRandom, type Random } from '@empire/rules';

/**
 * Independent random streams, one per part of a campaign, so two runs that differ in one respect
 * (a what-if) still draft, deal and roll the same wherever they haven't diverged.
 */
export const STREAMS = ['setup', 'draft', 'deal', 'bots', 'order', 'chess', 'latency'] as const;
export type StreamName = (typeof STREAMS)[number];
export type Streams = Record<StreamName, Random>;

/** FNV-1a over a string, as a 32-bit seed. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function streams(seed: number): Streams {
  const out = {} as Streams;
  for (const name of STREAMS) out[name] = seededRandom(hashSeed(`${seed}:${name}`));
  return out;
}

export const pick = <T>(items: readonly T[], random: Random): T | undefined =>
  items.length === 0 ? undefined : items[Math.floor(random() * items.length)];

/** 0…n-1 in a random order. */
export function shuffledIndexes(n: number, random: Random): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A standard normal draw (Box–Muller). */
export function normal(random: Random): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** A standard Gumbel draw, for noisy argmax choices. */
export const gumbel = (random: Random) => -Math.log(-Math.log(Math.max(random(), 1e-12)));

/** An index drawn with the given weights (which needn't sum to 1). */
export function weighted(weights: readonly number[], random: Random): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}
