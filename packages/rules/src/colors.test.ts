import { describe, expect, it } from 'vitest';
import { EMPIRE_COLORS } from './colors';

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('empire colors', () => {
  it('keep their indices: the eight patterned colors first, then the eight solid ones', () => {
    expect(EMPIRE_COLORS.map((c) => c.index)).toEqual([...Array(16).keys()]);
    expect(EMPIRE_COLORS.slice(0, 8).every((c) => c.palette === 'patterned')).toBe(true);
    expect(EMPIRE_COLORS.slice(8).every((c) => c.palette === 'solid')).toBe(true);
  });

  it('pair every patterned color with its own hatching, and draw solid ones plain', () => {
    const patterned = EMPIRE_COLORS.filter((c) => c.palette === 'patterned');
    expect(new Set(patterned.map((c) => c.pattern)).size).toBe(patterned.length);
    for (const c of EMPIRE_COLORS.filter((c) => c.palette === 'solid')) expect(c.pattern, c.name).toBe('solid');
  });

  it('have names and fills of their own', () => {
    expect(new Set(EMPIRE_COLORS.map((c) => c.name)).size).toBe(EMPIRE_COLORS.length);
    expect(new Set(EMPIRE_COLORS.map((c) => c.hex)).size).toBe(EMPIRE_COLORS.length);
  });

  it('have chart lines that stand out on the gunmetal surface', () => {
    for (const c of EMPIRE_COLORS) expect(contrast(c.line, '#1F2428'), c.name).toBeGreaterThanOrEqual(3);
  });
});
