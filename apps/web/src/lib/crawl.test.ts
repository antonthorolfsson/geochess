import { describe, expect, it } from 'vitest';
import { WAVER, crawlEase, frontAt, frontPath, makeFront, mixHex, reachOf } from './crawl';
import type { Point } from './map-geometry';

/** A 10 by 10 square, its left edge on x = 0. */
const SQUARE: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

/** Every point a path passes through, and so the front's edge: where it starts, then each step added on. */
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

describe('a front’s reach', () => {
  it('runs from where it first touches the country to its farthest corner', () => {
    const along = reachOf(
      [
        [0, 2],
        [0, 8],
      ],
      SQUARE,
    );
    expect(along.near).toBeCloseTo(2);
    expect(along.far).toBeCloseTo(Math.hypot(10, 2));
    // From across the map: the corner it reaches first.
    const across = reachOf([[-10, 0]], SQUARE);
    expect(across).toEqual({ near: 10, far: Math.hypot(20, 10), entry: [0, 0] });
  });

  it('starts just touching the country and ends with its hollows past the farthest corner', () => {
    expect(frontAt(2, 12, 0)).toEqual({ radius: 2, waver: 0 });
    const end = frontAt(2, 12, 1);
    expect(end.waver).toBeCloseTo(WAVER * 10);
    expect(end.radius - end.waver).toBeCloseTo(12);
  });
});

describe('a front’s outline', () => {
  const front = makeFront(
    [
      [0, 0],
      [0, 10],
    ],
    () => 0.5,
  );

  it('is a closed wavering circle around each seed, within its waver of the radius', () => {
    const d = frontPath(front, 6, 1.5, 0.4, 20);
    const circles = d.split('z').filter(Boolean);
    expect(circles).toHaveLength(2);
    circles.forEach((circle, i) => {
      const [sx, sy] = front.seeds[i]!;
      for (const [x, y] of ends(circle)) {
        const r = Math.hypot(x - sx, y - sy);
        expect(r).toBeGreaterThanOrEqual(6 - 1.5 - 0.01);
        expect(r).toBeLessThanOrEqual(6 + 1.5 + 0.01);
      }
    });
    // Drawn finer the bigger it is on screen.
    expect(ends(frontPath(front, 6, 1.5, 0.4, 2)).length).toBeLessThan(ends(d).length);
  });

  it('creeps: the edge moves as time passes', () => {
    expect(frontPath(front, 6, 1.5, 0.4, 20)).not.toBe(frontPath(front, 6, 1.5, 1.4, 20));
    expect(frontPath(front, 0, 1.5, 0.4, 20)).toBe('');
  });
});

describe('crawlEase', () => {
  it('runs from 0 to 1, quick at first', () => {
    expect(crawlEase(0)).toBe(0);
    expect(crawlEase(1)).toBe(1);
    expect(crawlEase(2)).toBe(1);
    expect(crawlEase(0.25)).toBeGreaterThan(0.4);
  });
});

describe('mixHex', () => {
  it('blends one color over another', () => {
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mixHex('#3f55ba', '#16232b', 1)).toBe('#3f55ba');
    expect(mixHex('#3f55ba', '#16232b', 0)).toBe('#16232b');
  });
});
