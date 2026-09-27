# @empire/data

The map and country-data pipeline for Empire Chess. It turns Natural Earth shapes, World Bank
statistics and a handful of hand-edited decisions into a versioned dataset: every territory with
its neighbors, sea lanes, terrain, game value and real-world figures, plus a TopoJSON map.

```
pnpm --filter @empire/data generate            # build datasets/<version>/ (offline after the first run)
pnpm --filter @empire/data generate --refresh  # re-download all sources first
pnpm --filter @empire/data test                # check the committed dataset
pnpm --filter @empire/data preview             # render SVG/PNG previews into raw/
pnpm --filter @empire/data openings            # build openings/openings.json (offline after the first run)
```

Downloads are cached in `raw/` (gitignored), so rebuilding is fast and needs no network. Only
`--refresh` fetches the sources again; review `REPORT.md` afterwards, since new World Bank data
can move values and a changed Natural Earth file can fail the canon check (by design).

## Outputs

`datasets/index.json` lists the versions and names the latest. Each version directory holds:

| File               | What it is                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `territories.json` | The `Dataset` defined in `packages/rules/src/dataset.ts`: territories sorted by id, neighbor lists sorted, sea lanes sorted by `a`, `b` with `a < b`. Only `generatedAt` changes between identical builds, and it is kept when nothing else changed.                                        |
| `map.topo.json`    | TopoJSON with one object, `territories`: a GeometryCollection with one geometry per territory, `id` = territory id, `properties.name`. Unprojected lon/lat, simplified and quantized (about 330 KB). Shared borders are shared arcs, so borders and coastlines come straight from `mesh()`. |
| `REPORT.md`        | The human review report: every canon decision, every sea lane with its distance, validation results, the value table and histogram, and where every statistic came from.                                                                                                                    |

In the web client:

```ts
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

const object = topology.objects.territories;
const land = feature(topology, object); // one Feature per territory, id = territory id
const borders = mesh(topology, object, (a, b) => a !== b);
const coasts = mesh(topology, object, (a, b) => a === b);
const path = geoPath(geoNaturalEarth1());
```

Draw sea lanes as `path({ type: 'LineString', coordinates: [lane.from, lane.to] })` (d3 follows the
great circle) and a dot at `anchor` for territories with `micro: true`.

Natural Earth cuts Russia (Chukotka) and Fiji at the antimeridian, and the cut edges are arcs of a
single territory, so the coastline mesh includes them along ±180°. With the unrotated projection
that line is the map's edge; if you ever rotate the projection (a Pacific-centred view, a globe),
drop those arcs from the coastline mesh, for example by skipping mesh line segments whose points
all have |lon| = 180.

The opening names table is separate from the versioned datasets: `openings/openings.json` holds
every named position of the [Lichess openings list](https://github.com/lichess-org/chess-openings)
(CC0), each line played out with chessops and stored by its final position (`ChessGame.positionKey`
from `@empire/rules`), so games are named however they reached a position. The server names each
game's opening with it for the chess profiles. Campaigns don't pin it: a renamed opening is
harmless.

## What the build does

1. **Canon** (`config/canon.yaml`): every Natural Earth feature is kept, merged into another
   territory, bundled into a region or dropped; polygons can also be split out of a feature. The
   build fails if any feature is unaccounted for or used twice.
2. **Shapes**: the pieces of each territory are dissolved through a topology, so internal borders
   (Italy and San Marino, Somalia and Somaliland) disappear.
3. **Land borders**: territories whose geometries share an arc, via topojson `neighbors()` on the
   unsimplified topology, plus overrides from the canon.
4. **Sea lanes** (`config/sea-lanes.yaml`): coastline vertices (points on arcs used by one
   territory only) within the threshold of another territory's coastline, found with a 3D grid over
   unit vectors so the antimeridian needs no special case. A candidate is rejected when its
   great-circle segment crosses a third territory's land, and the next-closest pair is tried. Then
   the manual additions and removals are applied.
5. **Statistics** (`config/estimates.yaml`): World Bank WDI, most recent non-empty value per
   indicator. Merged territories and regions sum their members; a sum is withheld when members
   without the figure hold 10% or more of the population. Estimates fill gaps or replace misleading
   figures, each with its source; if an area is still missing it is computed from the geometry.
6. **Values** (`config/values.yaml`): a weighted score over log-scaled, normalized metrics,
   turned into 1-10 by rank against a target distribution, then hand overrides.
7. **Terrain and micro** (`config/terrain.yaml`, `canon.yaml` `micro`), and **anchors**: the pole
   of inaccessibility of each territory's largest polygon (hand-placed for regions).
8. **Checks**: `validateGraph` from `@empire/rules`, id format, values, lane symmetry, a list of
   well-known borders and lanes (`scripts/lib/expectations.ts`), and map geometry (non-empty,
   ids match, correct winding, size budget). Any failure stops the build before anything is written.
9. **Map**: Visvalingam simplification weighted by triangle area on a projected world map,
   keeping every island of 20 km² or more and every member's main island, then quantization.

## Editing the config

All five files are commented and meant to be read by the players. After any edit, run
`generate`, read the relevant part of `REPORT.md`, and run `preview` if you touched geometry or
lanes.

- **`canon.yaml`**: which territories exist, their names, and what is folded into what.
  - Rename: change the name next to the id.
  - Merge a feature into another territory: move its code under that territory's `merge:`.
  - Play a feature on its own: move it from `merge:`/`members:`/`drop:` to `countries:` or `territories:`.
  - Split polygons out of a feature: add a `parts:` entry with a `bbox` (whole polygons) or `south_of` (cut along a parallel), as done for Guadeloupe or Western Sahara.
  - `micro` sets the area below which a territory gets a dot; `land_borders` fixes source artefacts.
- **`sea-lanes.yaml`**: `threshold_km` for automatic lanes; `add` for manual lanes (optionally
  with `near` points to control where the dashed line is drawn); `remove` for silly automatic
  ones. Every entry needs a `reason`, which is printed in the report.
- **`estimates.yaml`**: figures for economies the World Bank lacks (keyed by the statistics code
  from `canon.yaml`), or `replace:` a World Bank figure with a reason. Never enter a number you
  cannot source; leave it out and the value formula copes. `adjustments` subtracts split-out parts
  (France's overseas departments) from the figures that include them.
- **`values.yaml`**: metric weights, the share of territories per value, and `overrides`
  (`ID: { value, reason }`).
- **`terrain.yaml`**: island includes/excludes and the hand-picked mountain list, with the
  criterion written at the top.

A new yearly dataset gets a new version: bump `VERSION` in `scripts/build.ts`, rebuild with
`--refresh`, and review. Campaigns snapshot the version they started with, so never edit a
published version in place.

## Attribution

The game must show `Dataset.attribution` (for example on an About screen):

- **Natural Earth**: public domain. Credit "Made with Natural Earth".
- **World Bank World Development Indicators**: CC BY 4.0, attribution required:
  "World Bank, World Development Indicators, CC BY 4.0".
- **Lichess openings list** (opening names): CC0, no attribution required, credited anyway.
- **Gap estimates**, listed per figure in `REPORT.md`: IMF World Economic Outlook, Eurostat
  (CC BY 4.0), Statistics Netherlands (CBS, CC BY 4.0), SIPRI Military Expenditure Database
  (free to use with attribution), INSEE, UN World Population Prospects via UNFPA, the CIA World
  Factbook (public domain), and the statistics offices of the Cook Islands, Niue, Tokelau and the
  Falkland Islands.

## Layout

```
config/            hand-edited decisions (YAML)
datasets/          committed outputs, one directory per version
openings/          the opening names table (committed output)
scripts/build.ts   the pipeline entry point
scripts/openings.ts builds the opening names table
scripts/preview.ts SVG/PNG previews for eyeballing the map
scripts/lib/       pipeline modules (canon, geometry, adjacency, sealanes, stats, values, ...)
test/              checks run against the latest committed dataset
raw/               download cache and previews (gitignored)
```
