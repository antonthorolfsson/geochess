import { STAT_KEYS, type RealStats, type StatKey, type StatMeta } from '@empire/rules';
import { cachedText, type FetchOptions } from './cache';
import type { TerritoryPlan } from './canon';
import type { EstimateSpec, EstimatesConfig } from './config';

const WB_INDICATORS: Record<StatKey, string> = {
  population: 'SP.POP.TOTL',
  areaKm2: 'AG.SRF.TOTL.K2',
  gdpNominalUsd: 'NY.GDP.MKTP.CD',
  gdpPppUsd: 'NY.GDP.MKTP.PP.CD',
  militarySpendingUsd: 'MS.MIL.XPND.CD',
  armedForces: 'MS.MIL.TOTL.P1',
};

const WB_SOURCE = 'World Bank WDI';
const MILITARY: readonly StatKey[] = ['militarySpendingUsd', 'armedForces'];
/** Members lacking a figure may hold at most this share of a territory's population before the sum is withheld. */
const MAX_MISSING_POPULATION_SHARE = 0.1;
const ROUNDING: Record<StatKey, number> = {
  population: 0,
  areaKm2: 1,
  gdpNominalUsd: 0,
  gdpPppUsd: 0,
  militarySpendingUsd: 0,
  armedForces: 0,
};

export interface Figure {
  value: number;
  year: number | null;
  estimated: boolean;
  source: string;
}

export interface WorldBank {
  figures: Map<string, Map<StatKey, Figure>>;
  lastUpdated: string;
}

interface WbRow {
  countryiso3code?: string;
  date?: string;
  value?: number | null;
}

export async function loadWorldBank(opts: FetchOptions): Promise<WorldBank> {
  const figures = new Map<string, Map<StatKey, Figure>>();
  let lastUpdated = '';
  for (const key of STAT_KEYS) {
    const code = WB_INDICATORS[key];
    const url = `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&mrnev=1&per_page=20000`;
    const json = JSON.parse(await cachedText(url, `wb_${code}.json`, opts)) as unknown;
    if (!Array.isArray(json) || !Array.isArray(json[1])) {
      throw new Error(`World Bank ${code}: unexpected response ${JSON.stringify(json).slice(0, 200)}`);
    }
    const meta = json[0] as { lastupdated?: string; total?: number };
    const rows = json[1] as WbRow[];
    if (meta.total !== undefined && rows.length < meta.total) {
      throw new Error(`World Bank ${code}: response is paginated`);
    }
    if (meta.lastupdated && meta.lastupdated > lastUpdated) lastUpdated = meta.lastupdated;
    for (const row of rows) {
      const iso = row.countryiso3code;
      if (!iso || row.value === null || row.value === undefined) continue;
      if (!figures.has(iso)) figures.set(iso, new Map());
      figures.get(iso)!.set(key, { value: row.value, year: Number(row.date), estimated: false, source: WB_SOURCE });
    }
  }
  return { figures, lastUpdated };
}

export interface TerritoryStats {
  stats: RealStats;
  meta: Record<StatKey, StatMeta>;
}

export interface StatsResult {
  byId: Map<string, TerritoryStats>;
  notes: string[];
}

function evaluate(spec: EstimateSpec, own: Map<StatKey, Figure>, wb: WorldBank): Figure | null {
  switch (spec.kind) {
    case 'value':
      return spec.value === null ? null : { value: spec.value, year: spec.year, estimated: true, source: spec.source };
    case 'eur':
      return { value: spec.eur * spec.usdPerEur, year: spec.year, estimated: true, source: spec.source };
    case 'ppp-ratio': {
      const nominal = own.get('gdpNominalUsd');
      const ref = wb.figures.get(spec.of);
      const refPpp = ref?.get('gdpPppUsd');
      const refNominal = ref?.get('gdpNominalUsd');
      if (!nominal || !refPpp || !refNominal) return null;
      return {
        value: nominal.value * (refPpp.value / refNominal.value),
        year: nominal.year,
        estimated: true,
        source: spec.source,
      };
    }
  }
}

/** Figures per statistics component: World Bank first, estimates for gaps or where they replace it. */
function resolveComponents(
  codes: Iterable<string>,
  wb: WorldBank,
  cfg: EstimatesConfig,
  notes: string[],
  nullSources: Map<string, string>,
): Map<string, Map<StatKey, Figure>> {
  const out = new Map<string, Map<StatKey, Figure>>();
  for (const code of codes) {
    const own = new Map<StatKey, Figure>();
    const estimates = cfg.estimates.get(code) ?? new Map<StatKey, EstimateSpec>();
    // PPP ratios need this component's nominal GDP, so resolve them last.
    const order = [...STAT_KEYS].sort(
      (a, b) => Number(estimates.get(a)?.kind === 'ppp-ratio') - Number(estimates.get(b)?.kind === 'ppp-ratio'),
    );
    for (const key of order) {
      const fromWb = wb.figures.get(code)?.get(key) ?? null;
      const spec = estimates.get(key);
      if (spec && (spec.replace !== null || !fromWb)) {
        const fig = evaluate(spec, own, wb);
        if (fig) own.set(key, fig);
        else nullSources.set(`${code}:${key}`, spec.source);
        if (spec.replace !== null && fromWb) {
          const was = `${fmt(fromWb.value)} (${fromWb.year})`;
          const now = fig ? fmt(fig.value) : 'no data';
          notes.push(`${code} ${key}: replaced World Bank ${was} with ${now} — ${spec.replace}`);
        }
      } else if (fromWb) {
        own.set(key, fromWb);
        if (spec) {
          const now = `${fmt(fromWb.value)} (${fromWb.year})`;
          notes.push(`${code} ${key}: estimate unused, the World Bank now reports ${now}`);
        }
      }
    }
    out.set(code, own);
  }
  return out;
}

function applyAdjustments(components: Map<string, Map<StatKey, Figure>>, cfg: EstimatesConfig, notes: string[]): void {
  for (const [code, adj] of cfg.adjustments) {
    const own = components.get(code);
    if (!own) throw new Error(`estimates.yaml adjustments.${code}: not a statistics component of any territory`);
    for (const key of adj.stats) {
      const fig = own.get(key);
      if (!fig) continue;
      let subtracted = 0;
      const used: string[] = [];
      for (const other of adj.subtract) {
        if (!components.has(other)) throw new Error(`estimates.yaml adjustments.${code}: unknown component ${other}`);
        const part = components.get(other)?.get(key);
        if (!part) {
          notes.push(`${code} ${key}: nothing subtracted for ${other} (no figure)`);
          continue;
        }
        subtracted += part.value;
        used.push(other);
      }
      if (used.length === 0) continue;
      own.set(key, {
        value: fig.value - subtracted,
        year: fig.year,
        estimated: true,
        source: `${fig.source}, minus ${used.join(', ')}`,
      });
      notes.push(
        `${code} ${key}: ${fmt(fig.value)} minus ${fmt(subtracted)} for ${used.join(', ')}, because ${adj.reason}`,
      );
    }
  }
}

export function fmt(v: number): string {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v * 10) / 10);
}

function describeSources(parts: { code: string; fig: Figure }[], missing: string[], single: boolean): string {
  if (single && parts.length === 1 && missing.length === 0) return parts[0]!.fig.source;
  const bySource = new Map<string, string[]>();
  for (const { code, fig } of parts) bySource.set(fig.source, [...(bySource.get(fig.source) ?? []), code]);
  const chunks = [...bySource].map(([source, codes]) => `${source}: ${codes.join(' + ')}`);
  if (missing.length > 0) chunks.push(`no data: ${missing.join(', ')}`);
  return chunks.join('; ');
}

function aggregate(
  plan: TerritoryPlan,
  key: StatKey,
  components: Map<string, Map<StatKey, Figure>>,
  nullSources: ReadonlyMap<string, string>,
): { value: number | null; meta: StatMeta } {
  const parts: { code: string; fig: Figure }[] = [];
  const missing: string[] = [];
  let missingPopulation = 0;
  let totalPopulation = 0;
  for (const code of plan.statsCodes) {
    const figs = components.get(code);
    const pop = figs?.get('population')?.value ?? 0;
    totalPopulation += pop;
    const fig = figs?.get(key);
    if (fig) parts.push({ code, fig });
    else {
      missing.push(code);
      missingPopulation += pop;
    }
  }
  const single = plan.statsCodes.length === 1;
  if (parts.length === 0) {
    const reason = single ? nullSources.get(`${plan.statsCodes[0]!}:${key}`) : undefined;
    return { value: null, meta: { year: null, estimated: false, source: reason ? `No data: ${reason}` : 'No data' } };
  }
  // Dependencies without their own forces simply have none, so military figures are plain sums.
  const military = MILITARY.includes(key);
  if (!military && missing.length > 0 && missingPopulation >= MAX_MISSING_POPULATION_SHARE * totalPopulation) {
    return {
      value: null,
      meta: { year: null, estimated: false, source: `Incomplete, no data for ${missing.join(', ')}` },
    };
  }
  const value = parts.reduce((sum, p) => sum + p.fig.value, 0);
  const largest = parts.reduce((m, p) => (p.fig.value > m.fig.value ? p : m));
  const estimated = parts.some((p) => p.fig.estimated) || (!military && missing.length > 0);
  const f = 10 ** ROUNDING[key];
  return {
    value: Math.round(value * f) / f,
    meta: {
      year: largest.fig.year,
      estimated,
      source: describeSources(parts, military ? [] : missing, single),
    },
  };
}

export function computeStats(
  plans: readonly TerritoryPlan[],
  wb: WorldBank,
  cfg: EstimatesConfig,
  geometryAreaKm2: ReadonlyMap<string, number>,
): StatsResult {
  const notes: string[] = [];
  const codes = new Set(plans.flatMap((p) => p.statsCodes));
  for (const code of cfg.estimates.keys()) {
    if (!codes.has(code)) {
      throw new Error(`estimates.yaml estimates.${code}: not a statistics code of any territory (see canon.yaml)`);
    }
  }
  const nullSources = new Map<string, string>();
  const components = resolveComponents(codes, wb, cfg, notes, nullSources);
  applyAdjustments(components, cfg, notes);

  const byId = new Map<string, TerritoryStats>();
  for (const plan of plans) {
    const stats = {} as RealStats;
    const meta = {} as Record<StatKey, StatMeta>;
    for (const key of STAT_KEYS) {
      const { value, meta: m } = aggregate(plan, key, components, nullSources);
      stats[key] = value;
      meta[key] = m;
    }
    if (stats.areaKm2 === null) {
      const computed = geometryAreaKm2.get(plan.id);
      if (computed === undefined) throw new Error(`No geometry area for ${plan.id}`);
      stats.areaKm2 = Math.round(computed * 10) / 10;
      meta.areaKm2 = { year: null, estimated: true, source: 'Computed from Natural Earth geometry' };
      notes.push(`${plan.id} areaKm2: computed from geometry (${fmt(computed)} km²)`);
    }
    byId.set(plan.id, { stats, meta });
  }
  return { byId, notes };
}
