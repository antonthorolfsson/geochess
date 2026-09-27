import { empireColor, type HatchPattern } from '@empire/rules';
import { useId } from 'react';

/** Dark ink for hatching drawn over empire colors, like marker lines on acetate. */
export const HATCH_INK = 'rgba(16, 20, 23, 0.6)';

/** Hatch tile spacing in screen pixels. */
export const HATCH_TILE = 7;

export function patternRotation(pattern: HatchPattern): number {
  if (pattern === 'diagonal' || pattern === 'crosshatch') return 45;
  if (pattern === 'diagonal-reverse') return -45;
  return 0;
}

/** Contents of one square pattern tile of side `size`. */
export function HatchTile({ pattern, size, ink = HATCH_INK }: { pattern: HatchPattern; size: number; ink?: string }) {
  const half = size / 2;
  const stroke = { stroke: ink, strokeWidth: size * 0.17 };
  const vertical = <line x1={half} y1={0} x2={half} y2={size} {...stroke} />;
  const horizontal = <line x1={0} y1={half} x2={size} y2={half} {...stroke} />;
  switch (pattern) {
    case 'diagonal':
    case 'diagonal-reverse':
    case 'vertical':
      return vertical;
    case 'horizontal':
      return horizontal;
    case 'crosshatch':
    case 'grid':
      return (
        <>
          {vertical}
          {horizontal}
        </>
      );
    case 'dots':
      return <circle cx={half} cy={half} r={size * 0.17} fill={ink} />;
    case 'solid':
      return null;
  }
}

export const svgId = (reactId: string) => reactId.replace(/[^a-zA-Z0-9_-]/g, '');

/** A player's color and hatching, as a small square. */
export function EmpireSwatch({ color, size = 18, className }: { color: number; size?: number; className?: string }) {
  const c = empireColor(color);
  const id = svgId(useId());
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true">
      <defs>
        <pattern
          id={id}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${patternRotation(c.pattern)})`}
        >
          <HatchTile pattern={c.pattern} size={6} />
        </pattern>
      </defs>
      <rect width={18} height={18} rx={2.5} fill={c.hex} />
      <rect width={18} height={18} rx={2.5} fill={`url(#${id})`} />
      <rect x={0.5} y={0.5} width={17} height={17} rx={2} fill="none" stroke="rgba(0,0,0,0.35)" />
    </svg>
  );
}
