/**
 * Builds a versioned dataset from Natural Earth shapes, World Bank statistics and the hand-edited
 * decisions in config/. Usage: `pnpm --filter @empire/data generate [--refresh]`.
 */
import { MAX_VALUE, validateGraph, type Dataset, type LonLat, type SeaLane, type Territory } from '@empire/rules';
import path from 'node:path';
import type { GeometryCollection } from 'topojson-specification';
import { coastline, landBorders } from './lib/adjacency';
import { anchorOf } from './lib/anchors';
import { applyCanon, type TerritoryPlan } from './lib/canon';
import { loadCanon, loadEstimates, loadSeaLanes, loadTerrain, loadValues } from './lib/config';
import { EXPECTED_LAND_BORDERS, EXPECTED_SEA_LANES } from './lib/expectations';
import { buildWorld, dissolve, multiPolygonAreaKm2, polygonAreaKm2 } from './lib/geometry';
import { buildMap, type MapSettings } from './lib/mapfile';
import { loadNaturalEarth } from './lib/naturalearth';
import { formatJson, stableGeneratedAt, updateIndex, writeText } from './lib/output';
import { DATASETS_DIR } from './lib/paths';
import { renderReport } from './lib/report';
import { seaLanes } from './lib/sealanes';
import { computeStats, loadWorldBank } from './lib/stats';
import { computeMicro, computeTerrain } from './lib/terrain';
import { pairKey } from './lib/types';
import { computeValues } from './lib/values';

const VERSION = '2026.3';

// Tuned to keep map.topo.json around 330 KB: detailed enough to zoom into Europe or the Caribbean
// on a phone while staying quick to download and render.
const MAP_SETTINGS: MapSettings = {
  minWeightPx2: 0.25,
  keepIslandKm2: 20,
  quantization: 1e5,
};

const MAP_MAX_BYTES = 600 * 1024;
const ID_PATTERN = /^[A-Z][A-Z0-9-]{1,19}$/;

const ATTRIBUTION = [
  'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.',
  'World Bank, World Development Indicators, CC BY 4.0.',
  'Gap estimates (listed in REPORT.md): IMF World Economic Outlook; Eurostat; Statistics Netherlands (CBS); ' +
    'SIPRI Military Expenditure Database; INSEE; UN World Population Prospects (via UNFPA); CIA World Factbook; ' +
    'statistics offices of the Cook Islands, Niue, Tokelau and the Falkland Islands.',
];

function step(message: string): void {
  console.log(`• ${message}`);
}

async function main(): Promise<void> {
  const refresh = process.argv.includes('--refresh');
  const opts = { refresh };

  step('Reading config');
  const canonCfg = loadCanon();
  const laneCfg = loadSeaLanes();
  const estimateCfg = loadEstimates();
  const valueCfg = loadValues();
  const terrainCfg = loadTerrain();

  step(refresh ? 'Downloading sources' : 'Loading sources (cached in raw/, --refresh to redownload)');
  const ne = await loadNaturalEarth(opts);
  const wb = await loadWorldBank(opts);

  step('Applying map canon');
  const { plans, report: canonReport } = applyCanon(ne.features, canonCfg);

  step('Dissolving and building topology');
  const shapes = dissolve(plans.flatMap((p) => p.pieces));
  const world = buildWorld(plans.map((p) => ({ id: p.id, name: p.name, coords: shapes.get(p.id)! })));
  const coords = world.ids.map((id) => shapes.get(id)!);

  step('Land borders');
  const land = landBorders(world, canonCfg.landBorders);

  step('Sea lanes');
  const coast = coastline(world);
  const lanes = seaLanes(world.ids, coords, coast, land.adjacency, laneCfg);

  step('Statistics');
  const geometryArea = new Map(world.ids.map((id, i) => [id, multiPolygonAreaKm2(coords[i]!)]));
  const stats = computeStats(plans, wb, estimateCfg, geometryArea);

  step('Values, terrain and anchors');
  const values = computeValues(
    plans.map((p) => ({ id: p.id, name: p.name, stats: stats.byId.get(p.id)!.stats })),
    valueCfg,
  );
  const valueById = new Map(values.rows.map((r) => [r.id, r.value]));
  const terrain = computeTerrain(world.ids, land.adjacency, terrainCfg);
  const micro = computeMicro(
    plans.map((p) => ({ id: p.id, kind: p.kind, areaKm2: stats.byId.get(p.id)!.stats.areaKm2 ?? 0 })),
    canonCfg.micro,
  );

  const sea = new Map(world.ids.map((id) => [id, new Set<string>()]));
  for (const l of lanes.lanes) {
    sea.get(l.a)!.add(l.b);
    sea.get(l.b)!.add(l.a);
  }
  const territories: Territory[] = plans.map((p) => {
    const s = stats.byId.get(p.id)!;
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      members: p.members,
      continent: p.continent,
      subregion: p.subregion,
      value: valueById.get(p.id)!,
      land: [...land.adjacency.get(p.id)!].sort(),
      sea: [...sea.get(p.id)!].sort(),
      terrain: terrain.terrain.get(p.id)!,
      micro: micro.get(p.id)!,
      anchor: p.anchor ?? anchorOf(shapes.get(p.id)!),
      stats: s.stats,
      statMeta: s.meta,
    };
  });
  const seaLaneList: SeaLane[] = lanes.lanes.map((l) => ({
    a: l.a,
    b: l.b,
    from: l.from,
    to: l.to,
    km: l.km,
    manual: l.manual,
  }));

  const dataDir = path.join(DATASETS_DIR, VERSION);
  const datasetFile = path.join(dataDir, 'territories.json');
  const dataset = stableGeneratedAt<Dataset>(datasetFile, {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    attribution: ATTRIBUTION,
    territories,
    seaLanes: seaLaneList,
  });

  step('Validating');
  const problems = validateDataset(dataset);
  if (problems.length > 0) throw new Error(`Dataset problems:\n  - ${problems.join('\n  - ')}`);

  step('Simplifying map');
  const map = buildMap(world, new Map(plans.map((p) => [p.id, p.name])), representatives(plans), MAP_SETTINGS);
  const mapIds = (map.topology.objects['territories'] as GeometryCollection).geometries.map((g) => String(g.id));
  if (JSON.stringify(mapIds) !== JSON.stringify(dataset.territories.map((t) => t.id))) {
    throw new Error('Map geometry ids do not match the dataset territory ids');
  }
  if (map.json.length > MAP_MAX_BYTES) {
    const kb = Math.round(map.json.length / 1024);
    throw new Error(`map.topo.json is ${kb} KB, over the ${MAP_MAX_BYTES / 1024} KB budget`);
  }

  step('Writing outputs');
  writeText(datasetFile, formatJson(dataset));
  writeText(path.join(dataDir, 'map.topo.json'), map.json);
  updateIndex(path.join(DATASETS_DIR, 'index.json'), VERSION);
  writeText(
    path.join(dataDir, 'REPORT.md'),
    renderReport({
      dataset,
      plans,
      canon: canonReport,
      canonCfg,
      land,
      lanes,
      laneCfg,
      stats,
      values,
      valueCfg,
      terrain,
      map,
      mapSettings: MAP_SETTINGS,
      sources: { neSha256: ne.sha256, wbLastUpdated: wb.lastUpdated },
    }),
  );

  const kinds = ['country', 'territory', 'region'].map(
    (k) => `${dataset.territories.filter((t) => t.kind === k).length} ${k}`,
  );
  const manual = dataset.seaLanes.filter((l) => l.manual).length;
  console.log(`\nDataset ${VERSION}: ${dataset.territories.length} territories (${kinds.join(', ')})`);
  console.log(`  sea lanes: ${dataset.seaLanes.length} (${dataset.seaLanes.length - manual} auto, ${manual} manual)`);
  console.log(`  map: ${Math.round(map.json.length / 1024)} KB, ${map.points.after} of ${map.points.before} points`);
  const notes = [...land.notes, ...lanes.notes, ...terrain.notes];
  if (notes.length > 0) console.log(`  notes:\n    - ${notes.join('\n    - ')}`);
}

/** One vertex of each piece's largest polygon, so the map keeps every member's main island. */
function representatives(plans: readonly TerritoryPlan[]): Map<string, LonLat[]> {
  return new Map(
    plans.map((p) => [
      p.id,
      p.pieces
        .map((piece) => [...piece.polygons].sort((a, b) => polygonAreaKm2(b) - polygonAreaKm2(a))[0]?.[0]?.[0])
        .filter((v): v is LonLat => v !== undefined),
    ]),
  );
}

function validateDataset(dataset: Dataset): string[] {
  const problems = [...validateGraph(dataset)];
  const byId = new Map(dataset.territories.map((t) => [t.id, t]));
  for (const t of dataset.territories) {
    if (!ID_PATTERN.test(t.id)) problems.push(`${t.id}: invalid id`);
    if (!Number.isInteger(t.value) || t.value < 1 || t.value > MAX_VALUE) problems.push(`${t.id}: value ${t.value}`);
  }
  const lanes = new Set(dataset.seaLanes.map((l) => pairKey(l.a, l.b)));
  for (const l of dataset.seaLanes) {
    if (!(l.a < l.b)) problems.push(`sea lane ${l.a}–${l.b} is not ordered`);
    if (!byId.get(l.a)?.sea.includes(l.b) || !byId.get(l.b)?.sea.includes(l.a)) {
      problems.push(`sea lane ${l.a}–${l.b} missing from the territories' sea lists`);
    }
  }
  for (const t of dataset.territories) {
    for (const n of t.sea) if (!lanes.has(pairKey(t.id, n))) problems.push(`${t.id}: sea neighbor ${n} has no lane`);
  }
  for (const [a, b] of EXPECTED_LAND_BORDERS) {
    if (!byId.get(a)?.land.includes(b)) problems.push(`expected land border ${a}–${b} is missing`);
  }
  for (const [a, b] of EXPECTED_SEA_LANES) {
    if (!lanes.has(pairKey(a, b))) problems.push(`expected sea lane ${a}–${b} is missing`);
  }
  return problems;
}

main().catch((err: unknown) => {
  console.error(`\nBuild failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
