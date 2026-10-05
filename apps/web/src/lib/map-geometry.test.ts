import type { Dataset } from '@empire/rules';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import { W, buildGeometry, frameAround, union, type Bounds } from './map-geometry';

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
