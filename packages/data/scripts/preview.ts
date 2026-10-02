/**
 * Renders SVG previews of the latest dataset into raw/ for eyeballing the map: fill by value, borders,
 * coastlines, sea lanes (manual ones in purple) and dots at micro anchors. On macOS each SVG is also
 * converted to PNG with QuickLook.
 *
 *   pnpm --filter @empire/data preview               # world plus regional crops
 *   pnpm --filter @empire/data preview -20,19,-1,37  # adds a custom crop: west,south,east,north
 */
import { MAX_VALUE, type Dataset, type LonLat } from '@empire/rules';
import { geoGraticule10, geoNaturalEarth1, geoPath, type GeoProjection } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { DATASETS_DIR, RAW_DIR } from './lib/paths';

/** Sequential ramp from value 1 to the top value. */
const RAMP = [
  '#fff7bc',
  '#fee391',
  '#fec44f',
  '#fe9929',
  '#ec7014',
  '#cc4c02',
  '#a63603',
  '#7f2704',
  '#5c1a03',
  '#3d1102',
];
const rampOf = (value: number) => RAMP[Math.round(((value - 1) / (MAX_VALUE - 1)) * (RAMP.length - 1))];

interface View {
  name: string;
  width: number;
  height: number;
  /** [west, south, east, north]; east may exceed 180 to cross the antimeridian. Omit for the world. */
  bbox?: [number, number, number, number];
  labels: boolean;
}

const VIEWS: View[] = [
  { name: 'preview', width: 2400, height: 1250, labels: false },
  { name: 'preview-europe', width: 1800, height: 1500, bbox: [-25, 34, 45, 72], labels: true },
  { name: 'preview-caribbean', width: 1800, height: 1100, bbox: [-90, 9, -58, 27], labels: true },
  { name: 'preview-pacific', width: 1800, height: 1100, bbox: [125, -48, 215, 25], labels: true },
  { name: 'preview-seasia', width: 1800, height: 1300, bbox: [88, -14, 150, 38], labels: true },
  { name: 'preview-mideast', width: 1800, height: 1300, bbox: [20, 10, 65, 43], labels: true },
  { name: 'preview-africa', width: 1800, height: 1500, bbox: [-26, -36, 60, 20], labels: true },
];

function projectionFor(view: View): GeoProjection {
  const p = geoNaturalEarth1();
  if (!view.bbox)
    return p.fitExtent(
      [
        [10, 10],
        [view.width - 10, view.height - 10],
      ],
      { type: 'Sphere' },
    );
  const [w, s, e, n] = view.bbox;
  p.rotate([-(w + e) / 2, 0]);
  const edge: LonLat[] = [];
  for (let i = 0; i <= 8; i++) edge.push([w + ((e - w) * i) / 8, s], [w + ((e - w) * i) / 8, n]);
  return p
    .fitExtent(
      [
        [0, 0],
        [view.width, view.height],
      ],
      { type: 'MultiPoint', coordinates: edge },
    )
    .clipExtent([
      [0, 0],
      [view.width, view.height],
    ]);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function svgPath(d: string | null, attrs: string, title?: string): string {
  if (!d) return '';
  return title ? `<path d="${d}" ${attrs}><title>${escapeXml(title)}</title></path>` : `<path d="${d}" ${attrs}/>`;
}

function render(dataset: Dataset, topology: Topology, view: View): string {
  const projection = projectionFor(view);
  const draw = geoPath(projection);
  const object = topology.objects['territories'] as GeometryCollection;
  const features = feature(topology, object) as FeatureCollection<Geometry, { name: string }>;
  const byId = new Map(dataset.territories.map((t) => [t.id, t]));
  // QuickLook thumbnails are square and crop anything else, so the canvas is padded to a square.
  const size = Math.max(view.width, view.height);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<g transform="translate(${(size - view.width) / 2} ${(size - view.height) / 2})">`,
    `<rect width="${view.width}" height="${view.height}" fill="#a9c7de"/>`,
    svgPath(draw(geoGraticule10()), 'fill="none" stroke="#8fb0c9" stroke-width="0.5"'),
  ];
  for (const f of features.features as Feature<Geometry, { name: string }>[]) {
    const t = byId.get(String(f.id));
    const fill = t ? rampOf(t.value) : '#ff00ff';
    out.push(svgPath(draw(f), `fill="${fill}"`, `${String(f.id)} ${f.properties.name} (${t?.value})`));
  }
  out.push(svgPath(draw(mesh(topology, object, (a, b) => a !== b)), 'fill="none" stroke="#3b2f2f" stroke-width="0.6"'));
  out.push(svgPath(draw(mesh(topology, object, (a, b) => a === b)), 'fill="none" stroke="#2b4a66" stroke-width="0.4"'));
  for (const l of dataset.seaLanes) {
    const stroke = l.manual ? '#7b2cbf' : '#0b3c8c';
    const d = draw({ type: 'LineString', coordinates: [l.from, l.to] });
    out.push(svgPath(d, `fill="none" stroke="${stroke}" stroke-width="1.6" stroke-dasharray="5,3"`, `${l.a}–${l.b}`));
  }
  for (const t of dataset.territories) {
    const p = projection(t.anchor);
    if (!p || p[0] < 0 || p[1] < 0 || p[0] > view.width || p[1] > view.height) continue;
    const [x, y] = [p[0].toFixed(1), p[1].toFixed(1)];
    if (t.micro) out.push(`<circle cx="${x}" cy="${y}" r="4" fill="${rampOf(t.value)}" stroke="#000"/>`);
    if (view.labels || t.value >= 10) {
      const style = `font-family="Helvetica" font-size="${view.labels ? 11 : 10}" text-anchor="middle"`;
      const halo = 'fill="#000" stroke="#fff" stroke-width="2.5" paint-order="stroke"';
      out.push(`<text x="${x}" y="${(p[1] - 6).toFixed(1)}" ${style} ${halo}>${t.id} ${t.value}</text>`);
    }
  }
  out.push('</g>', '</svg>');
  return out.filter(Boolean).join('\n');
}

function main(): void {
  const views = [...VIEWS];
  const custom = process.argv.slice(2).find((a) => /^-?[\d.]+(,-?[\d.]+){3}$/.test(a));
  if (custom) {
    const bbox = custom.split(',').map(Number) as [number, number, number, number];
    views.push({ name: 'preview-custom', width: 1400, height: 1400, bbox, labels: true });
  }
  const index = JSON.parse(readFileSync(path.join(DATASETS_DIR, 'index.json'), 'utf8')) as { latest: string };
  const dir = path.join(DATASETS_DIR, index.latest);
  const dataset = JSON.parse(readFileSync(path.join(dir, 'territories.json'), 'utf8')) as Dataset;
  const topology = JSON.parse(readFileSync(path.join(dir, 'map.topo.json'), 'utf8')) as Topology;
  mkdirSync(RAW_DIR, { recursive: true });
  for (const view of views) {
    const file = path.join(RAW_DIR, `${view.name}.svg`);
    writeFileSync(file, render(dataset, topology, view));
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
    if (process.platform !== 'darwin') continue;
    try {
      const size = String(Math.max(view.width, view.height));
      execFileSync('qlmanage', ['-t', '-s', size, '-o', RAW_DIR, file], { stdio: 'ignore' });
      console.log(`  -> ${path.relative(process.cwd(), file)}.png`);
    } catch {
      console.log('  (QuickLook conversion failed; open the SVG instead)');
    }
  }
}

main();
