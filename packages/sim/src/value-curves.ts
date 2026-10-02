/**
 * Value curves tried in place of a dataset's own values: the same scores (`config/values.yaml`
 * weights), ranked against another distribution. Only the simulator plays them; a curve the game
 * adopts goes into `values.yaml` and a new dataset version.
 *
 * Mission numbers that count value (gains, value bands, the Great Powers line) and the bots' value
 * units move with a curve, so each curve brings its own trial mission rules and bot knobs.
 */
import {
  indexDataset,
  MISSION_RULES_V3,
  registerTrialMissionRules,
  type DatasetIndex,
  type MissionRules,
  type TerritoryId,
} from '@empire/rules';
import { computeValues, loadValues } from '@empire/data/values';
import type { BotKnobs } from './bots/knobs';

export interface ValueCurve {
  description: string;
  /** Countries at each value, counted from the top; value 1 takes the rest. */
  counts: Readonly<Record<number, number>>;
  overrides: Readonly<Record<TerritoryId, number>>;
  /** The mission rules a campaign on this curve plays (a trial version). */
  missionRules: MissionRules;
  /** Bot knobs counted in value, moved with the curve. */
  bots: Partial<BotKnobs>;
}

/** The curve's total value over the dataset's own (928 / 718 on dataset 2026.1). */
const V20_SCALE = 1.29;
const scaled = (x: number) => Math.round(x * V20_SCALE);

export const VALUE_CURVES: Record<string, ValueCurve> = {
  v20: {
    description:
      'Values 1-20, steep at the top: the two superpowers 20, the median country 3-4, so a superpower is ' +
      'worth five or six median countries (about three today). The bottom half keeps its values.',
    counts: {
      20: 2,
      18: 1,
      17: 1,
      16: 2,
      15: 2,
      14: 2,
      13: 3,
      12: 3,
      11: 4,
      10: 5,
      9: 6,
      8: 8,
      7: 10,
      6: 12,
      5: 14,
      4: 19,
      3: 31,
      2: 32,
    },
    // As in values.yaml: Germany with Japan, Western Sahara below its generated value.
    overrides: { DEU: 15, ESH: 2 },
    missionRules: {
      ...MISSION_RULES_V3,
      version: 103,
      // Sums of value grow with the curve's total.
      expansion: { gain: scaled(MISSION_RULES_V3.expansion.gain) },
      regionalPower: {
        ...MISSION_RULES_V3.regionalPower,
        value: [scaled(MISSION_RULES_V3.regionalPower.value[0]), scaled(MISSION_RULES_V3.regionalPower.value[1])],
      },
      twoTheater: { ...MISSION_RULES_V3.twoTheater, netValue: scaled(MISSION_RULES_V3.twoTheater.netValue) },
      measuredExpansion: {
        ...MISSION_RULES_V3.measuredExpansion,
        gain: scaled(MISSION_RULES_V3.measuredExpansion.gain),
        revealGain: scaled(MISSION_RULES_V3.measuredExpansion.revealGain),
      },
      fit: {
        ...MISSION_RULES_V3.fit,
        value: MISSION_RULES_V3.fit.value / V20_SCALE,
        freeValue: scaled(MISSION_RULES_V3.fit.freeValue),
      },
      // Bands of single countries map tier to tier: old 8 is 12-15 now, old 7 is 10-12.
      strategicPositions: { ...MISSION_RULES_V3.strategicPositions, value: [3, 15] },
      hiddenTriangle: { ...MISSION_RULES_V3.hiddenTriangle, value: [2, 12] },
      // The thirteen countries worth 8 or more today but Turkey.
      greatPowers: { ...MISSION_RULES_V3.greatPowers, minValue: 13 },
    },
    bots: {
      vpValue: 4 * V20_SCALE,
      declareThreshold: 0.4 * V20_SCALE,
      declareThresholdAtCap: -0.5 * V20_SCALE,
      betrayMargin: 3 * V20_SCALE,
      draftNoise: V20_SCALE,
    },
  },
};

for (const curve of Object.values(VALUE_CURVES)) registerTrialMissionRules(curve.missionRules);

export function valueCurve(name: string): ValueCurve {
  const curve = VALUE_CURVES[name];
  if (!curve) throw new Error(`Unknown value curve: ${name}`);
  return curve;
}

/** The dataset with its values replaced by the curve's. */
export function applyValueCurve(idx: DatasetIndex, name: string): DatasetIndex {
  const curve = valueCurve(name);
  const territories = idx.dataset.territories;
  const n = territories.length;
  const shares = new Map(Object.entries(curve.counts).map(([v, count]) => [Number(v), count / n]));
  const overrides = new Map(Object.entries(curve.overrides).map(([id, value]) => [id, { value, reason: null }]));
  const { rows } = computeValues(
    territories.map((t) => ({ id: t.id, name: t.name, stats: t.stats })),
    { ...loadValues(), shares, overrides },
  );
  const value = new Map(rows.map((r) => [r.id, r.value]));
  return indexDataset({
    ...idx.dataset,
    territories: territories.map((t) => ({ ...t, value: value.get(t.id)! })),
  });
}
