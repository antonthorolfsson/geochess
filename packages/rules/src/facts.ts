/**
 * Real-world figures shown on the statistics pages and nowhere else: arsenals and energy. No rule
 * reads them, so they can't change a game. `@empire/data` builds them into one table for every
 * dataset version (territory ids have never changed between versions), and campaigns don't pin it:
 * a revised figure is harmless.
 */
import type { TerritoryId } from './dataset';

export const FACT_KEYS = [
  'activePersonnel',
  'tanks',
  'combatAircraft',
  'navalShips',
  'oilTwh',
  'gasTwh',
  'electricityTwh',
] as const;

export type FactKey = (typeof FACT_KEYS)[number];

export interface Fact {
  value: number;
  /** Data year of the figure, the most recent of the parts summed into it. */
  year: number | null;
}

/** The figures table as @empire/data writes it. */
export interface FactTable {
  generatedAt: string;
  /** Required attributions for the underlying data. */
  attribution: string[];
  /** Where each figure comes from, in a few words. */
  sources: Record<FactKey, string>;
  /** By territory id; a key left out means no figure. */
  territories: Record<TerritoryId, Partial<Record<FactKey, Fact>>>;
}

/** A territory's figure, or null when the table (perhaps still loading) has none. */
export function factOf(table: FactTable | null | undefined, id: TerritoryId, key: FactKey): number | null {
  return table?.territories[id]?.[key]?.value ?? null;
}
