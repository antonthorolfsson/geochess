/**
 * Missions in words, from their specs: the exact requirement with its targets, when a secret
 * mission is revealed, and which countries to call out on the map. The server's notices and the
 * client's cards both use these, so they always agree.
 */
import type { Continent, TerritoryId } from '../dataset';
import type { UserId } from '../draft';
import type { DatasetIndex } from '../graph';
import { MISSIONS, type MissionSpec, type SecretMissionSpec } from './catalog';
import type { ProgressPart } from './evaluate';
import type { EffortEstimate } from './generate';

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

/** Words as a list: "A, B and C". */
export const joinWords = (items: readonly string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** Country names as a list: "A, B and C". */
export function listNames(idx: DatasetIndex, ids: readonly TerritoryId[]): string {
  return joinWords(ids.map((id) => idx.byId.get(id)?.name ?? id));
}

const nameOf = (idx: DatasetIndex, id: TerritoryId) => idx.byId.get(id)?.name ?? id;

/** A large figure in words, never rounded up past what it is: "1.46 billion", "342 million". */
function bigNumber(n: number): string {
  const scaled = (x: number, unit: string) => {
    const f = 10 ** (x < 10 ? 2 : x < 100 ? 1 : 0);
    return `${Math.floor(x * f) / f} ${unit}`;
  };
  if (n >= 1e9) return scaled(n / 1e9, 'billion');
  if (n >= 1e6) return scaled(n / 1e6, 'million');
  return Math.floor(n).toLocaleString('en-US');
}

/** A figure from a progress part, as it reads: "1.2 billion", "7.5 million km²", "48%", "3". */
export function partAmount(part: Pick<ProgressPart, 'unit'>, n: number): string {
  switch (part.unit) {
    case 'people':
      return bigNumber(n);
    case 'km2':
      return `${bigNumber(n)} km²`;
    case 'percent':
      return `${n}%`;
    default:
      return String(n);
  }
}

/**
 * The mission's exact requirement. `players` adapts Campaign Veteran to two-player campaigns,
 * where there is only one opponent to beat; `playerName` names the rival a Nemesis marks.
 */
export function missionRequirement(
  spec: MissionSpec,
  idx: DatasetIndex,
  opts: { players?: number; playerName?: (userId: UserId) => string } = {},
): string {
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
    case 'mare_nostrum': {
      const total = spec.shores.reduce((n, shore) => n + shore.territories.length, 0);
      const shores = spec.shores.map((shore) => `the ${shore.name} (${listNames(idx, shore.territories)})`);
      return (
        `Hold ${words(spec.need)} of the ${words(total)} Mediterranean countries, at least ` +
        `${words(spec.perShore)} on each of its shores: ${joinWords(shores)}.`
      );
    }
    case 'one_billion':
      return `Win countries home to at least ${bigNumber(spec.people)} people since the draft, and hold them.`;
    case 'great_expanse':
      return `Win at least ${bigNumber(spec.areaKm2)} km² of land since the draft, and hold it.`;
    case 'seven_wonders':
      return (
        `Hold ${words(spec.count)} of these ${words(spec.territories.length)} countries with wonders of the ` +
        `world, at least ${words(spec.newCount)} of them won since the draft: ${listNames(idx, spec.territories)}.`
      );
    case 'kingslayer':
      return (
        'Declare war on the leader of the race (the most victory points, then the most valuable empire) ' +
        'while you trail, and win it. Tribute and withdrawals don’t count.'
      );
    case 'lightning_campaign':
      return `Win ${words(spec.wins)} wars you declared in the same round. Tribute and withdrawals don’t count.`;
    case 'northern_passage':
    case 'caribbean_chain':
    case 'pacific_passage':
    case 'mediterranean_arc':
    case 'central_asian_union':
    case 'black_sea':
    case 'baltic_league':
    case 'gulf_hegemon':
    case 'caspian':
    case 'nordic':
    case 'horn_of_africa':
    case 'andean_spine':
    case 'mekong':
      return spec.need === spec.territories.length
        ? `Hold ${listNames(idx, spec.territories)}.`
        : `Hold any ${words(spec.need)} of ${listNames(idx, spec.territories)}.`;
    case 'silk_road':
    case 'cape_to_cairo':
    case 'pan_american_highway': {
      const [a, b] = spec.endpoints;
      return `Hold ${nameOf(idx, a)} and ${nameOf(idx, b)} and an unbroken chain of your countries between them, by land or sea lane.`;
    }
    case 'buffer_zone':
      return `Hold ${nameOf(idx, spec.center)} and every country bordering it: ${listNames(idx, spec.ring)}.`;
    case 'strait_keeper': {
      const straits = spec.straits.map((strait) => `the ${strait.name} (${listNames(idx, strait.shores)})`);
      return `Hold both shores of ${words(spec.straits.length)} straits: ${joinWords(straits)}.`;
    }
    case 'half_of_humanity':
      return `Hold countries home to at least ${spec.sharePct}% of the world’s people.`;
    case 'nemesis':
      return (
        `Take ${words(spec.count)} countries from ${opts.playerName?.(spec.rival) ?? 'your marked rival'}, in wars ` +
        'or as tribute, and hold them.'
      );
    case 'backstab':
      return (
        `Break an accord, then within the next ${words(spec.rounds)} rounds declare war on that partner and take ` +
        'a country from them, by winning or as tribute.'
      );
    case 'iron_wall':
      return `Win ${words(spec.wins)} wars as the defender.`;
    case 'checkmate_artist':
      return `Win ${words(spec.wins)} wars by checkmate. Wins by resignation or on time don’t count.`;
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
    case 'black_sea':
    case 'baltic_league':
    case 'gulf_hegemon':
    case 'caspian':
    case 'nordic':
    case 'horn_of_africa':
    case 'andean_spine':
    case 'mekong':
    case 'mountain_kingdom':
    case 'hidden_triangle':
      return `Revealed once you hold ${words(spec.reveal)} of them.`;
    case 'island_empire':
      return `Revealed once you hold ${words(spec.need - 1)} of the islands and one more conquest could finish it.`;
    case 'unification':
    case 'silk_road':
    case 'cape_to_cairo':
    case 'pan_american_highway':
      return 'Revealed once one more conquest could join them.';
    case 'buffer_zone':
      return 'Revealed once you hold all but one of them.';
    case 'strait_keeper':
      return `Revealed once you hold both shores of ${words(spec.reveal)} of them.`;
    case 'half_of_humanity':
      return 'Revealed once one more conquest could finish it.';
    case 'nemesis':
      return `Revealed once you hold ${words(spec.reveal)} countries taken from them.`;
    case 'backstab':
      return 'Revealed once you break an accord.';
    case 'iron_wall':
    case 'checkmate_artist':
      return `Revealed once you have won ${words(spec.wins - 1)}.`;
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
    case 'seven_wonders':
    case 'northern_passage':
    case 'caribbean_chain':
    case 'pacific_passage':
    case 'mediterranean_arc':
    case 'central_asian_union':
    case 'black_sea':
    case 'baltic_league':
    case 'gulf_hegemon':
    case 'caspian':
    case 'nordic':
    case 'horn_of_africa':
    case 'andean_spine':
    case 'mekong':
    case 'island_empire':
    case 'mountain_kingdom':
    case 'hidden_triangle':
      return [...spec.territories];
    case 'mare_nostrum':
      return spec.shores.flatMap((shore) => shore.territories);
    case 'great_connection':
    case 'silk_road':
    case 'cape_to_cairo':
    case 'pan_american_highway':
      return [...spec.endpoints];
    case 'unification':
      return [...spec.marks];
    case 'encirclement':
    case 'buffer_zone':
      return [spec.center, ...spec.ring];
    case 'strait_keeper':
      return spec.straits.flatMap((strait) => strait.shores);
    default:
      return [];
  }
}

/**
 * What a secret option asks of a player, as estimated when it was dealt. An estimate, not a
 * promise: conquests for missions about countries, wins for the ones about battles.
 */
export function effortText(spec: SecretMissionSpec, e: EffortEstimate): string {
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  switch (spec.kind) {
    case 'backstab':
      return 'An accord to sign and break, then a conquest from that partner.';
    case 'iron_wall':
      return `${count(spec.wins, 'war')} to win, against whoever attacks you.`;
    case 'checkmate_artist':
      return `${count(spec.wins, 'war')} to win on the board.`;
    default:
      return (
        `About ${count(e.conquests, 'conquest')}` +
        (e.inTheWay > 0 ? ` (${e.inTheWay} of them in the way)` : '') +
        ` against ${count(e.rivals, 'rival')}` +
        (e.targetValue > 0 ? `, targets worth ${e.targetValue}` : '') +
        '.'
      );
  }
}
