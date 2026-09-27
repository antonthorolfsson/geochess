export type HatchPattern =
  'diagonal' | 'diagonal-reverse' | 'horizontal' | 'vertical' | 'crosshatch' | 'grid' | 'dots' | 'solid';

export interface EmpireColor {
  index: number;
  name: string;
  hex: string;
  pattern: HatchPattern;
  /**
   * The color as a line on the gunmetal map-room surface, for charts: the same hue, lightened where
   * the fill is too dark to read as a thin line (3:1 or better) and given enough chroma (OKLCH 0.10)
   * not to read as gray. Charts color one or two empires at a time, so pairs need not clear the
   * all-pairs floor that fills do.
   */
  line: string;
}

/**
 * Empire colors, each paired with a hatching pattern so color is never the only cue.
 *
 * Chosen by searching OKLCH space for the largest worst-case pairwise OKLab distance under
 * normal vision and simulated protanopia, deuteranopia and tritanopia (Machado et al. 2009),
 * composited at 90% over olive-drab land. Every pair stays above 0.10 in all four, and every
 * color stays apart from unclaimed land, grease-pencil red and signal amber. The closest pairs
 * (Ice/Sage, Sky/Mauve, Mauve/Ember) get the most different patterns.
 */
export const EMPIRE_COLORS: readonly EmpireColor[] = [
  { index: 0, name: 'Cobalt', hex: '#3F55BA', pattern: 'diagonal', line: '#516AD1' },
  { index: 1, name: 'Sky', hex: '#5F8FDE', pattern: 'horizontal', line: '#5F8FDE' },
  { index: 2, name: 'Ice', hex: '#9FE3EE', pattern: 'dots', line: '#7FE8F9' },
  { index: 3, name: 'Straw', hex: '#EADD8E', pattern: 'vertical', line: '#EADD8E' },
  { index: 4, name: 'Plum', hex: '#8A2470', pattern: 'crosshatch', line: '#B34C96' },
  { index: 5, name: 'Mauve', hex: '#B07A95', pattern: 'diagonal-reverse', line: '#BA7398' },
  { index: 6, name: 'Sage', hex: '#A3BCA7', pattern: 'grid', line: '#85C792' },
  { index: 7, name: 'Ember', hex: '#E07A1F', pattern: 'solid', line: '#E07A1F' },
];

export function empireColor(index: number): EmpireColor {
  const color = EMPIRE_COLORS[index];
  if (!color) throw new Error(`No empire color ${index}`);
  return color;
}

export function firstFreeColor(taken: Iterable<number>): number | null {
  const used = new Set(taken);
  return EMPIRE_COLORS.find((c) => !used.has(c.index))?.index ?? null;
}
