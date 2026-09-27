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
  it('pair every color with its own hatching', () => {
    expect(new Set(EMPIRE_COLORS.map((c) => c.pattern)).size).toBe(EMPIRE_COLORS.length);
    expect(EMPIRE_COLORS.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('have chart lines that stand out on the gunmetal surface', () => {
    for (const c of EMPIRE_COLORS) expect(contrast(c.line, '#1F2428'), c.name).toBeGreaterThanOrEqual(3);
  });
});
