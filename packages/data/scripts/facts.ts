/**
 * Builds the figures table the statistics pages show beside the dataset's own figures: arsenals
 * from Global Firepower, energy from Our World in Data. No rule reads it, so it never changes a
 * game, and it serves every dataset version. Usage: `pnpm --filter @empire/data facts [--refresh]`.
 */
import { FACT_KEYS, type Fact, type FactKey, type FactTable } from '@empire/rules';
import path from 'node:path';
import { cachedText } from './lib/cache';
import { applyCanon, type TerritoryPlan } from './lib/canon';
import { loadCanon, loadFacts } from './lib/config';
import { loadNaturalEarth } from './lib/naturalearth';
import { formatJson, stableGeneratedAt, writeText } from './lib/output';
import { FACTS_DIR } from './lib/paths';
import { fmt } from './lib/stats';

// Both sources are pinned to a commit, so a rebuild reads the same figures until these move.
const GFP_REPO = 'nupurmadaan04/unified-military-analytics';
const GFP_COMMIT = 'b3d04fb5e514f1182957b37f55bc70037a8ebf80';
const GFP_URL = `https://raw.githubusercontent.com/${GFP_REPO}/${GFP_COMMIT}/data/military_cleaned.csv`;
const GFP_YEAR = 2025;
const OWID_COMMIT = 'f8de88a4f6f9cab44f1cf606047cbd6c4414042c';
const OWID_URL = `https://raw.githubusercontent.com/owid/energy-data/${OWID_COMMIT}/owid-energy-data.csv`;

/**
 * Our World in Data gives oil and gas in terawatt-hours, and they are better known by volume. Gas
 * converts exactly: the Energy Institute counts a billion cubic metres as 36 PJ, which is 10 TWh.
 * Oil only roughly: its terawatt-hours are tonnes (11.63 TWh to a million tonnes), and a tonne runs
 * from under 7 barrels of heavy crude to over 8 of natural gas liquids. This is the world's average,
 * the Energy Institute's 97 million barrels a day in 2024 over the file's 52,831 TWh: within about
 * 10% of the big producers' own counts (the United States, rich in light liquids, comes out 9% low).
 */
const MILLION_M3_PER_TWH = 100;
const MILLION_BARRELS_PER_TWH = 0.67;

/**
 * Where each figure is read from, a Global Firepower column or an Our World in Data one, and what
 * to multiply it by for the figure's unit.
 */
const COLUMNS: Record<FactKey, { from: 'gfp' | 'owid'; columns: string[]; scale?: number }> = {
  activePersonnel: { from: 'gfp', columns: ['active_personnel'] },
  tanks: { from: 'gfp', columns: ['tanks'] },
  // Global Firepower counts multirole jets such as the F-35 as attack aircraft, which would leave
  // Norway and the Netherlands with no fighters, so the two are added up.
  combatAircraft: { from: 'gfp', columns: ['fighter_aircraft', 'attack_aircraft'] },
  navalShips: { from: 'gfp', columns: ['total_naval_fleet'] },
  oilMillionBarrels: { from: 'owid', columns: ['oil_production'], scale: MILLION_BARRELS_PER_TWH },
  gasMillionM3: { from: 'owid', columns: ['gas_production'], scale: MILLION_M3_PER_TWH },
  electricityTwh: { from: 'owid', columns: ['electricity_generation'] },
};

const GFP_SOURCE = `Global Firepower ${GFP_YEAR}`;
const OWID_SOURCE = 'Our World in Data';
const SOURCES: Record<FactKey, string> = {
  activePersonnel: `${GFP_SOURCE}, active personnel`,
  tanks: `${GFP_SOURCE}, combat tanks`,
  combatAircraft: `${GFP_SOURCE}, fighters, interceptors and attack aircraft`,
  navalShips: `${GFP_SOURCE}, total naval assets`,
  oilMillionBarrels:
    `${OWID_SOURCE} (Energy Institute; The Shift Project), oil production, ` +
    `at ${MILLION_BARRELS_PER_TWH} million barrels a TWh`,
  gasMillionM3:
    `${OWID_SOURCE} (Energy Institute; The Shift Project), natural gas production, ` +
    `at ${MILLION_M3_PER_TWH} million m³ a TWh`,
  electricityTwh: `${OWID_SOURCE} (Ember; Energy Institute), electricity generation`,
};

const ATTRIBUTION = [
  `Global Firepower (globalfirepower.com), ${GFP_YEAR} edition, via the ${GFP_REPO} scrape on GitHub.`,
  'Our World in Data energy dataset (CC BY 4.0), from the Energy Institute Statistical Review of World Energy, ' +
    'Ember and The Shift Project.',
];

type Built = FactTable;
type Figures = Map<string, Map<FactKey, Fact>>;

/** Rows of a CSV with a header line, quoted fields allowed. */
function parseCsv(text: string, name: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [header, ...body] = rows;
  if (!header) throw new Error(`${name}: empty file`);
  const columns = header.map((h) => h.replace(/^﻿/, '').trim());
  return body.map((cells) => Object.fromEntries(columns.map((c, i) => [c, cells[i]?.trim() ?? ''])));
}

function requireColumns(rows: Record<string, string>[], columns: string[], name: string): void {
  const missing = columns.filter((c) => !(c in (rows[0] ?? {})));
  if (missing.length > 0) throw new Error(`${name}: missing columns ${missing.join(', ')}`);
}

/** A plain number, or null for an empty or unreadable cell. */
function numberOf(cell: string | undefined): number | null {
  if (cell === undefined || cell.trim() === '') return null;
  const n = Number(cell.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The sum of a row's columns for one figure in its unit, or null when any of them is empty. */
function valueOf(row: Record<string, string>, key: FactKey): number | null {
  let total = 0;
  for (const column of COLUMNS[key].columns) {
    const n = numberOf(row[column]);
    if (n === null) return null;
    total += n;
  }
  return total * (COLUMNS[key].scale ?? 1);
}

function put(figures: Figures, code: string, key: FactKey, fact: Fact): void {
  if (!figures.has(code)) figures.set(code, new Map());
  figures.get(code)!.set(key, fact);
}

/** Global Firepower's countries by statistics code: names matched to the canon, or through facts.yaml. */
function readGfp(text: string, plans: readonly TerritoryPlan[], names: ReadonlyMap<string, string>): Figures {
  const rows = parseCsv(text, 'Global Firepower');
  const keys = FACT_KEYS.filter((k) => COLUMNS[k].from === 'gfp');
  requireColumns(rows, ['country', ...keys.flatMap((k) => COLUMNS[k].columns)], 'Global Firepower');
  const byName = new Map<string, string>();
  for (const p of plans) {
    if (p.statsCodes.includes(p.id)) byName.set(p.name, p.id);
    for (const m of p.members) if (p.statsCodes.includes(m.id)) byName.set(m.name, m.id);
  }
  const codes = new Set(plans.flatMap((p) => p.statsCodes));
  const figures: Figures = new Map();
  const problems: string[] = [];
  for (const row of rows) {
    const name = row['country']!;
    const code = names.get(name) ?? byName.get(name);
    if (!code) {
      problems.push(`"${name}" matches no territory: add it to gfp_names in facts.yaml`);
      continue;
    }
    if (!codes.has(code)) {
      problems.push(`"${name}" is mapped to ${code}, which is not a statistics code (see canon.yaml)`);
      continue;
    }
    if (figures.has(code)) problems.push(`${code} appears twice ("${name}")`);
    for (const key of keys) {
      const value = valueOf(row, key);
      if (value !== null) put(figures, code, key, { value, year: GFP_YEAR });
    }
  }
  for (const name of names.keys()) {
    if (!rows.some((r) => r['country'] === name)) problems.push(`facts.yaml gfp_names: "${name}" is not in the source`);
  }
  if (problems.length > 0) throw new Error(`Global Firepower names:\n  - ${problems.join('\n  - ')}`);
  return figures;
}

/** Our World in Data's most recent figure of each column, by statistics code. */
function readOwid(text: string, codesByName: ReadonlyMap<string, string>): Figures {
  const rows = parseCsv(text, 'Our World in Data');
  const keys = FACT_KEYS.filter((k) => COLUMNS[k].from === 'owid');
  requireColumns(
    rows,
    ['country', 'iso_code', 'year', ...keys.flatMap((k) => COLUMNS[k].columns)],
    'Our World in Data',
  );
  for (const name of codesByName.keys()) {
    if (!rows.some((r) => r['country'] === name))
      throw new Error(`facts.yaml owid_names: "${name}" is not in the source`);
  }
  const figures: Figures = new Map();
  for (const row of rows) {
    const iso = row['iso_code']!;
    // Rows without an ISO code are regions and aggregates, apart from the economies facts.yaml names.
    const code = codesByName.get(row['country']!) ?? (iso === '' || iso.startsWith('OWID_') ? null : iso);
    const year = Number(row['year']);
    if (!code || !Number.isInteger(year)) continue;
    for (const key of keys) {
      const value = valueOf(row, key);
      if (value === null) continue;
      const known = figures.get(code)?.get(key);
      if (!known || (known.year ?? 0) < year) put(figures, code, key, { value, year });
    }
  }
  return figures;
}

/** A territory's figure: the sum over its statistics codes that have one, or null when none does. */
function aggregate(plan: TerritoryPlan, key: FactKey, figures: Figures): { fact: Fact | null; missing: string[] } {
  const parts = plan.statsCodes.flatMap((code) => figures.get(code)?.get(key) ?? []);
  const missing = plan.statsCodes.filter((code) => !figures.get(code)?.has(key));
  if (parts.length === 0) return { fact: null, missing };
  const value = parts.reduce((sum, p) => sum + p.value, 0);
  const years = parts.flatMap((p) => (p.year === null ? [] : [p.year]));
  return {
    fact: { value: Math.round(value * 1000) / 1000, year: years.length > 0 ? Math.max(...years) : null },
    missing,
  };
}

function renderReport(table: FactTable, plans: readonly TerritoryPlan[], notes: string[]): string {
  const cell = (f: Fact | undefined) => (f ? `${fmt(f.value)}${f.year === null ? '' : ` (${f.year})`}` : '—');
  const lines = [
    '# Arsenals and energy',
    '',
    'Generated by `pnpm --filter @empire/data facts` from the sources below. The statistics pages show these figures; ' +
      'no rule reads them. A territory sums the figures of its statistics codes (see `canon.yaml`); — means none of ' +
      'them has one.',
    '',
    '## Sources',
    '',
    ...FACT_KEYS.map((k) => `- \`${k}\`: ${table.sources[k]}`),
    '',
    ...table.attribution.map((a) => `- ${a}`),
    '',
    `Global Firepower: ${GFP_URL}`,
    '',
    `Our World in Data: ${OWID_URL}`,
    '',
    '## Notes',
    '',
    ...(notes.length > 0 ? notes.map((n) => `- ${n}`) : ['None.']),
    '',
    '## Figures',
    '',
    `| Territory | ${FACT_KEYS.join(' | ')} |`,
    `| --- | ${FACT_KEYS.map(() => '---:').join(' | ')} |`,
    ...plans.map(
      (p) => `| ${p.id} ${p.name} | ${FACT_KEYS.map((k) => cell(table.territories[p.id]?.[k])).join(' | ')} |`,
    ),
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const refresh = process.argv.includes('--refresh');
  const opts = { refresh };
  const config = loadFacts();
  const ne = await loadNaturalEarth(opts);
  const { plans } = applyCanon(ne.features, loadCanon());

  const gfp = readGfp(await cachedText(GFP_URL, 'gfp_military.csv', opts), plans, config.gfpNames);
  const owid = readOwid(await cachedText(OWID_URL, 'owid_energy.csv', opts), config.owidNames);

  const notes: string[] = [];
  const territories: FactTable['territories'] = {};
  for (const plan of plans) {
    const entry: Partial<Record<FactKey, Fact>> = {};
    const gaps = new Map<string, FactKey[]>();
    for (const key of FACT_KEYS) {
      const { fact, missing } = aggregate(plan, key, COLUMNS[key].from === 'gfp' ? gfp : owid);
      if (fact) entry[key] = fact;
      // Dependencies without forces of their own simply have none, so only energy notes the gaps.
      if (fact && missing.length > 0 && COLUMNS[key].from === 'owid') {
        const codes = missing.join(', ');
        gaps.set(codes, [...(gaps.get(codes) ?? []), key]);
      }
    }
    for (const [codes, keys] of gaps) notes.push(`${plan.id}: no ${keys.join(', ')} figure for ${codes}`);
    territories[plan.id] = entry;
  }
  const without = plans.filter((p) => !FACT_KEYS.some((k) => COLUMNS[k].from === 'gfp' && territories[p.id]![k]));
  notes.unshift(
    `Not in Global Firepower (${without.length}): ${without.map((p) => p.id).join(', ')}`,
    `Global Firepower names matched through facts.yaml: ${[...config.gfpNames].map(([n, c]) => `${n} → ${c}`).join(', ')}`,
  );

  const target = path.join(FACTS_DIR, 'facts.json');
  const table = stableGeneratedAt<Built>(target, {
    generatedAt: new Date().toISOString(),
    attribution: ATTRIBUTION,
    sources: SOURCES,
    territories,
  });
  writeText(target, formatJson(table));
  writeText(path.join(FACTS_DIR, 'REPORT.md'), renderReport(table, plans, notes));
  const counts = FACT_KEYS.map((k) => `${k} ${plans.filter((p) => territories[p.id]![k]).length}`);
  console.log(`• Figures for ${plans.length} territories: ${counts.join(', ')}`);
  console.log(`• Wrote ${path.relative(process.cwd(), target)}`);
}

main().catch((err: unknown) => {
  console.error(`\nFacts build failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
