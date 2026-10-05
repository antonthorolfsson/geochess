import type { FactKey } from '@empire/rules';
import { formatCount, formatTwh, formatWhole } from './format';

/** The arsenals and energy figures as the statistics pages show them. */
export const FACT_ROWS: { key: FactKey; label: string; format(n: number | null): string }[] = [
  { key: 'activePersonnel', label: 'Standing army', format: formatCount },
  { key: 'tanks', label: 'Tanks', format: formatWhole },
  { key: 'combatAircraft', label: 'Combat aircraft', format: formatWhole },
  { key: 'navalShips', label: 'Naval ships', format: formatWhole },
  { key: 'oilTwh', label: 'Oil production', format: formatTwh },
  { key: 'gasTwh', label: 'Gas production', format: formatTwh },
  { key: 'electricityTwh', label: 'Electricity', format: formatTwh },
];

/** What the figures are, for a note under their heading. */
export const FACTS_NOTE = 'Active troops and equipment, and energy produced in a year';

/** Credit for the figures, for the pages' small print. */
export const FACTS_CREDIT =
  'Arsenals: Global Firepower 2025. Energy: Our World in Data (CC BY 4.0), from the Energy Institute, Ember and The Shift Project.';
