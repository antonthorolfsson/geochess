import type { Point } from './map-geometry';

/**
 * A color crawling over a country on the map: a front sweeping across it from one end to the
 * other, a blob of the color running ahead of it, the edge behind wavering like ink soaking into
 * paper. Pure geometry in map units; the map draws it frame by frame.
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
  /**
   * The middle of the country and half its width, across the way, in `SLICES` slices from `back`
   * to `ahead`: the blob keeps to the middle.
   */
  middle: number[];
  half: number[];
  /** Where each wave along the edge starts, then the blob's wobbles, then its wandering. */
  phases: number[];
}

/** Slices the country is measured in along the way. */
export const SLICES = 16;

/**
 * The waves along the front's edge: their wavelength as a share of the way across the country,
 * their share of its wavering, and how fast they drift (radians a second).
 */
const WAVES = [
  { length: 1 / 2.3, weight: 0.5, speed: 0.5 },
  { length: 1 / 5.1, weight: 0.32, speed: -0.9 },
  { length: 1 / 11.3, weight: 0.18, speed: 1.5 },
];
/** The blob's wobbles: waves around it, their share of its radius, and how fast they drift. */
const WOBBLES = [
  { n: 2, weight: 0.1, speed: 1.3 },
  { n: 3, weight: 0.07, speed: -1.9 },
];
/** How far the blob wanders from the middle, as a share of the half width there, and how fast. */
const WANDER = { share: 0.3, speed: 0.7 };

/** How far the edge wavers at most, as a share of the way across the country. */
export const WAVER = 0.09;
/** The blob's radius: a share of the half width where it is, but at most a share of the way across. */
export const BLOB = { ofHalf: 0.45, ofLength: 0.16 };
/**
 * The swell lifting the front up to the blob, as a share of the blob's radius, how wide it is in
 * radii, and how far past the swell's top the blob's middle runs, in radii.
 */
const SWELL = { height: 0.7, width: 1.6, lead: 0.55 };

/** Points along the front: one every few pixels on screen, within limits. */
const MIN_POINTS = 16;
const MAX_POINTS = 200;
const POINT_EVERY_PX = 7;
const BLOB_POINTS = [16, 64] as const;

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
  const s = (p: Point) => (p[0] - origin[0]) * along[0] + (p[1] - origin[1]) * along[1];
  const n = (p: Point) => (p[0] - origin[0]) * across[0] + (p[1] - origin[1]) * across[1];

  let back = Infinity;
  let ahead = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  let start = origin;
  for (const p of outline) {
    const sp = s(p);
    const np = n(p);
    if (sp < back) [back, start] = [sp, p];
    ahead = Math.max(ahead, sp);
    left = Math.min(left, np);
    right = Math.max(right, np);
  }
  if (outline.length === 0) back = ahead = left = right = 0;
  const length = ahead - back;

  // The country's width in each slice, from the corners that fall in it: a slice with none takes
  // after its neighbors, and the whole is smoothed, so the blob rolls rather than jumps.
  const lows: number[] = Array(SLICES).fill(Infinity);
  const highs: number[] = Array(SLICES).fill(-Infinity);
  for (const p of outline) {
    const i = length > 0 ? Math.min(SLICES - 1, Math.floor(((s(p) - back) / length) * SLICES)) : 0;
    lows[i] = Math.min(lows[i]!, n(p));
    highs[i] = Math.max(highs[i]!, n(p));
  }
  const filled = [...lows.keys()].filter((i) => Number.isFinite(lows[i]));
  const fill = (values: number[]) => {
    if (filled.length === 0) return Array<number>(SLICES).fill(0);
    const out = [...values];
    for (let i = 0; i < SLICES; i++) {
      if (Number.isFinite(out[i])) continue;
      const before = filled.filter((j) => j < i).at(-1);
      const after = filled.find((j) => j > i);
      out[i] =
        before !== undefined && after !== undefined
          ? values[before]! + ((values[after]! - values[before]!) * (i - before)) / (after - before)
          : values[before ?? after!]!;
    }
    return out;
  };
  const smooth = (values: number[]) =>
    values.map((_, i) => {
      const a = values[Math.max(0, i - 1)]!;
      const b = values[Math.min(SLICES - 1, i + 1)]!;
      return (a + values[i]! + b) / 3;
    });
  const low = smooth(fill(lows));
  const high = smooth(fill(highs));

  return {
    origin,
    along,
    across,
    back,
    ahead,
    left,
    right,
    start,
    middle: low.map((l, i) => (l + high[i]!) / 2),
    half: low.map((l, i) => Math.max(0, (high[i]! - l) / 2)),
    phases: [...WAVES, ...WOBBLES, WANDER].map(() => random() * Math.PI * 2),
  };
}

/** The country's middle and half width where the sweep is `at` along the way. */
function sliceAt(sweep: Sweep, at: number): { middle: number; half: number } {
  const length = sweep.ahead - sweep.back;
  const u = length > 0 ? ((at - sweep.back) / length) * SLICES - 0.5 : 0;
  const i = Math.min(SLICES - 1, Math.max(0, Math.floor(u)));
  const j = Math.min(SLICES - 1, i + 1);
  const f = clamp01(u - i);
  return {
    middle: sweep.middle[i]! + (sweep.middle[j]! - sweep.middle[i]!) * f,
    half: sweep.half[i]! + (sweep.half[j]! - sweep.half[i]!) * f,
  };
}

/**
 * Where the sweep is `progress` (0 to 1) of the way across: its front along the way, how far its
 * edge wavers, and the blob ahead of it. The front starts short of the country, the wavering
 * growing as it comes in, and ends with even the hollows between its waves past the far end; the
 * blob sits on a swell in the front, sized to the country's width where it is, and wanders a
 * little from the middle as it goes.
 */
export function sweepFront(
  sweep: Sweep,
  progress: number,
  seconds: number,
  scale = Infinity,
): { front: number; waver: number; edge(n: number): number; blob: { s: number; n: number; radius: number } } {
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
  /** Where the wavering edge is along the way, `n` across. */
  const edge = (n: number) => {
    let wave = 0;
    for (let k = 0; k < WAVES.length; k++) {
      wave += weights[k]! * Math.sin((2 * Math.PI * n) / (WAVES[k]!.length * length) + shifts[k]!);
    }
    return front + waver * wave;
  };
  const at = sliceAt(sweep, front);
  const radius = Math.min(BLOB.ofHalf * at.half, BLOB.ofLength * length);
  const wander = Math.sin(sweep.phases[WAVES.length + WOBBLES.length]! + WANDER.speed * seconds);
  const n = at.middle + WANDER.share * at.half * wander;
  return { front, waver, edge, blob: { s: edge(n) + (SWELL.height + SWELL.lead) * radius, n, radius } };
}

/**
 * The sweep's outline as an SVG path: everything behind its wavering front, and the blob ahead,
 * two closed shapes wound the same way so that, filled, they make one. `seconds` drifts the waves
 * and the blob's wobbles, so the edge creeps as it goes; `scale` (screen pixels to a unit) sets
 * how finely it's drawn.
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
  const { front, edge, blob } = sweepFront(sweep, progress, seconds, scale);
  const count = Math.round(Math.min(MAX_POINTS, Math.max(MIN_POINTS, (width * scale) / POINT_EVERY_PX)));
  const wobbles = WOBBLES.map((w, k) => sweep.phases[WAVES.length + k]! + w.speed * seconds);
  const swellWidth = SWELL.width * blob.radius;
  const swellHeight = SWELL.height * blob.radius;
  const furthest = Math.max(0, ...offsets);
  // Anything behind the front, so the shape closes behind the country.
  const behind = Math.min(sweep.back, front) - 2 * WAVER * length - furthest - 1;
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
    const dn = n - blob.n;
    const swell = Math.abs(dn) < swellWidth ? swellHeight * Math.cos((Math.PI * dn) / (2 * swellWidth)) ** 2 : 0;
    const s = edge(n) + swell;
    for (let o = 0; o < offsets.length; o++) put(o, s + offsets[o]!, n, i === 0);
  }
  for (let o = 0; o < offsets.length; o++) {
    put(o, behind, sweep.right + 1, false);
    put(o, behind, sweep.left - 1, false);
    paths[o] += 'z';
  }
  // The blob, wobbling.
  const points = Math.round(
    Math.min(BLOB_POINTS[1], Math.max(BLOB_POINTS[0], (2 * Math.PI * blob.radius * scale) / POINT_EVERY_PX)),
  );
  for (let o = 0; o < offsets.length; o++) {
    let drawn = false;
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      let wobble = 0;
      for (let k = 0; k < WOBBLES.length; k++)
        wobble += WOBBLES[k]!.weight * Math.sin(WOBBLES[k]!.n * angle + wobbles[k]!);
      const r = blob.radius * (1 + wobble) + offsets[o]!;
      if (r <= 0) continue;
      put(o, blob.s + r * Math.cos(angle), blob.n + r * Math.sin(angle), !drawn);
      drawn = true;
    }
    if (drawn) paths[o] += 'z';
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
