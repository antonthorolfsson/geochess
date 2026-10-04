'use client';

import { EMPIRE_COLORS, empireColor, type Dataset, type TerritoryId } from '@empire/rules';
import { select } from 'd3-selection';
// Adds selection.transition(), used for animated zooms.
import 'd3-transition';
import { zoom as d3Zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Topology } from 'topojson-specification';
import { W, buildGeometry, frameAround, union, type Bounds, type Geometry, type Shape } from '@/lib/map-geometry';
import { HATCH_TILE, HatchTile, patternRotation, svgId } from '../hatch';
import { FullscreenIcon } from '../ui';

const MAX_ZOOM = 40;
const OCEAN = '#16232b';
const UNCLAIMED = '#4b5320';
const INK = '#161b1e';
const PAPER = '#e4e2d8';
const AMBER = '#e3a92b';
const GREASE = '#c8372d';

export interface WorldMapProps {
  topo: Topology;
  dataset: Dataset;
  /** Empire color index of every claimed territory. */
  owners: ReadonlyMap<TerritoryId, number>;
  selectedId: TerritoryId | null;
  /** Territories to call out, such as legal draft picks. */
  highlighted: ReadonlySet<TerritoryId> | null;
  showValues: boolean;
  onSelect(id: TerritoryId | null): void;
  /** Set a new `nonce` to fly to a territory. */
  focus: { id: TerritoryId; nonce: number } | null;
  /** Set a new `nonce` to frame several territories at once, such as a mission's targets. */
  fit?: { ids: readonly TerritoryId[]; nonce: number } | null;
  /** Territories to frame when the map first appears, such as the player's empire. */
  initialFrame?: readonly TerritoryId[];
  /** Height in CSS pixels hidden behind a bottom sheet; framing and panning keep clear of it. */
  bottomInset?: number;
  /** The player's draft list, marked on the map with its order. */
  listed?: readonly TerritoryId[];
  /** Fortified countries, marked with a rampart under their label. */
  fortified?: readonly TerritoryId[];
  /** Active wars, drawn as grease-pencil arrows from the launching country to the target. */
  wars?: readonly MapWar[];
  onSelectWar?(warId: string): void;
  /** A stake being built: the stake is outlined and a dashed arrow points at the target. */
  preview?: { launchId: TerritoryId; targetId: TerritoryId; stake: readonly TerritoryId[] } | null;
  /**
   * A victory mission called out: its targets outlined in dashes, the countries that count now
   * filled, and a route (for connection missions) drawn through their label points.
   */
  mission?: MissionOverlayProps | null;
  /** A button with the zoom controls that makes the map fill the screen, and back. */
  fullscreen?: { on: boolean; toggle(): void };
}

export interface MissionOverlayProps {
  targets: readonly TerritoryId[];
  held: readonly TerritoryId[];
  path: readonly TerritoryId[] | null;
}

export interface MapWar {
  id: string;
  from: TerritoryId;
  to: TerritoryId;
  /** Declared but not yet fought: drawn dashed. */
  threat: boolean;
  /** The viewer is attacker or defender. */
  mine: boolean;
}

/** The visible area in viewBox units: the whole map, widened or heightened to the container's shape. */
function viewBoxFor(width: number, height: number, H: number): [number, number, number, number] {
  if (width <= 0 || height <= 0) return [0, 0, W, H];
  const aspect = width / height;
  if (aspect > W / H) {
    const vw = H * aspect;
    return [(W - vw) / 2, 0, vw, H];
  }
  const vh = W / aspect;
  return [0, (H - vh) / 2, W, vh];
}

/** Zoom transform that fits `bounds` inside the visible view box. */
function frame(bounds: Bounds, vb: [number, number, number, number], maxK = 12): ZoomTransform {
  const [[x0, y0], [x1, y1]] = bounds;
  const [vx, vy, vw, vh] = vb;
  const k = Math.max(1, Math.min(maxK, 0.8 * Math.min(vw / Math.max(x1 - x0, 1), vh / Math.max(y1 - y0, 1))));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return zoomIdentity.translate(vx + vw / 2 - k * cx, vy + vh / 2 - k * cy).scale(k);
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function WorldMap(props: WorldMapProps) {
  const {
    topo,
    dataset,
    owners,
    selectedId,
    highlighted,
    showValues,
    focus,
    initialFrame,
    bottomInset = 0,
    listed = [],
    fortified = [],
    wars = [],
    preview = null,
    mission = null,
    fit = null,
    fullscreen,
  } = props;
  const geo = useMemo(() => buildGeometry(topo, dataset), [topo, dataset]);
  const patternPrefix = svgId(useId());

  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const pxPerUnitRef = useRef(1);
  const framedRef = useRef(false);

  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [labelScale, setLabelScale] = useState(1);
  const [hovered, setHovered] = useState<TerritoryId | null>(null);

  const onSelectRef = useRef(props.onSelect);
  const onSelectWarRef = useRef(props.onSelectWar);
  useEffect(() => {
    onSelectRef.current = props.onSelect;
    onSelectWarRef.current = props.onSelectWar;
  });
  const select_ = useCallback((id: TerritoryId | null) => onSelectRef.current(id), []);
  const selectWar = useCallback((id: string) => onSelectWarRef.current?.(id), []);

  const vb = useMemo(() => viewBoxFor(size.width, size.height, geo.H), [size, geo.H]);

  /** The part of the view box that isn't hidden behind a bottom sheet. */
  const visibleBox = useCallback((): [number, number, number, number] => {
    const hidden = Math.min(bottomInset / pxPerUnitRef.current, vb[3] * 0.7);
    return [vb[0], vb[1], vb[2], vb[3] - hidden];
  }, [bottomInset, vb]);

  /** Keeps markers, labels and hatching the same size on screen at any zoom. */
  const applyScreenScale = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const px = pxPerUnitRef.current * transformRef.current.k;
    svg.style.setProperty('--k', String(px));
    for (const p of svg.querySelectorAll<SVGPatternElement>('pattern[data-rot]')) {
      p.setAttribute('patternTransform', `scale(${1 / px}) rotate(${p.dataset.rot})`);
    }
  }, []);

  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    pxPerUnitRef.current = size.width > 0 ? size.width / vb[2] : 1;
    applyScreenScale();
    setLabelScale(pxPerUnitRef.current * transformRef.current.k);
  }, [size, vb, applyScreenScale]);

  useEffect(() => {
    const svg = svgRef.current;
    const viewport = viewportRef.current;
    if (!svg || !viewport) return;
    const behavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, MAX_ZOOM])
      .translateExtent([
        [0, 0],
        [W, geo.H],
      ])
      .clickDistance(6)
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        transformRef.current = event.transform;
        viewport.setAttribute('transform', event.transform.toString());
        applyScreenScale();
      })
      .on('end', () => setLabelScale(pxPerUnitRef.current * transformRef.current.k));
    zoomRef.current = behavior;
    select(svg).call(behavior);
    return () => {
      select(svg).on('.zoom', null);
    };
  }, [geo, applyScreenScale]);

  /** Keeps a programmatic transform inside the pan limits (d3-zoom only enforces them for gestures). */
  const clamp = useCallback(
    (transform: ZoomTransform): ZoomTransform => {
      const behavior = zoomRef.current;
      if (!behavior) return transform;
      const [vx, vy, vw, vh] = visibleBox();
      return behavior.constrain()(
        transform,
        [
          [vx, vy],
          [vx + vw, vy + vh],
        ],
        behavior.translateExtent(),
      );
    },
    [visibleBox],
  );

  // Pan and zoom limits apply to the unobstructed part of the map, so a country can always be
  // brought out from under a bottom sheet.
  useEffect(() => {
    const [vx, vy, vw, vh] = visibleBox();
    zoomRef.current?.extent([
      [vx, vy],
      [vx + vw, vy + vh],
    ]);
  }, [visibleBox, geo]);

  // Frame the player's empire (or fill a portrait screen) once the size is known.
  useEffect(() => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (framedRef.current || !svg || !behavior || size.width === 0) return;
    framedRef.current = true;
    const target = union(
      (initialFrame ?? []).map((id) => geo.byId.get(id)?.bounds).filter((b): b is Bounds => b !== undefined),
    );
    let transform = target ? frame(target, vb, 5) : zoomIdentity;
    // On tall screens (phones), zoom in at least far enough to fill the height rather than show
    // a thin strip of world; center on the empire, or on Europe and Africa before the draft.
    const fillK = Math.min(vb[3] / geo.H, MAX_ZOOM);
    if (fillK > 1.2 && transform.k < fillK) {
      const cx = target ? (target[0][0] + target[1][0]) / 2 : W * 0.52;
      transform = zoomIdentity
        .translate(vb[0] + vb[2] / 2 - fillK * cx, vb[1] + vb[3] / 2 - (fillK * geo.H) / 2)
        .scale(fillK);
    }
    select(svg).call(behavior.transform, clamp(transform));
  }, [size, vb, geo, initialFrame, clamp]);

  useEffect(() => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    const shape = focus && geo.byId.get(focus.id);
    if (!svg || !behavior || !shape) return;
    const next = clamp(frame(shape.bounds, visibleBox(), shape.micro ? 16 : 8));
    if (prefersReducedMotion()) select(svg).call(behavior.transform, next);
    else select(svg).transition().duration(650).call(behavior.transform, next);
    // Only react to new focus requests, not to resizes.
  }, [focus?.nonce]);

  useEffect(() => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    const bounds = fit && frameAround(geo, fit.ids);
    if (!svg || !behavior || !bounds) return;
    const next = clamp(frame(bounds, visibleBox(), 8));
    if (prefersReducedMotion()) select(svg).call(behavior.transform, next);
    else select(svg).transition().duration(650).call(behavior.transform, next);
    // Only react to new requests, not to resizes.
  }, [fit?.nonce]);

  // A country tapped low on a phone would end up under the sheet that opens; slide it into view.
  useEffect(() => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    const shape = selectedId ? geo.byId.get(selectedId) : undefined;
    if (!svg || !behavior || !shape || bottomInset === 0) return;
    const [vx, vy, vw, vh] = visibleBox();
    const t = transformRef.current;
    const cx = t.applyX((shape.bounds[0][0] + shape.bounds[1][0]) / 2);
    const cy = t.applyY((shape.bounds[0][1] + shape.bounds[1][1]) / 2);
    const margin = vh * 0.12;
    if (cy > vy + margin && cy < vy + vh - margin && cx > vx && cx < vx + vw) return;
    const dx = cx < vx || cx > vx + vw ? vx + vw / 2 - cx : 0;
    const dy = vy + vh / 2 - cy;
    select(svg)
      .transition()
      .duration(prefersReducedMotion() ? 0 : 300)
      .call(behavior.translateBy, dx / t.k, dy / t.k);
  }, [selectedId, bottomInset, geo, visibleBox]);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    if (svg && zoomRef.current)
      select(svg)
        .transition()
        .duration(prefersReducedMotion() ? 0 : 250)
        .call(zoomRef.current.scaleBy, factor);
  };
  const reset = () => {
    const svg = svgRef.current;
    if (svg && zoomRef.current)
      select(svg)
        .transition()
        .duration(prefersReducedMotion() ? 0 : 400)
        .call(zoomRef.current.transform, zoomIdentity);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior) return;
    const step = 60 / transformRef.current.k;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (move) select(svg).call(behavior.translateBy, move[0], move[1]);
    else if (event.key === '+' || event.key === '=') zoomBy(1.5);
    else if (event.key === '-' || event.key === '_') zoomBy(1 / 1.5);
    else if (event.key === '0') reset();
    else if (event.key === 'Escape') select_(null);
    else return;
    event.preventDefault();
  };

  const ownedBy = useMemo(() => {
    const byColor = new Map<number, string[]>();
    for (const [id, color] of owners) {
      const d = geo.byId.get(id)?.d;
      if (!d) continue;
      const list = byColor.get(color) ?? [];
      list.push(d);
      byColor.set(color, list);
    }
    return [...byColor].map(([color, ds]) => ({ color, d: ds.join('') }));
  }, [owners, geo]);

  const highlightPath = useMemo(
    () => (highlighted ? [...highlighted].map((id) => geo.byId.get(id)?.d ?? '').join('') : ''),
    [highlighted, geo],
  );

  const stakePath = useMemo(
    () => (preview ? preview.stake.map((id) => geo.byId.get(id)?.d ?? '').join('') : ''),
    [preview, geo],
  );

  const missionPaths = useMemo(() => {
    if (!mission) return null;
    const shapes = (ids: readonly TerritoryId[]) => ids.map((id) => geo.byId.get(id)?.d ?? '').join('');
    const anchors = (mission.path ?? []).flatMap((id) => {
      const anchor = geo.byId.get(id)?.anchor;
      return anchor ? [anchor] : [];
    });
    return {
      targets: shapes(mission.targets),
      held: shapes(mission.held),
      route: anchors.length > 1 ? `M${anchors.map(([x, y]) => `${x},${y}`).join('L')}` : '',
      micro: mission.targets.flatMap((id) => {
        const s = geo.byId.get(id);
        return s?.micro ? [s] : [];
      }),
    };
  }, [mission, geo]);

  const selected = selectedId ? geo.byId.get(selectedId) : undefined;
  const hover = hovered && hovered !== selectedId ? geo.byId.get(hovered) : undefined;
  const lanePaths = useMemo(() => {
    const all = geo.lanes.map((l) => l.d).join('');
    const active = selectedId
      ? geo.lanes
          .filter((l) => l.a === selectedId || l.b === selectedId)
          .map((l) => l.d)
          .join('')
      : '';
    return { all, active };
  }, [geo, selectedId]);

  return (
    <div ref={wrapperRef} className="relative h-full w-full overflow-hidden bg-gunmetal">
      <svg
        ref={svgRef}
        className="map-svg"
        viewBox={vb.join(' ')}
        tabIndex={0}
        role="application"
        aria-label="World map. Drag or use arrow keys to pan, pinch or use plus and minus to zoom."
        onKeyDown={onKeyDown}
      >
        <defs>
          {EMPIRE_COLORS.map((c) => (
            <pattern
              key={c.index}
              id={`${patternPrefix}-${c.index}`}
              data-rot={patternRotation(c.pattern)}
              width={HATCH_TILE}
              height={HATCH_TILE}
              patternUnits="userSpaceOnUse"
            >
              <HatchTile pattern={c.pattern} size={HATCH_TILE} />
            </pattern>
          ))}
        </defs>
        <g ref={viewportRef}>
          <path d={geo.ocean} fill={OCEAN} onClick={() => select_(null)} />
          <path
            d={geo.graticule}
            className="nss"
            fill="none"
            stroke="rgba(228,226,216,0.07)"
            strokeWidth={1}
            pointerEvents="none"
          />
          <MicroHitAreas shapes={geo.shapes} onSelect={select_} />
          <TerritoryFills geo={geo} owners={owners} onSelect={select_} onHover={setHovered} />
          {ownedBy.map(({ color, d }) => (
            <path key={color} d={d} fill={`url(#${patternPrefix}-${color})`} pointerEvents="none" />
          ))}
          <path
            d={geo.borders}
            className="nss"
            fill="none"
            stroke={INK}
            strokeOpacity={0.85}
            strokeWidth={0.7}
            pointerEvents="none"
          />
          <path d={geo.coast} className="nss" fill="none" stroke="#0c1114" strokeWidth={0.9} pointerEvents="none" />
          <SeaLanes d={lanePaths.all} />
          {lanePaths.active && <SeaLanes d={lanePaths.active} active />}
          {highlightPath && (
            <path
              d={highlightPath}
              className="nss legal-outline"
              fill="rgba(227,169,43,0.22)"
              stroke={AMBER}
              strokeWidth={2}
              pointerEvents="none"
            />
          )}
          {hover && (
            <path
              d={hover.d}
              className="nss"
              fill="rgba(228,226,216,0.08)"
              stroke={PAPER}
              strokeOpacity={0.7}
              strokeWidth={1.2}
              pointerEvents="none"
            />
          )}
          {selected && (
            <g pointerEvents="none">
              <path d={selected.d} className="nss" fill="rgba(228,226,216,0.10)" stroke={INK} strokeWidth={4} />
              <path d={selected.d} className="nss" fill="none" stroke={PAPER} strokeWidth={2} />
            </g>
          )}
          <MicroDots
            shapes={geo.shapes}
            owners={owners}
            selectedId={selectedId}
            highlighted={highlighted}
            onSelect={select_}
          />
          {stakePath && (
            <path
              d={stakePath}
              className="nss"
              fill="rgba(227,169,43,0.18)"
              stroke={AMBER}
              strokeWidth={1.6}
              strokeDasharray="5 3"
              pointerEvents="none"
            />
          )}
          {missionPaths && (
            <g pointerEvents="none" aria-hidden="true">
              {missionPaths.targets && (
                <path
                  d={missionPaths.targets}
                  className="nss"
                  fill="rgba(228,226,216,0.07)"
                  stroke={PAPER}
                  strokeWidth={1.8}
                  strokeDasharray="6 3"
                />
              )}
              {missionPaths.held && (
                <path
                  d={missionPaths.held}
                  className="nss"
                  fill="rgba(228,226,216,0.22)"
                  stroke={PAPER}
                  strokeWidth={2.2}
                />
              )}
              {missionPaths.route && (
                <>
                  <path
                    d={missionPaths.route}
                    className="nss"
                    fill="none"
                    stroke={INK}
                    strokeWidth={4.5}
                    strokeLinecap="round"
                  />
                  <path
                    d={missionPaths.route}
                    className="nss"
                    fill="none"
                    stroke={PAPER}
                    strokeWidth={2}
                    strokeDasharray="1 5"
                    strokeLinecap="round"
                  />
                </>
              )}
              {missionPaths.micro.map((s) => (
                <g key={s.id} transform={`translate(${s.anchor[0]},${s.anchor[1]})`}>
                  <circle
                    className="counter-scale"
                    r={10}
                    fill="none"
                    stroke={PAPER}
                    strokeWidth={1.6}
                    strokeDasharray="3 2"
                  />
                </g>
              ))}
            </g>
          )}
          <WarArrows byId={geo.byId} wars={wars} preview={preview} onSelect={selectWar} />
          <Labels shapes={geo.shapes} scale={labelScale} showValues={showValues} />
          <DraftListMarkers byId={geo.byId} listed={listed} />
          <FortifiedMarkers byId={geo.byId} fortified={fortified} />
        </g>
      </svg>

      <div className="absolute top-3 right-3 flex flex-col overflow-hidden rounded-[3px] border border-line-strong bg-panel/90 shadow-lg backdrop-blur">
        <MapButton label="Zoom in" onClick={() => zoomBy(1.8)}>
          +
        </MapButton>
        <MapButton label="Zoom out" onClick={() => zoomBy(1 / 1.8)}>
          −
        </MapButton>
        {fullscreen && (
          <MapButton label={fullscreen.on ? 'Exit full screen' : 'Full screen'} onClick={fullscreen.toggle}>
            <FullscreenIcon on={fullscreen.on} />
          </MapButton>
        )}
        <MapButton label="Show the whole world" onClick={reset}>
          <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M3 10h14M10 3c-3 3.5-3 10.5 0 14M10 3c3 3.5 3 10.5 0 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
        </MapButton>
      </div>
    </div>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-11 items-center justify-center border-b border-line text-xl leading-none text-paper last:border-b-0 hover:bg-raised"
    >
      {children}
    </button>
  );
}

const TerritoryFills = memo(function TerritoryFills({
  geo,
  owners,
  onSelect,
  onHover,
}: {
  geo: Geometry;
  owners: ReadonlyMap<TerritoryId, number>;
  onSelect(id: TerritoryId): void;
  onHover(id: TerritoryId | null): void;
}) {
  return (
    <g aria-hidden="true">
      {geo.shapes.map((s) => {
        const color = owners.get(s.id);
        return (
          <path
            key={s.id}
            d={s.d}
            className="territory"
            fill={color === undefined ? UNCLAIMED : empireColor(color).hex}
            fillOpacity={color === undefined ? 1 : 0.9}
            onClick={() => onSelect(s.id)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(s.id)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && onHover(null)}
          />
        );
      })}
    </g>
  );
});

/** Generous invisible tap targets around microstates, beneath the land so real shapes win. */
const MicroHitAreas = memo(function MicroHitAreas({
  shapes,
  onSelect,
}: {
  shapes: Shape[];
  onSelect(id: TerritoryId): void;
}) {
  return (
    <g aria-hidden="true">
      {shapes
        .filter((s) => s.micro)
        .map((s) => (
          <g key={s.id} transform={`translate(${s.anchor[0]},${s.anchor[1]})`}>
            <circle className="counter-scale territory" r={22} fill="transparent" onClick={() => onSelect(s.id)} />
          </g>
        ))}
    </g>
  );
});

function MicroDots({
  shapes,
  owners,
  selectedId,
  highlighted,
  onSelect,
}: {
  shapes: Shape[];
  owners: ReadonlyMap<TerritoryId, number>;
  selectedId: TerritoryId | null;
  highlighted: ReadonlySet<TerritoryId> | null;
  onSelect(id: TerritoryId): void;
}) {
  return (
    <g aria-hidden="true">
      {shapes
        .filter((s) => s.micro)
        .map((s) => {
          const color = owners.get(s.id);
          const isSelected = s.id === selectedId;
          const isHighlighted = highlighted?.has(s.id) ?? false;
          return (
            <g key={s.id} transform={`translate(${s.anchor[0]},${s.anchor[1]})`}>
              <g className="counter-scale territory" onClick={() => onSelect(s.id)}>
                <circle r={11} fill="transparent" />
                <circle
                  r={isSelected ? 7 : 5.5}
                  fill={color === undefined ? UNCLAIMED : empireColor(color).hex}
                  stroke={isSelected ? PAPER : isHighlighted ? AMBER : INK}
                  strokeWidth={isSelected || isHighlighted ? 2 : 1.5}
                />
              </g>
            </g>
          );
        })}
    </g>
  );
}

/**
 * Sea lanes, the crossings that count as borders: dashes of map-room white on a dark casing, so
 * they read over open sea, over land at their ends, and over any empire's hatching. `active`
 * draws the selected country's lanes stronger.
 */
function SeaLanes({ d, active = false }: { d: string; active?: boolean }) {
  return (
    <g pointerEvents="none" aria-hidden="true">
      <path
        d={d}
        className="nss"
        fill="none"
        stroke={INK}
        strokeOpacity={active ? 0.85 : 0.6}
        strokeWidth={active ? 4.6 : 3.4}
        strokeLinecap="round"
      />
      <path
        d={d}
        className="nss"
        fill="none"
        stroke={PAPER}
        strokeOpacity={active ? 1 : 0.75}
        strokeWidth={active ? 2.2 : 1.5}
        strokeDasharray={active ? '7 4' : '5 4'}
      />
    </g>
  );
}

/** Numbered tags for the countries on the player's draft list, just above their labels. */
function DraftListMarkers({ byId, listed }: { byId: Geometry['byId']; listed: readonly TerritoryId[] }) {
  return (
    <g aria-hidden="true" pointerEvents="none">
      {listed.map((id, i) => {
        const shape = byId.get(id);
        if (!shape) return null;
        return (
          <g key={id} transform={`translate(${shape.anchor[0]},${shape.anchor[1]})`}>
            <g className="counter-scale">
              <g transform="translate(0,-17)">
                <circle r={8.5} fill="#1f2428" stroke={AMBER} strokeWidth={1.5} />
                <text textAnchor="middle" dy="0.35em" fontSize={10} fontWeight={700} fill={AMBER}>
                  {i + 1}
                </text>
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
}

/** A small rampart under each fortified country's label. */
function FortifiedMarkers({ byId, fortified }: { byId: Geometry['byId']; fortified: readonly TerritoryId[] }) {
  return (
    <g aria-hidden="true" pointerEvents="none">
      {fortified.map((id) => {
        const shape = byId.get(id);
        if (!shape) return null;
        return (
          <g key={id} transform={`translate(${shape.anchor[0]},${shape.anchor[1]})`}>
            <g className="counter-scale">
              <g transform="translate(0,15)">
                <path
                  d="M-7,5 L-7,-3 L-4.5,-3 L-4.5,-6 L-1.5,-6 L-1.5,-3 L1.5,-3 L1.5,-6 L4.5,-6 L4.5,-3 L7,-3 L7,5 Z"
                  fill={PAPER}
                  stroke={INK}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
}

/** Country names (and values) wherever there's room for them at the current zoom. */
const Labels = memo(function Labels({
  shapes,
  scale,
  showValues,
}: {
  shapes: Shape[];
  scale: number;
  showValues: boolean;
}) {
  const labels = [];
  for (const s of shapes) {
    const width = (s.bounds[1][0] - s.bounds[0][0]) * scale;
    const height = (s.bounds[1][1] - s.bounds[0][1]) * scale;
    const text = showValues ? `${s.name} · ${s.value}` : s.name;
    let content: string | null = null;
    let dx = 0;
    if (s.micro) {
      if (scale > 5) {
        content = text;
        dx = 10;
      } else if (showValues) {
        content = String(s.value);
        dx = 9;
      }
    } else if (width > text.length * 6.2 + 6 && height > 14) content = text;
    else if (showValues && width > 14 && height > 12) content = String(s.value);
    if (!content) continue;
    labels.push(
      <g key={s.id} transform={`translate(${s.anchor[0]},${s.anchor[1]})`}>
        <text
          className="counter-scale"
          x={dx}
          textAnchor={dx ? 'start' : 'middle'}
          dy="0.35em"
          fontSize={12}
          fontWeight={600}
          fill={PAPER}
          stroke="rgba(17,21,24,0.85)"
          strokeWidth={3}
          paintOrder="stroke"
          letterSpacing="0.03em"
        >
          {content}
        </text>
      </g>,
    );
  }
  return (
    <g aria-hidden="true" pointerEvents="none">
      {labels}
    </g>
  );
});

/**
 * The signature element: each active war as a hand-marked arrow in grease pencil, bowed to one
 * side like a stroke drawn across the map table. Threats not yet fought are dashed.
 */
function WarArrows({
  byId,
  wars,
  preview,
  onSelect,
}: {
  byId: Geometry['byId'];
  wars: readonly MapWar[];
  preview: WorldMapProps['preview'];
  onSelect(id: string): void;
}) {
  const arrows = wars.flatMap((w) => {
    const from = byId.get(w.from);
    const to = byId.get(w.to);
    return from && to ? [{ ...w, a: from.anchor, b: to.anchor }] : [];
  });
  const draft = preview && byId.get(preview.launchId) && byId.get(preview.targetId);
  return (
    <g aria-hidden="true">
      {arrows.map((w) => (
        <Arrow key={w.id} a={w.a} b={w.b} threat={w.threat} strong={w.mine} onClick={() => onSelect(w.id)} />
      ))}
      {draft && preview && (
        <Arrow a={byId.get(preview.launchId)!.anchor} b={byId.get(preview.targetId)!.anchor} threat strong preview />
      )}
    </g>
  );
}

function Arrow({
  a,
  b,
  threat,
  strong,
  preview = false,
  onClick,
}: {
  a: [number, number];
  b: [number, number];
  threat: boolean;
  strong: boolean;
  preview?: boolean;
  onClick?(): void;
}) {
  const [x0, y0] = a;
  const [x1, y1] = b;
  const dx = x1 - x0;
  const dy = y1 - y0;
  // Bow the stroke a fifth of its length to the left of its direction.
  const cx = (x0 + x1) / 2 - dy * 0.2;
  const cy = (y0 + y1) / 2 + dx * 0.2;
  const d = `M${x0},${y0} Q${cx},${cy} ${x1},${y1}`;
  const angle = (Math.atan2(y1 - cy, x1 - cx) * 180) / Math.PI;
  const width = strong ? 3.4 : 2.6;
  return (
    <g className={`war-arrow ${threat ? 'threat' : ''}`} onClick={onClick} pointerEvents={onClick ? 'auto' : 'none'}>
      <path d={d} className="nss" fill="none" stroke="transparent" strokeWidth={16} />
      <path
        d={d}
        className="nss"
        fill="none"
        stroke="rgba(12,15,17,0.55)"
        strokeWidth={width + 2.6}
        strokeLinecap="round"
      />
      <path
        d={d}
        className="nss stroke"
        fill="none"
        stroke={GREASE}
        strokeOpacity={preview ? 0.85 : 1}
        strokeWidth={width}
        strokeLinecap="round"
      />
      <g transform={`translate(${x1},${y1}) rotate(${angle})`}>
        <path
          className="counter-scale"
          d="M1,0 L-13,-7.5 L-9.5,0 L-13,7.5 Z"
          fill={GREASE}
          stroke="rgba(12,15,17,0.7)"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
      </g>
    </g>
  );
}
