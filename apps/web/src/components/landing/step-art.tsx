'use client';

import { TITLE_KINDS, empireColor } from '@empire/rules';
import { useId, type ReactNode } from 'react';
import { SAMPLE_BATTLE, sampleEmpire } from '@/lib/sample-campaign';
import { HatchTile, patternRotation, svgId } from '../hatch';
import { TitleToken } from '../victory/title-tokens';

/*
 * Pictures for the landing page's three steps, in the map room's own marks: countries in empire
 * colors and hatching over olive land and deep sea, grease pencil for war, amber for your move.
 * They only illustrate the text beside them, so screen readers skip them.
 */

const INK = '#161b1e';
const PAPER = '#e4e2d8';
const AMBER = '#e3a92b';
const GREASE = '#c8372d';
const OLIVE = '#4b5320';

type Point = readonly [number, number];

/** Corners written as "x,y x,y …". */
const polygon = (corners: string): Point[] =>
  corners.split(' ').map((corner) => {
    const [x, y] = corner.split(',').map(Number);
    return [x!, y!];
  });

const path = (points: readonly Point[]) => `M${points.map(([x, y]) => `${x},${y}`).join('L')}Z`;

const centroid = (points: readonly Point[]): Point => [
  points.reduce((sum, [x]) => sum + x, 0) / points.length,
  points.reduce((sum, [, y]) => sum + y, 0) / points.length,
];

/** An SVG with a hatch pattern for each empire color it uses, as the map draws empires. */
function Sheet({
  colors,
  children,
}: {
  colors: readonly number[];
  children(fill: (color: number) => string): ReactNode;
}) {
  const prefix = svgId(useId());
  return (
    <svg viewBox="0 0 240 128" className="size-full" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs>
        {colors.map((c) => (
          <pattern
            key={c}
            id={`${prefix}-${c}`}
            width={6}
            height={6}
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(${patternRotation(empireColor(c).pattern)})`}
          >
            <HatchTile pattern={empireColor(c).pattern} size={6} />
          </pattern>
        ))}
      </defs>
      <path
        d="M0,32H240M0,64H240M0,96H240M48,0V128M96,0V128M144,0V128M192,0V128"
        stroke="rgba(228,226,216,0.07)"
        fill="none"
      />
      {children((c) => `url(#${prefix}-${c})`)}
    </svg>
  );
}

/** A country: its empire's color and hatching (or olive land), and its value. */
function Country({
  points,
  color,
  hatch,
  value,
}: {
  points: readonly Point[];
  color: number | null;
  hatch?: string;
  value: number;
}) {
  const [x, y] = centroid(points);
  return (
    <g>
      <path
        d={path(points)}
        fill={color === null ? OLIVE : empireColor(color).hex}
        fillOpacity={color === null ? 1 : 0.9}
      />
      {hatch && <path d={path(points)} fill={hatch} />}
      <path d={path(points)} fill="none" stroke={INK} strokeOpacity={0.85} strokeWidth={1.2} strokeLinejoin="round" />
      <ValueLabel x={x} y={y}>
        {value}
      </ValueLabel>
    </g>
  );
}

function ValueLabel({ x, y, size = 13, children }: { x: number; y: number; size?: number; children: ReactNode }) {
  return (
    <text
      x={x}
      y={y}
      dy="0.35em"
      textAnchor="middle"
      fontSize={size}
      fontWeight={700}
      fill={PAPER}
      stroke="rgba(17,21,24,0.85)"
      strokeWidth={3}
      paintOrder="stroke"
    >
      {children}
    </text>
  );
}

const DRAFT: { points: Point[]; color: number | null; value: number }[] = [
  { points: polygon('22,34 78,24 92,62 32,72'), color: 0, value: 13 },
  { points: polygon('78,24 140,30 132,64 92,62'), color: 3, value: 12 },
  { points: polygon('140,30 200,40 190,76 132,64'), color: null, value: 6 },
  { points: polygon('32,72 92,62 98,106 42,110'), color: 4, value: 9 },
  { points: polygon('92,62 132,64 142,102 98,106'), color: 6, value: 4 },
  { points: polygon('132,64 190,76 180,108 142,102'), color: null, value: 3 },
];

/** Step 1: countries claimed in turn, and the next pick lit up in amber. */
export function DraftArt() {
  const pick = DRAFT[2]!;
  const [px, py] = centroid(pick.points);
  return (
    <Sheet colors={[0, 3, 4, 6]}>
      {(fill) => (
        <>
          {DRAFT.map((c, i) => (
            <Country
              key={i}
              points={c.points}
              color={c.color}
              hatch={c.color === null ? undefined : fill(c.color)}
              value={c.value}
            />
          ))}
          <path
            d={path(pick.points)}
            fill="rgba(227,169,43,0.22)"
            stroke={AMBER}
            strokeWidth={2.2}
            strokeLinejoin="round"
          />
          {/* The draft list's numbered tag, as on the map. */}
          <g transform={`translate(${px + 18},${py - 22})`}>
            <circle r={9} fill="#1f2428" stroke={AMBER} strokeWidth={1.6} />
            <text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={700} fill={AMBER}>
              1
            </text>
          </g>
        </>
      )}
    </Sheet>
  );
}

const STAKE = polygon('16,30 100,20 110,98 26,108');
const TARGET = polygon('100,20 176,32 170,100 110,98');

/**
 * Step 2: a grease-pencil arrow from the stake, outlined in amber, to the target in red, and the
 * board; the sample battle's empires and numbers.
 */
export function BattleArt() {
  const attacker = sampleEmpire(SAMPLE_BATTLE.attackerId).member.color;
  const defender = sampleEmpire(SAMPLE_BATTLE.defenderId).member.color;
  const stakeValue = SAMPLE_BATTLE.stake.reduce((sum, s) => sum + s.value, 0);
  const [ax, ay] = centroid(STAKE);
  const [bx, by] = centroid(TARGET);
  // Bowed like the map's arrows: a fifth of its length to the left of its direction.
  const cx = (ax + bx) / 2 - (by - ay) * 0.2;
  const cy = (ay + by) / 2 + (bx - ax) * 0.2 - 18;
  const angle = (Math.atan2(by - cy, bx - cx) * 180) / Math.PI;
  const d = `M${ax},${ay - 6} Q${cx},${cy} ${bx},${by - 6}`;
  return (
    <Sheet colors={[attacker, defender]}>
      {(fill) => (
        <>
          <path d={path(STAKE)} fill={empireColor(attacker).hex} fillOpacity={0.9} />
          <path d={path(STAKE)} fill={fill(attacker)} />
          <path d={path(STAKE)} fill="rgba(227,169,43,0.18)" stroke={AMBER} strokeWidth={1.8} strokeDasharray="5 3" />
          <path d={path(TARGET)} fill={empireColor(defender).hex} fillOpacity={0.9} />
          <path d={path(TARGET)} fill={fill(defender)} />
          <path d={path(TARGET)} fill="rgba(200,55,45,0.2)" stroke={GREASE} strokeWidth={2} />
          <ValueLabel x={ax} y={ay + 18} size={12}>
            {`Stake ${stakeValue}`}
          </ValueLabel>
          <ValueLabel x={bx} y={by + 18} size={12}>
            {`Target ${SAMPLE_BATTLE.target.value}`}
          </ValueLabel>
          <path d={d} fill="none" stroke="rgba(12,15,17,0.55)" strokeWidth={6} strokeLinecap="round" />
          <path d={d} fill="none" stroke={GREASE} strokeWidth={3.4} strokeLinecap="round" />
          <g transform={`translate(${bx},${by - 6}) rotate(${angle})`}>
            <path
              d="M1,0 L-13,-7.5 L-9.5,0 L-13,7.5 Z"
              fill={GREASE}
              stroke="rgba(12,15,17,0.7)"
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
          </g>
          <MiniBoard x={188} y={62} />
        </>
      )}
    </Sheet>
  );
}

/** A corner of the war game's board, in its paper and olive squares, with a rook on it. */
function MiniBoard({ x, y }: { x: number; y: number }) {
  const size = 11;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-2} y={-2} width={size * 4 + 4} height={size * 4 + 4} rx={2} fill={INK} />
      {Array.from({ length: 16 }, (_, i) => (
        <rect
          key={i}
          x={(i % 4) * size}
          y={Math.floor(i / 4) * size}
          width={size}
          height={size}
          fill={((i % 4) + Math.floor(i / 4)) % 2 === 0 ? '#e2ddcc' : '#8a9467'}
        />
      ))}
      <path
        transform={`translate(${size * 2},${size * 2})`}
        d="M-8,11H8V8H6L5,-2H7V-10H4V-7H1.5V-10H-1.5V-7H-4V-10H-7V-2H-5L-6,8H-8Z"
        fill="#f8f6ee"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </g>
  );
}

/** Step 3: the four titles' tokens, and a race to the points to win. */
export function TitlesArt({ toWin }: { toWin: number }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-4">
      <div className="flex gap-3">
        {TITLE_KINDS.map((kind) => (
          <TitleToken key={kind} kind={kind} size={40} label={false} />
        ))}
      </div>
      <div className="flex items-center gap-1">
        {Array.from({ length: toWin }, (_, i) => (
          <span
            key={i}
            className={`h-3.5 w-2.5 rounded-[1px] border ${i < Math.ceil(toWin * 0.7) ? 'border-amber bg-amber' : 'border-line-strong'}`}
          />
        ))}
        <span className="ml-2 text-sm font-bold text-amber tabular-nums">{toWin} VP</span>
      </div>
    </div>
  );
}
