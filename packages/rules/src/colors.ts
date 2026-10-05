export type HatchPattern =
  'diagonal' | 'diagonal-reverse' | 'horizontal' | 'vertical' | 'crosshatch' | 'grid' | 'dots' | 'solid';

/** Which set a color belongs to: the original colors paired with hatching, or plain fills. */
export type ColorPalette = 'patterned' | 'solid';

export const COLOR_PALETTES: readonly ColorPalette[] = ['patterned', 'solid'];

export interface EmpireColor {
  index: number;
  name: string;
  hex: string;
  pattern: HatchPattern;
  palette: ColorPalette;
  /**
   * The color as a line on the gunmetal map-room surface, for charts: the same hue, lightened where
   * the fill is too dark to read as a thin line (3:1 or better) and given enough chroma (OKLCH 0.10)
   * not to read as gray (Chalk and Graphite stay neutral). Charts color one or two empires at a
   * time, so pairs need not clear the all-pairs floor that fills do.
   */
  line: string;
}

/**
 * Empire colors. Indices are stored on memberships, so a color keeps its index for good: new
 * colors go on the end.
 *
 * The patterned set (0 to 7) pairs each color with a hatching pattern so color is never the only
 * cue. It was chosen by searching OKLCH space for the largest worst-case pairwise OKLab distance
 * under normal vision and simulated protanopia, deuteranopia and tritanopia (Machado et al. 2009),
 * composited at 90% over olive-drab land. Every pair stays above 0.10 in all four, and every color
 * stays apart from unclaimed land, grease-pencil red and signal amber. The closest pairs
 * (Ice/Sage, Sky/Mauve, Mauve/Ember) get the most different patterns.
 *
 * The solid set (8 to 15) is plain fills for players who would rather have a pure color: one each
 * of blue, green, yellow, red, orange, purple, white and black, muted to the map room. Searched
 * the same way within each hue, but weighting normal vision over the simulations, since a red and
 * a green can't be kept apart for everyone without patterns: every pair stays above 0.11 under
 * normal vision and 0.06 simulated, and each stays above 0.08 under normal vision from Ember (the
 * patterned set's own solid fill), unclaimed land, grease-pencil red, signal amber and the sea.
 * The patterned set stays the default (`firstFreeColor`); the solid one is a player's choice.
 */
export const EMPIRE_COLORS: readonly EmpireColor[] = [
  { index: 0, name: 'Cobalt', hex: '#3F55BA', pattern: 'diagonal', palette: 'patterned', line: '#516AD1' },
  { index: 1, name: 'Sky', hex: '#5F8FDE', pattern: 'horizontal', palette: 'patterned', line: '#5F8FDE' },
  { index: 2, name: 'Ice', hex: '#9FE3EE', pattern: 'dots', palette: 'patterned', line: '#7FE8F9' },
  { index: 3, name: 'Straw', hex: '#EADD8E', pattern: 'vertical', palette: 'patterned', line: '#EADD8E' },
  { index: 4, name: 'Plum', hex: '#8A2470', pattern: 'crosshatch', palette: 'patterned', line: '#B34C96' },
  { index: 5, name: 'Mauve', hex: '#B07A95', pattern: 'diagonal-reverse', palette: 'patterned', line: '#BA7398' },
  { index: 6, name: 'Sage', hex: '#A3BCA7', pattern: 'grid', palette: 'patterned', line: '#85C792' },
  { index: 7, name: 'Ember', hex: '#E07A1F', pattern: 'solid', palette: 'patterned', line: '#E07A1F' },
  { index: 8, name: 'Navy', hex: '#2B4382', pattern: 'solid', palette: 'solid', line: '#506BAE' },
  { index: 9, name: 'Jade', hex: '#4E9D6D', pattern: 'solid', palette: 'solid', line: '#4E9D6D' },
  { index: 10, name: 'Canary', hex: '#E3D33A', pattern: 'solid', palette: 'solid', line: '#E3D33A' },
  { index: 11, name: 'Crimson', hex: '#A8233E', pattern: 'solid', palette: 'solid', line: '#C23E53' },
  { index: 12, name: 'Tangerine', hex: '#FF9665', pattern: 'solid', palette: 'solid', line: '#FF9665' },
  { index: 13, name: 'Violet', hex: '#8A55C0', pattern: 'solid', palette: 'solid', line: '#8A55C0' },
  { index: 14, name: 'Chalk', hex: '#ECEAE0', pattern: 'solid', palette: 'solid', line: '#ECEAE0' },
  { index: 15, name: 'Graphite', hex: '#303539', pattern: 'solid', palette: 'solid', line: '#696E73' },
];

export function empireColor(index: number): EmpireColor {
  const color = EMPIRE_COLORS[index];
  if (!color) throw new Error(`No empire color ${index}`);
  return color;
}

/** A new seat gets the first free patterned color, so a table stays easy to tell apart by default. */
export function firstFreeColor(taken: Iterable<number>): number | null {
  const used = new Set(taken);
  return EMPIRE_COLORS.find((c) => !used.has(c.index))?.index ?? null;
}
