/**
 * Missions in words, from their specs: the exact requirement with its targets, when a secret
 * mission is revealed, and which countries to call out on the map. The server's notices and the
 * client's cards both use these, so they always agree.
 */
import type { Continent, TerritoryId } from '../dataset';
import type { DatasetIndex } from '../graph';
import { MISSIONS, type MissionSpec, type SecretMissionSpec } from './catalog';

export const CONTINENT_NAMES: Record<Continent, string> = {
  africa: 'Africa',
  asia: 'Asia',
  europe: 'Europe',
  'north-america': 'North America',
  'south-america': 'South America',
  oceania: 'Oceania',
};

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** Small counts in words, the way the rules guide writes them. */
const words = (n: number) => NUMBERS[n] ?? String(n);

export const missionName = (spec: Pick<MissionSpec, 'kind'>) => MISSIONS[spec.kind].name;

/** A holding or choosing time in words: "10 minutes", "24 hours", "2 days". */
export function durationText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 120) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

/** "A, B and C" */
export function listNames(idx: DatasetIndex, ids: readonly TerritoryId[]): string {
  const names = ids.map((id) => idx.byId.get(id)?.name ?? id);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const nameOf = (idx: DatasetIndex, id: TerritoryId) => idx.byId.get(id)?.name ?? id;

/**
 * The mission's exact requirement. `players` adapts Campaign Veteran to two-player campaigns,
 * where there is only one opponent to beat.
 */
export function missionRequirement(spec: MissionSpec, idx: DatasetIndex, opts: { players?: number } = {}): string {
  switch (spec.kind) {
    case 'expansion':
      return `Raise your empire’s total value to at least ${spec.gain} more than you drafted, and hold it.`;
    case 'regional_power': {
      const pct = Math.round((spec.needValue / spec.totalValue) * 100);
      return (
        `Hold at least ${spec.needValue} of the ${spec.totalValue} value in ${spec.region} (${pct}%), ` +
        `from at least ${words(spec.minTerritories)} of its countries: ${listNames(idx, spec.territories)}.`
      );
    }
    case 'strategic_positions':
      return `Hold any ${words(spec.need)} of these ${words(spec.territories.length)} at once: ${listNames(idx, spec.territories)}.`;
    case 'great_connection': {
      const [a, b] = spec.endpoints;
      return `Hold ${nameOf(idx, a)} and ${nameOf(idx, b)} and an unbroken chain of your countries between them, by land or sea lane.`;
    }
    case 'campaign_veteran': {
      const opponents = Math.min(spec.opponents, Math.max(1, (opts.players ?? spec.opponents + 1) - 1));
      const against =
        opponents === 1
          ? opts.players === 2
            ? ''
            : ' against any opponent'
          : ` against at least ${words(opponents)} different opponents`;
      return (
        `Win ${words(spec.wins)} wars${against}, at least ${words(spec.attackWins)} of them as the attacker. ` +
        'Draws, tribute and withdrawals don’t count.'
      );
    }
    case 'great_powers':
      return `Hold ${words(spec.count)} countries worth ${spec.minValue} or more, at least ${words(spec.newCount)} of them won since the draft.`;
    case 'across_the_seas':
      return (
        `Win ${words(spec.count)} attacks launched across sea lanes, each taking a different country you ` +
        `didn’t draft, and hold all ${words(spec.count)}.`
      );
    case 'continental_bridge':
      return `Hold one connected block of countries with at least ${words(spec.perContinent)} on each of ${words(spec.continents)} continents.`;
    case 'consolidation':
      return (
        `Gather at least ${spec.sharePct}% of your empire’s value into one connected block that includes ` +
        `${words(spec.newCount)} countries won since the draft. If your draft left your empire in pieces, the ` +
        `block must join two or more of them, and the join must need at least ${words(spec.newCount)} countries ` +
        `won since the draft: links that fewer new countries could make don’t count.`
      );
    case 'two_fronts':
      return `Hold at least ${words(spec.perContinent)} countries won since the draft on each of ${words(spec.continents)} continents.`;
    case 'northern_passage':
    case 'caribbean_chain':
    case 'pacific_passage':
    case 'mediterranean_arc':
    case 'central_asian_union':
      return spec.need === spec.territories.length
        ? `Hold ${listNames(idx, spec.territories)}.`
        : `Hold any ${words(spec.need)} of ${listNames(idx, spec.territories)}.`;
    case 'mountain_kingdom':
    case 'hidden_triangle':
      return `Hold all ${words(spec.territories.length)}: ${listNames(idx, spec.territories)}.`;
    case 'island_empire':
      return (
        `Hold ${words(spec.need)} of these ${words(spec.territories.length)} islands, at least ` +
        `${words(spec.newCount)} of them won since the draft: ${listNames(idx, spec.territories)}.`
      );
    case 'unification': {
      const [a, b] = spec.marks;
      return (
        `Join ${nameOf(idx, a)} and ${nameOf(idx, b)}, from separate pieces of your drafted empire, with an ` +
        `unbroken chain of your countries, at least ${words(spec.newCount)} of them won since the draft.`
      );
    }
    case 'encirclement':
      return (
        `Hold every neighbor of ${nameOf(idx, spec.center)} (${listNames(idx, spec.ring)}) while someone ` +
        `else holds ${nameOf(idx, spec.center)}.`
      );
    case 'two_theater_power': {
      const [a, b] = spec.continents.map((c) => CONTINENT_NAMES[c]);
      return (
        `In ${a} and in ${b}: hold at least ${spec.netValue} more value than you drafted there, with at least ` +
        `${words(spec.newCount)} countries won since the draft.`
      );
    }
    case 'protected_expansion':
      return (
        `Keep accords with ${words(spec.partners)} different players in force together for ${words(spec.rounds)} ` +
        `whole rounds, and while both hold, win ${words(spec.acquisitions)} countries you didn’t draft from ` +
        `other players (not those partners). Hold all ${words(spec.acquisitions)}.`
      );
    case 'measured_expansion':
      return (
        `Raise your empire’s total value to at least ${spec.gain} more than you drafted, with at least ` +
        `${words(spec.newCount)} countries won since the draft.`
      );
  }
}

/** When a secret mission becomes public. Completing it always reveals it. */
export function revealRule(spec: SecretMissionSpec): string {
  switch (spec.kind) {
    case 'northern_passage':
    case 'caribbean_chain':
    case 'pacific_passage':
    case 'mediterranean_arc':
    case 'central_asian_union':
    case 'mountain_kingdom':
    case 'hidden_triangle':
      return `Revealed once you hold ${words(spec.reveal)} of them.`;
    case 'island_empire':
      return `Revealed once you hold ${words(spec.need - 1)} of the islands and one more conquest could finish it.`;
    case 'unification':
      return 'Revealed once one more conquest could join them.';
    case 'encirclement':
      return 'Revealed once you hold all but one neighbor.';
    case 'two_theater_power':
      return 'Revealed once one continent is done and one more conquest could finish the other.';
    case 'protected_expansion':
      return (
        `Revealed once the two accords have held ${words(spec.rounds)} whole rounds together and you hold ` +
        `${words(spec.acquisitions - 1)} countries won under them.`
      );
    case 'measured_expansion':
      return `Revealed at +${spec.revealGain} value with ${words(spec.revealNew)} new countries, or once one more conquest could finish it.`;
  }
}

/** The countries a mission names, to call out on the map. Empty for missions without targets. */
export function missionTargets(spec: MissionSpec): TerritoryId[] {
  switch (spec.kind) {
    case 'regional_power':
    case 'strategic_positions':
    case 'northern_passage':
    case 'caribbean_chain':
    case 'pacific_passage':
    case 'mediterranean_arc':
    case 'central_asian_union':
    case 'island_empire':
    case 'mountain_kingdom':
    case 'hidden_triangle':
      return [...spec.territories];
    case 'great_connection':
      return [...spec.endpoints];
    case 'unification':
      return [...spec.marks];
    case 'encirclement':
      return [spec.center, ...spec.ring];
    default:
      return [];
  }
}
