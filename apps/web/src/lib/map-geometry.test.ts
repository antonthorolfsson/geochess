import type { Dataset } from '@empire/rules';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import { W, buildGeometry, frameAround, spreadAlong, union, type Bounds } from './map-geometry';

// The real map: the question is how real countries frame.
const require = createRequire(import.meta.url);
const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(require.resolve(`@empire/data/datasets/${file}`), 'utf8'));
const { latest } = readJson<{ latest: string }>('index.json');
const geo = buildGeometry(
  readJson<Topology>(`${latest}/map.topo.json`),
  readJson<Dataset>(`${latest}/territories.json`),
);

const box = (id: string) => geo.byId.get(id)!.bounds;
const anchor = (id: string) => geo.byId.get(id)!.anchor;
const width = ([[x0], [x1]]: Bounds) => x1 - x0;
const contains = ([[x0, y0], [x1, y1]]: Bounds, [[a0, b0], [a1, b1]]: Bounds) =>
  a0 >= x0 && b0 >= y0 && a1 <= x1 && b1 <= y1;
const has = ([[x0, y0], [x1, y1]]: Bounds, [x, y]: [number, number]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

describe('frameAround', () => {
  const BALTIC = ['DNK', 'DEU', 'POL', 'LTU', 'LVA', 'EST', 'RUS', 'FIN', 'SWE'];

  it('frames the Baltic League around the Baltic, not all of Russia', () => {
    // Russia's box runs from Kaliningrad over the date line: most of the map.
    expect(width(box('RUS'))).toBeGreaterThan(W / 2);
    const frame = frameAround(geo, BALTIC)!;
    for (const id of BALTIC.filter((id) => id !== 'RUS')) expect(contains(frame, box(id))).toBe(true);
    expect(width(frame)).toBeLessThan(W / 6);
    // Russia's Baltic shore is in the frame; Siberia and Central Asia are not.
    expect(geo.partWithin('RUS', frame)).not.toBeNull();
    expect(has(frame, anchor('RUS'))).toBe(false);
    expect(has(frame, anchor('KAZ'))).toBe(false);
  });

  it('frames the Black Sea and the Caspian without Siberia', () => {
    for (const ids of [
      ['TUR', 'BGR', 'ROU', 'UKR', 'RUS', 'GEO'],
      ['RUS', 'KAZ', 'TKM', 'IRN', 'AZE'],
    ]) {
      const frame = frameAround(geo, ids)!;
      for (const id of ids.filter((id) => id !== 'RUS')) expect(contains(frame, box(id))).toBe(true);
      expect(width(frame)).toBeLessThan(W / 5);
      expect(has(frame, anchor('RUS'))).toBe(false);
      expect(has(frame, anchor('MNG'))).toBe(false);
    }
  });

  it('frames the lower 48 beside Chile, not Hawaii and the Aleutians', () => {
    const frame = frameAround(geo, ['USA', 'CHL'])!;
    expect(width(box('USA'))).toBeGreaterThan(W / 2);
    expect(contains(frame, box('CHL'))).toBe(true);
    expect(has(frame, anchor('USA'))).toBe(true);
    expect(width(frame)).toBeLessThan(W / 4);
  });

  it('frames a strait by its shores', () => {
    const frame = frameAround(geo, ['CUB', 'USA'])!;
    expect(contains(frame, box('CUB'))).toBe(true);
    expect(geo.partWithin('USA', frame)).not.toBeNull();
    expect(width(frame)).toBeLessThan(W / 20);
  });

  it('keeps big countries whole when nothing else is smaller', () => {
    const powers = ['USA', 'CHN', 'RUS'];
    expect(frameAround(geo, powers)).toEqual(union(powers.map(box)));
    expect(frameAround(geo, ['RUS'])).toEqual(box('RUS'));
    // Scandinavia with Svalbard: nothing sprawls that far.
    const nordic = ['NOR', 'SWE', 'FIN', 'DNK'];
    expect(frameAround(geo, nordic)).toEqual(union(nordic.map(box)));
  });

  it('ignores repeats, as when a route lists its ends twice', () => {
    expect(frameAround(geo, [...BALTIC, 'RUS', 'EST'])).toEqual(frameAround(geo, BALTIC));
    expect(frameAround(geo, [])).toBeNull();
    expect(frameAround(geo, ['NOWHERE'])).toBeNull();
  });
});

describe('focusBounds', () => {
  const height = ([[, y0], [, y1]]: Bounds) => y1 - y0;
  const near = (a: Bounds, b: Bounds) => a.flat().every((n, i) => Math.abs(n - b.flat()[i]!) < 0.01);

  it('frames Russia without the tip of Chukotka over the date line', () => {
    const focus = geo.focusBounds('RUS')!;
    expect(width(focus)).toBeLessThan(W / 2);
    expect(has(focus, anchor('RUS'))).toBe(true);
    // From the Baltic to the Pacific.
    expect(geo.partWithin('LTU', focus)).not.toBeNull();
    expect(focus[1][0]).toBeCloseTo(box('RUS')[1][0]);
  });

  it('frames the United States with Alaska and Hawaii but not the western Aleutians', () => {
    const focus = geo.focusBounds('USA')!;
    expect(width(focus)).toBeLessThan(W / 3);
    expect(has(focus, anchor('USA'))).toBe(true);
    // Alaska's north shore and Hawaii are the top and bottom of the whole box.
    expect(height(focus)).toBeCloseTo(height(box('USA')));
  });

  it('leaves out islands far at sea', () => {
    for (const id of ['NZL', 'FJI', 'CHL', 'ECU']) {
      const focus = geo.focusBounds(id)!;
      expect(width(focus)).toBeLessThan(width(box(id)) / 2);
      expect(contains(box(id), focus)).toBe(true);
    }
  });

  it('keeps countries in several pieces whole', () => {
    for (const id of ['IDN', 'MYS', 'PHL', 'GBR', 'FRA', 'CAN', 'GRC']) {
      expect(near(geo.focusBounds(id)!, box(id))).toBe(true);
    }
  });

  it('frames a microstate on its dot', () => {
    const micro = geo.shapes.find((s) => s.micro)!;
    expect(geo.focusBounds(micro.id)).toEqual([micro.anchor, micro.anchor]);
    expect(geo.focusBounds('NOWHERE')).toBeNull();
  });
});

describe('where countries meet', () => {
  const grown = ([[x0, y0], [x1, y1]]: Bounds, by: number): Bounds => [
    [x0 - by, y0 - by],
    [x1 + by, y1 + by],
  ];

  it('marks a land border along its length', () => {
    const pyrenees = geo.contact('FRA', 'ESP');
    expect(pyrenees.length).toBeGreaterThan(1);
    expect(pyrenees.length).toBeLessThanOrEqual(6);
    // On the border: in both countries' boxes, and well apart from each other.
    for (const p of pyrenees) {
      expect(has(grown(box('FRA'), 0.5), p)).toBe(true);
      expect(has(grown(box('ESP'), 0.5), p)).toBe(true);
    }
    const [first, last] = [pyrenees[0]!, pyrenees.at(-1)!];
    expect(Math.hypot(last[0] - first[0], last[1] - first[1])).toBeGreaterThan(3);
    // Either way round.
    expect(geo.contact('ESP', 'FRA')).toHaveLength(pyrenees.length);
  });

  it('lands a crossing by sea on the far coast', () => {
    const [landing, ...more] = geo.contact('GBR', 'FRA');
    expect(more).toEqual([]);
    expect(has(grown(box('FRA'), 0.5), landing!)).toBe(true);
    // The other way, on Britain's coast.
    const [back] = geo.contact('FRA', 'GBR');
    expect(has(grown(box('GBR'), 0.5), back!)).toBe(true);
    expect(back).not.toEqual(landing);
  });

  it('has nothing for countries that don’t touch', () => {
    expect(geo.contact('FRA', 'JPN')).toEqual([]);
  });

  it('knows every country’s land area, which sets how long a color takes to crawl over it', () => {
    for (const shape of geo.shapes) expect(shape.areaKm2).toBeGreaterThan(0);
    expect(geo.byId.get('RUS')!.areaKm2).toBeGreaterThan(geo.byId.get('BEL')!.areaKm2! * 500);
  });

  it('outlines a country as framed, a microstate by its dot', () => {
    const russia = geo.outline('RUS');
    const focus = geo.focusBounds('RUS')!;
    expect(russia.length).toBeGreaterThan(100);
    for (const p of russia) expect(has(grown(focus, 1.01), p)).toBe(true);
    const micro = geo.shapes.find((s) => s.micro)!;
    expect(geo.outline(micro.id)).toEqual([micro.anchor]);
  });
});

describe('spreadAlong', () => {
  it('spreads points evenly along lines, in the middle of each stretch', () => {
    const line: [number, number][] = [
      [0, 0],
      [8, 0],
      [24, 0],
    ];
    expect(spreadAlong([line], 6, 8)).toEqual([
      [3, 0],
      [9, 0],
      [15, 0],
      [21, 0],
    ]);
    expect(spreadAlong([line], 6, 2)).toEqual([
      [6, 0],
      [18, 0],
    ]);
    expect(spreadAlong([line], 100, 8)).toEqual([[12, 0]]);
    expect(spreadAlong([[[4, 5]]], 6, 8)).toEqual([[4, 5]]);
    expect(spreadAlong([], 6, 8)).toEqual([]);
  });
});
