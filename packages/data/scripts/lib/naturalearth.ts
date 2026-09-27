import type { FeatureCollection } from 'geojson';
import { cachedText, sha256, type FetchOptions } from './cache';
import type { PolygonCoords, Ring } from './types';

export const NE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const NE_FILE = 'ne_50m_admin_0_countries.geojson';

export interface NeFeature {
  /** ADM0_A3: unique per feature, and how config files refer to NE features. */
  code: string;
  /** NE short name (NAME), abbreviated in places ("Dem. Rep. Congo"). */
  name: string;
  /** ISO_A3, falling back to ISO_A3_EH; null when both are "-99" (Kosovo, Somaliland, ...). */
  iso3: string | null;
  /** TYPE, e.g. "Sovereign country", "Dependency", "Disputed". */
  type: string;
  continent: string;
  subregion: string;
  polygons: PolygonCoords[];
}

export interface NaturalEarth {
  features: NeFeature[];
  sha256: string;
}

function validIso(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : null;
}

export async function loadNaturalEarth(opts: FetchOptions): Promise<NaturalEarth> {
  const text = await cachedText(NE_URL, NE_FILE, opts);
  const fc = JSON.parse(text) as FeatureCollection;
  if (fc.type !== 'FeatureCollection') throw new Error(`${NE_FILE}: not a FeatureCollection`);
  const features: NeFeature[] = fc.features.map((f, i) => {
    const p = f.properties ?? {};
    const code = p['ADM0_A3'];
    if (typeof code !== 'string') throw new Error(`${NE_FILE}: feature ${i} has no ADM0_A3`);
    const g = f.geometry;
    let polygons: PolygonCoords[];
    if (g?.type === 'Polygon') polygons = [g.coordinates as Ring[]];
    else if (g?.type === 'MultiPolygon') polygons = g.coordinates as Ring[][];
    else throw new Error(`${NE_FILE}: ${code} has unsupported geometry ${g?.type ?? 'null'}`);
    return {
      code,
      name: String(p['NAME']),
      iso3: validIso(p['ISO_A3']) ?? validIso(p['ISO_A3_EH']),
      type: String(p['TYPE']),
      continent: String(p['CONTINENT']),
      subregion: String(p['SUBREGION']),
      polygons,
    };
  });
  const codes = new Set(features.map((f) => f.code));
  if (codes.size !== features.length) throw new Error(`${NE_FILE}: duplicate ADM0_A3 codes`);
  return { features, sha256: sha256(text) };
}
