import { describe, expect, it } from 'vitest';
import { WAVER, crawlEase, crawlMs, makeSweep, mixHex, sweepFront, sweepPath, sweepPaths } from './crawl';
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

  it('wavers within its waver of the front, and more as it comes in', () => {
    const early = sweepFront(sweep, 0.1, 0.4);
    const later = sweepFront(sweep, 0.6, 0.4);
    expect(later.waver).toBeGreaterThan(early.waver);
    for (const n of [-2, -1, 0, 1, 2]) {
      expect(Math.abs(later.edge(n) - later.front)).toBeLessThanOrEqual(later.waver + 1e-9);
    }
    // Not flat: the waves show.
    expect(later.edge(-2)).not.toBeCloseTo(later.edge(1), 3);
  });
});

describe('a sweep’s outline', () => {
  const sweep = makeSweep([0, 2], BOAT, () => 0.5);

  it('is the shape behind the wavering front, closed', () => {
    const d = sweepPath(sweep, 0.5, 0.4, 20);
    expect(d.split('z').filter(Boolean)).toHaveLength(1);
    const { front, waver } = sweepFront(sweep, 0.5, 0.4, 20);
    // The front runs across the country, then the shape turns back behind it.
    const points = ends(d);
    const across = points.slice(0, -2);
    expect(across.length).toBeGreaterThan(16);
    for (const [x] of across) {
      expect(x).toBeGreaterThanOrEqual(front - waver - 0.01);
      expect(x).toBeLessThanOrEqual(front + waver + 0.01);
    }
    expect(across[0]![1]).toBeLessThan(0);
    expect(across.at(-1)![1]).toBeGreaterThan(4);
    for (const [x] of points.slice(-2)) expect(x).toBeLessThan(0);
  });

  it('covers nothing at first and everything at the end', () => {
    for (const [x] of ends(sweepPath(sweep, 0, 0, 20))) expect(x).toBeLessThanOrEqual(0.01);
    const atEnd = ends(sweepPath(sweep, 1, 0, 20)).slice(0, -2);
    for (const [x] of atEnd) expect(x).toBeGreaterThanOrEqual(10 - 0.01);
  });

  it('draws the rim the same way, further ahead', () => {
    const [body, rim] = sweepPaths(sweep, 0.5, 0.4, 20, [0, 0.3]);
    const front = ends(body!).slice(0, -2);
    const ahead = ends(rim!).slice(0, -2);
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
