import type { Point } from './map-geometry';

/**
 * A color crawling over a country on the map: a front spreading from where it crosses in (points
 * along the border, a sea lane's landing, or a country further off), its edge wavering like ink
 * soaking into paper. Pure geometry in map units; the map draws it frame by frame.
 */
export interface Front {
  /** Where it spreads from. */
  seeds: Point[];
  /** For each seed, where each of `WAVES` starts. */
  phases: number[][];
}

/**
 * The waves along a front's edge: how many to a turn, their share of its wavering, and how fast
 * they drift (radians a second). Only an arc of each seed's circle crosses the country, so it takes
 * many to a turn for fingers of color to show along the front.
 */
const WAVES = [
  { n: 5, weight: 0.34, speed: 0.6 },
  { n: 11, weight: 0.3, speed: -1.1 },
  { n: 19, weight: 0.22, speed: 1.7 },
  { n: 31, weight: 0.14, speed: -2.4 },
];

/** Points around each seed's circle: one every few pixels on screen, within limits. */
const MIN_POINTS = 32;
const MAX_POINTS = 180;
const POINT_EVERY_PX = 7;

/** How far the edge wavers at most, as a share of the way across the country. */
export const WAVER = 0.22;

export function makeFront(seeds: readonly Point[], random: () => number = Math.random): Front {
  return {
    seeds: [...seeds],
    phases: seeds.map(() => WAVES.map(() => random() * Math.PI * 2)),
  };
}

/**
 * How far a front from `seeds` must spread to cover a country with these corners: `near`, where it
 * first touches (0 when a seed lies on its border), `far`, where it has covered the last corner,
 * and `entry`, the corner it touches first.
 */
export function reachOf(
  seeds: readonly Point[],
  outline: readonly Point[],
): { near: number; far: number; entry: Point } {
  let near = Infinity;
  let far = 0;
  let entry: Point = outline[0] ?? seeds[0] ?? [0, 0];
  for (const p of outline) {
    let closest = Infinity;
    for (const s of seeds) closest = Math.min(closest, Math.hypot(p[0] - s[0], p[1] - s[1]));
    if (closest < near) {
      near = closest;
      entry = p;
    }
    far = Math.max(far, closest);
  }
  if (!Number.isFinite(near)) return { near: 0, far: 0, entry };
  return { near, far, entry };
}

/**
 * Where the front is `progress` (0 to 1) of the way across: its radius from each seed, and how far
 * its edge wavers. It starts just touching the country, the wavering growing as it comes in, and
 * ends with even the hollows between its waves past the farthest corner.
 */
export function frontAt(near: number, far: number, progress: number): { radius: number; waver: number } {
  const p = Math.min(1, Math.max(0, progress));
  const most = WAVER * Math.max(far - near, 0);
  return { radius: near + p * (far - near + most), waver: most * Math.min(1, p / 0.3) };
}

/**
 * The front's outline as an SVG path: a wavering circle around each seed, all wound the same way
 * so that, filled, they make one shape. `seconds` drifts the waves, so the edge creeps as it goes;
 * `scale` (screen pixels to a unit) sets how finely it's drawn.
 */
export function frontPath(front: Front, radius: number, waver: number, seconds: number, scale = 1): string {
  return frontPaths(front, radius, waver, seconds, scale, [0])[0]!;
}

/**
 * `frontPath`, and the same edge drawn further out by each of `offsets` (as for a rim running ahead
 * of the color), worked out together: one path for each offset.
 */
export function frontPaths(
  front: Front,
  radius: number,
  waver: number,
  seconds: number,
  scale: number,
  offsets: readonly number[],
): string[] {
  if (radius <= 0) return offsets.map(() => '');
  const count = Math.round(Math.min(MAX_POINTS, Math.max(MIN_POINTS, (2 * Math.PI * radius * scale) / POINT_EVERY_PX)));
  // A wave too fine for the points it's drawn with would shimmer as the circle grows: each comes in
  // only once there are enough points to a wave to draw it.
  const weights = WAVES.map((w) => w.weight * Math.min(1, Math.max(0, (count / w.n - 3) / 3)));
  // To a tenth of a unit, or a hundredth zoomed in far enough for that to show.
  const places = scale >= 8 ? 100 : 10;
  // Each circle is a closed line, each step written relative to the last: drawn every few pixels it
  // reads as a curve, and the path stays short enough to redraw every frame. Rounded to whole
  // numbers of `places` first, so the steps add up exactly. Run every frame, so plain loops.
  const paths = offsets.map(() => '');
  const lastX = offsets.map(() => 0);
  const lastY = offsets.map(() => 0);
  for (let s = 0; s < front.seeds.length; s++) {
    const [cx, cy] = front.seeds[s]!;
    const phases = front.phases[s] ?? [];
    const shifts = WAVES.map((w, k) => (phases[k] ?? 0) + w.speed * seconds);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let wave = 0;
      for (let k = 0; k < WAVES.length; k++) wave += weights[k]! * Math.sin(WAVES[k]!.n * angle + shifts[k]!);
      const r = radius + waver * wave;
      for (let o = 0; o < offsets.length; o++) {
        const at = Math.max(0, r + offsets[o]!);
        const x = Math.round((cx + at * cos) * places);
        const y = Math.round((cy + at * sin) * places);
        paths[o] +=
          i === 0 ? `M${x / places},${y / places}` : `l${(x - lastX[o]!) / places},${(y - lastY[o]!) / places}`;
        lastX[o] = x;
        lastY[o] = y;
      }
    }
    for (let o = 0; o < offsets.length; o++) paths[o] += 'z';
  }
  return paths;
}

/** The shortest and longest crawls, and the land areas they come at. */
export const CRAWL_MS = [2000, 8000] as const;
const CRAWL_AREA_KM2 = [10_000, 10_000_000] as const;

/**
 * How long a color takes to crawl over a country, by its land area: 2 seconds for a microstate or
 * anything up to 10,000 km², 8 for the giants from 10 million km² (Canada, the United States, China,
 * Russia), and in between by the logarithm of the area, so each tenfold adds 2 seconds: Belgium
 * about 3, Italy 5, India 7. An unknown area takes the middle, 5.
 */
export function crawlMs(areaKm2: number | null): number {
  if (areaKm2 === null || !Number.isFinite(areaKm2)) return (CRAWL_MS[0] + CRAWL_MS[1]) / 2;
  const [small, large] = CRAWL_AREA_KM2;
  const share = Math.log(Math.max(areaKm2, 1) / small) / Math.log(large / small);
  return CRAWL_MS[0] + (CRAWL_MS[1] - CRAWL_MS[0]) * Math.min(1, Math.max(0, share));
}

/**
 * How far along its crawl a country is, `t` (0 to 1) of the way through its time: a steady creep
 * that eases off as it fills the far side.
 */
export const crawlEase = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 1.4;
};

/**
 * How far the waves along a front's edge drift over a whole crawl, in seconds of their own speed:
 * the same whether the crawl takes 2 seconds or 8, so a slow crawl creeps rather than boils.
 */
export const CRAWL_DRIFT_S = 2.5;

/** One color blended over another: `#rrggbb`, `amount` (0 to 1) of `top` over `bottom`. */
export function mixHex(top: string, bottom: string, amount: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const out = [0, 1, 2].map((i) =>
    Math.round(channel(top, i) * amount + channel(bottom, i) * (1 - amount))
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${out.join('')}`;
}
