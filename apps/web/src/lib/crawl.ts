import type { Point } from './map-geometry';

/**
 * A color crawling over a country on the map: a front sweeping across it from one end to the
 * other, its edge wavering like ink bleeding into paper. Pure geometry in map units; the map draws
 * it frame by frame.
 */
export interface Sweep {
  /** Positions are measured from here, along the way it travels (`along`, a unit vector) and across it. */
  origin: Point;
  along: Point;
  across: Point;
  /** How far the country reaches along the way, from `back` to `ahead`, and across it, from `left` to `right`. */
  back: number;
  ahead: number;
  left: number;
  right: number;
  /** Where the color first touches: the country's corner at `back`. */
  start: Point;
  /** Where each wave along the edge starts. */
  phases: number[];
}

/**
 * The waves along the front's edge: their wavelength as a share of the way across the country,
 * their share of its wavering, and how fast they drift (radians a second).
 */
const WAVES = [
  { length: 1 / 2.3, weight: 0.5, speed: 0.5 },
  { length: 1 / 5.1, weight: 0.32, speed: -0.9 },
  { length: 1 / 11.3, weight: 0.18, speed: 1.5 },
];

/** How far the edge wavers at most, as a share of the way across the country. */
export const WAVER = 0.09;

/** Points along the front: one every few pixels on screen, within limits. */
const MIN_POINTS = 16;
const MAX_POINTS = 200;
const POINT_EVERY_PX = 7;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The sweep that carries a color over a country with these corners: in from `origin` (where it
 * crosses the border, or a country further off), heading for the farthest corner, so it runs from
 * one end of the country to the other.
 */
export function makeSweep(origin: Point, outline: readonly Point[], random: () => number = Math.random): Sweep {
  let far: Point = origin;
  let farthest = -1;
  for (const p of outline) {
    const d = Math.hypot(p[0] - origin[0], p[1] - origin[1]);
    if (d > farthest) [far, farthest] = [p, d];
  }
  const along: Point = farthest > 0 ? [(far[0] - origin[0]) / farthest, (far[1] - origin[1]) / farthest] : [1, 0];
  const across: Point = [-along[1], along[0]];

  let back = Infinity;
  let ahead = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  let start = origin;
  for (const p of outline) {
    const s = (p[0] - origin[0]) * along[0] + (p[1] - origin[1]) * along[1];
    const n = (p[0] - origin[0]) * across[0] + (p[1] - origin[1]) * across[1];
    if (s < back) [back, start] = [s, p];
    ahead = Math.max(ahead, s);
    left = Math.min(left, n);
    right = Math.max(right, n);
  }
  if (outline.length === 0) back = ahead = left = right = 0;

  return { origin, along, across, back, ahead, left, right, start, phases: WAVES.map(() => random() * Math.PI * 2) };
}

/**
 * Where the sweep is `progress` (0 to 1) of the way across: its front along the way, how far its
 * edge wavers, and where the wavering edge is at any point across. The front starts short of the
 * country, the wavering growing as it comes in, and ends with even the hollows between its waves
 * past the far end.
 */
export function sweepFront(
  sweep: Sweep,
  progress: number,
  seconds: number,
  scale = Infinity,
): { front: number; waver: number; edge(n: number): number } {
  const p = clamp01(progress);
  const length = sweep.ahead - sweep.back;
  const most = WAVER * length;
  const front = sweep.back - most + p * (length + 2 * most);
  const waver = most * Math.min(1, p / 0.25);
  // A wave too fine for the points it's drawn with (one every few pixels) would shimmer: each
  // comes in only once there are enough points to a wave to draw it.
  const weights = WAVES.map((w) =>
    length > 0 ? w.weight * clamp01((w.length * length * scale) / POINT_EVERY_PX / 3 - 1) : 0,
  );
  const shifts = WAVES.map((w, k) => sweep.phases[k]! + w.speed * seconds);
  const edge = (n: number) => {
    let wave = 0;
    for (let k = 0; k < WAVES.length; k++) {
      wave += weights[k]! * Math.sin((2 * Math.PI * n) / (WAVES[k]!.length * length) + shifts[k]!);
    }
    return front + waver * wave;
  };
  return { front, waver, edge };
}

/**
 * The sweep's outline as an SVG path: everything behind its wavering front, closed. `seconds`
 * drifts the waves, so the edge creeps as it goes; `scale` (screen pixels to a unit) sets how
 * finely it's drawn.
 */
export function sweepPath(sweep: Sweep, progress: number, seconds: number, scale = 1): string {
  return sweepPaths(sweep, progress, seconds, scale, [0])[0]!;
}

/**
 * `sweepPath`, and the same shape drawn further ahead by each of `offsets` (as for a rim running
 * ahead of the color), worked out together: one path for each offset.
 */
export function sweepPaths(
  sweep: Sweep,
  progress: number,
  seconds: number,
  scale: number,
  offsets: readonly number[],
): string[] {
  const length = sweep.ahead - sweep.back;
  const width = sweep.right - sweep.left;
  if (length <= 0 || width <= 0) return offsets.map(() => '');
  const { front, edge } = sweepFront(sweep, progress, seconds, scale);
  const count = Math.round(Math.min(MAX_POINTS, Math.max(MIN_POINTS, (width * scale) / POINT_EVERY_PX)));
  // Anything behind the front, so the shape closes behind the country.
  const behind = Math.min(sweep.back, front) - 2 * WAVER * length - Math.max(0, ...offsets) - 1;
  // To a tenth of a unit, or a hundredth zoomed in far enough for that to show. Each step is
  // written relative to the last, rounded first so the steps add up exactly: drawn every few
  // pixels it reads as a curve, and the path stays short enough to redraw every frame.
  const places = scale >= 8 ? 100 : 10;
  const paths = offsets.map(() => '');
  const lastX = offsets.map(() => 0);
  const lastY = offsets.map(() => 0);
  const put = (o: number, s: number, n: number, first: boolean) => {
    const x = Math.round((sweep.origin[0] + s * sweep.along[0] + n * sweep.across[0]) * places);
    const y = Math.round((sweep.origin[1] + s * sweep.along[1] + n * sweep.across[1]) * places);
    paths[o] += first ? `M${x / places},${y / places}` : `l${(x - lastX[o]!) / places},${(y - lastY[o]!) / places}`;
    lastX[o] = x;
    lastY[o] = y;
  };
  // The front, from one side of the country to the other, then round behind it.
  for (let i = 0; i <= count; i++) {
    const n = sweep.left - 1 + (width + 2) * (i / count);
    const s = edge(n);
    for (let o = 0; o < offsets.length; o++) put(o, s + offsets[o]!, n, i === 0);
  }
  for (let o = 0; o < offsets.length; o++) {
    put(o, behind, sweep.right + 1, false);
    put(o, behind, sweep.left - 1, false);
    paths[o] += 'z';
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
