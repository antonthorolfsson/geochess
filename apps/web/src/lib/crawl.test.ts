import { describe, expect, it } from 'vitest';
import { BLOB, SLICES, WAVER, crawlEase, crawlMs, makeSweep, mixHex, sweepFront, sweepPath, sweepPaths } from './crawl';
import type { Point } from './map-geometry';

/** A boat 10 long and 4 wide, its blunt end on x = 0 and its prow at [10, 2]. */
const BOAT: Point[] = [
  [0, 0],
  [6, 0],
  [10, 2],
  [6, 4],
  [0, 4],
];

/** Every point a path passes through, and so its outline: where it starts, then each step added on. */
const ends = (d: string): Point[] => {
  const points: Point[] = [];
  let [x, y] = [0, 0];
  for (const [, command, args] of d.matchAll(/([Ml])([^Mlz]*)/g)) {
    const [a, b] = args!.split(',').map(Number);
    [x, y] = command === 'M' ? [a!, b!] : [x + a!, y + b!];
    points.push([x, y]);
  }
  return points;
};

describe('a sweep', () => {
  const sweep = makeSweep([0, 2], BOAT, () => 0.5);

  it('heads from where the color crosses in for the farthest corner', () => {
    expect(sweep.along[0]).toBeCloseTo(1);
    expect(sweep.along[1]).toBeCloseTo(0);
    expect(sweep.across[0]).toBeCloseTo(0);
    expect(sweep.across[1]).toBeCloseTo(1);
    // From a country further off, the same way in.
    const across = makeSweep([-20, 2], BOAT, () => 0.5);
    expect(across.along[0]).toBeCloseTo(1);
    expect(across.back).toBeCloseTo(20);
    expect(across.ahead).toBeCloseTo(30);
  });

  it('spans the country along the way and across it, starting at its nearest corner', () => {
    expect(sweep.back).toBeCloseTo(0);
    expect(sweep.ahead).toBeCloseTo(10);
    expect(sweep.left).toBeCloseTo(-2);
    expect(sweep.right).toBeCloseTo(2);
    expect(sweep.start).toEqual([0, 0]);
  });

  it('keeps the country’s middle and width by slices, narrowing to the prow', () => {
    expect(sweep.middle).toHaveLength(SLICES);
    for (const m of sweep.middle) expect(m).toBeCloseTo(0);
    expect(sweep.half[0]).toBeCloseTo(2);
    expect(sweep.half[8]).toBeCloseTo(2);
    expect(sweep.half[SLICES - 1]).toBeLessThan(1);
    sweep.half.slice(9).forEach((h, i) => expect(h).toBeLessThanOrEqual(sweep.half[8 + i]! + 1e-9));
  });

  it('copes with a country of one corner', () => {
    const dot = makeSweep([3, 3], [[3, 3]], () => 0.5);
    expect(dot.along).toEqual([1, 0]);
    expect(dot.ahead - dot.back).toBe(0);
    expect(sweepPath(dot, 0.5, 1)).toBe('');
  });
});

describe('a sweep’s front', () => {
  const sweep = makeSweep([0, 2], BOAT, () => 0.5);

  it('starts short of the country and ends with its hollows past the far end', () => {
    const start = sweepFront(sweep, 0, 0);
    expect(start.front).toBeCloseTo(-WAVER * 10);
    expect(start.waver).toBe(0);
    const end = sweepFront(sweep, 1, 0);
    expect(end.waver).toBeCloseTo(WAVER * 10);
    expect(end.front - end.waver).toBeCloseTo(10);
    expect(sweepFront(sweep, 0.5, 0).front).toBeGreaterThan(start.front);
    expect(sweepFront(sweep, 0.5, 0).front).toBeLessThan(end.front);
  });

  it('runs a blob ahead of the edge, sized to the country where it is', () => {
    const { front, waver, edge, blob } = sweepFront(sweep, 0.4, 0);
    expect(blob.s).toBeGreaterThan(edge(blob.n));
    // Within its own radius of the edge, whatever the waves there: the swell under it joins them.
    expect(blob.s - blob.radius).toBeLessThan(edge(blob.n) + blob.radius);
    expect(Math.abs(edge(blob.n) - front)).toBeLessThanOrEqual(waver + 1e-9);
    expect(blob.radius).toBeCloseTo(Math.min(BLOB.ofHalf * 2, BLOB.ofLength * 10));
    expect(Math.abs(blob.n)).toBeLessThan(2);
    // Smaller in the prow.
    expect(sweepFront(sweep, 0.95, 0).blob.radius).toBeLessThan(blob.radius);
  });
});

describe('a sweep’s outline', () => {
  const sweep = makeSweep([0, 2], BOAT, () => 0.5);

  it('is the shape behind the front and the blob ahead of it, closed and wound the same way', () => {
    const d = sweepPath(sweep, 0.5, 0.4, 20);
    const shapes = d.split('z').filter(Boolean);
    expect(shapes).toHaveLength(2);
    const turn = (shape: string) => {
      const points = ends(shape);
      let twice = 0;
      points.forEach(([x0, y0], i) => {
        const [x1, y1] = points[(i + 1) % points.length]!;
        twice += x0 * y1 - x1 * y0;
      });
      return Math.sign(twice);
    };
    expect(turn(shapes[0]!)).toBe(turn(shapes[1]!));
    // The blob sits ahead of the edge, within the country's width.
    const { front, waver, blob } = sweepFront(sweep, 0.5, 0.4, 20);
    for (const [x, y] of ends(shapes[1]!)) {
      expect(x).toBeGreaterThan(front - waver);
      expect(Math.abs(x - blob.s)).toBeLessThanOrEqual(blob.radius * 1.2 + 0.1);
      expect(Math.abs(y - 2)).toBeLessThan(2.5);
    }
  });

  it('covers nothing at first and everything at the end', () => {
    const atStart = ends(sweepPath(sweep, 0, 0, 20).split('z')[0]!);
    for (const [x] of atStart) expect(x).toBeLessThanOrEqual(BLOB.ofLength * 10 * 1.2 + 0.1);
    const atEnd = ends(sweepPath(sweep, 1, 0, 20).split('z')[0]!);
    // The front, before the shape turns back behind the country.
    for (const [x] of atEnd.slice(0, -2)) expect(x).toBeGreaterThanOrEqual(10 - 0.01);
  });

  it('draws the rim the same way, further ahead', () => {
    const [body, rim] = sweepPaths(sweep, 0.5, 0.4, 20, [0, 0.3]);
    const front = ends(body!.split('z')[0]!).slice(0, -2);
    const ahead = ends(rim!.split('z')[0]!).slice(0, -2);
    expect(ahead).toHaveLength(front.length);
    front.forEach(([x, y], i) => {
      expect(ahead[i]![0]).toBeCloseTo(x + 0.3, 1);
      expect(ahead[i]![1]).toBeCloseTo(y, 1);
    });
  });

  it('creeps: the edge moves as time passes, and is drawn finer the bigger it is on screen', () => {
    expect(sweepPath(sweep, 0.5, 0.4, 20)).not.toBe(sweepPath(sweep, 0.5, 1.4, 20));
    expect(ends(sweepPath(sweep, 0.5, 0.4, 2)).length).toBeLessThan(ends(sweepPath(sweep, 0.5, 0.4, 40)).length);
  });
});

describe('crawlEase', () => {
  it('runs from 0 to 1, a steady creep easing off at the end', () => {
    expect(crawlEase(-1)).toBe(0);
    expect(crawlEase(0)).toBe(0);
    expect(crawlEase(1)).toBe(1);
    expect(crawlEase(2)).toBe(1);
    // A little ahead of an even pace all the way, never racing ahead.
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(crawlEase(t)).toBeGreaterThan(t);
      expect(crawlEase(t)).toBeLessThan(t + 0.2);
    }
  });
});

describe('crawlMs', () => {
  it('takes 2 to 8 seconds by the country’s land area', () => {
    // Liechtenstein and Qatar; Canada and Russia.
    expect(crawlMs(160)).toBe(2000);
    expect(crawlMs(10_000)).toBe(2000);
    expect(crawlMs(9_984_670)).toBeCloseTo(8000, -1);
    expect(crawlMs(17_125_190)).toBe(8000);
    // Two seconds for each tenfold: Belgium, Italy, India.
    expect(crawlMs(30_689)).toBeCloseTo(2974, -1);
    expect(crawlMs(302_130)).toBeCloseTo(4960, -1);
    expect(crawlMs(3_287_260)).toBeCloseTo(7034, -1);
    expect(crawlMs(100_000)).toBeCloseTo(4000);
  });

  it('takes longer the bigger the country, and the middle when its size isn’t known', () => {
    const areas = [500, 20_000, 80_000, 400_000, 2_000_000, 9_000_000];
    const times = areas.map(crawlMs);
    times.slice(1).forEach((ms, i) => expect(ms).toBeGreaterThan(times[i]!));
    expect(crawlMs(null)).toBe(5000);
    expect(crawlMs(Number.NaN)).toBe(5000);
  });
});

describe('mixHex', () => {
  it('blends one color over another', () => {
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mixHex('#3f55ba', '#16232b', 1)).toBe('#3f55ba');
    expect(mixHex('#3f55ba', '#16232b', 0)).toBe('#16232b');
  });
});
