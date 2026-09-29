/**
 * Missions in words, from their specs: the exact requirement with its targets, when a secret
 * mission is revealed, and which countries to call out on the map. The server's notices and the
 * client's cards both use these, so they always agree.
 */
import type { Continent, TerritoryId } from '../dataset';
import type { UserId } from '../draft';
import type { DatasetIndex } from '../graph';
import {
  MISSIONS,
  missionRules,
  type MissionKind,
  type MissionRules,
  type MissionSpec,
  type SecretMissionSpec,
} from './catalog';
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

const NUMBERS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];
/** Small counts in words, the way the rules guide writes them: "three", then figures past twelve. */
export const numberInWords = (n: number) => NUMBERS[n] ?? String(n);
const words = numberInWords;

/** "Two Billion": One Billion is named for the people it asks for. */
function billionsName(people: number): string {
  const n = people / 1e9;
  const word = Number.isInteger(n) ? words(n) : String(n);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} Billion`;
}

/**
 * A mission's name. One Billion is named for its figure, taken from the spec or, given only the
 * kind (as events carry it), from the campaign's mission rules `version`.
 */
export function missionName(spec: Pick<MissionSpec, 'kind'> | MissionSpec, version?: number): string {
  if (spec.kind === 'one_billion') {
    const people =
      'people' in spec ? spec.people : version !== undefined ? missionRules(version).oneBillion.people : null;
    if (people) return billionsName(people);
  }
  return MISSIONS[spec.kind].name;
}

/** A mission's name as a version plays it (One Billion is named for its figure). */
export const kindName = (kind: MissionKind, cfg: MissionRules) =>
  kind === 'one_billion' ? billionsName(cfg.oneBillion.people) : MISSIONS[kind].name;

/** A mission that tends to take a long campaign, as the version judges it. */
export const isLongMission = (kind: MissionKind, cfg: MissionRules) => cfg.long.includes(kind);

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

/** Named seas and regions: the whole of it, and what "N of the M" counts. */
const NAMED_SETS: Record<string, { all: string; noun: string }> = {
  northern_passage: {
    all: 'Hold the North Atlantic crossing, from Canada to the United Kingdom.',
    noun: 'countries of the North Atlantic crossing, from Canada to the United Kingdom',
  },
  caribbean_chain: { all: 'Hold the chain of the Greater Antilles.', noun: 'Greater Antilles' },
  pacific_passage: {
    all: 'Hold the South Pacific from Australia to Fiji.',
    noun: 'countries of the South Pacific from Australia to Fiji',
  },
  mediterranean_arc: {
    all: 'Hold the arc of the western Mediterranean.',
    noun: 'countries on the arc of the western Mediterranean',
  },
  central_asian_union: { all: 'Unite Central Asia.', noun: 'countries of Central Asia' },
  black_sea: { all: 'Hold every country around the Black Sea.', noun: 'countries around the Black Sea' },
  baltic_league: { all: 'Hold every country around the Baltic.', noun: 'countries around the Baltic' },
  gulf_hegemon: { all: 'Hold every country around the Persian Gulf.', noun: 'countries around the Persian Gulf' },
  caspian: { all: 'Hold every country around the Caspian Sea.', noun: 'countries around the Caspian Sea' },
  nordic: {
    all: 'Unite Norway, Sweden, Finland and Denmark.',
    noun: 'Nordic countries: Norway, Sweden, Finland and Denmark',
  },
  horn_of_africa: {
    all: 'Hold Ethiopia, Eritrea, Djibouti and Somalia.',
    noun: 'countries of the Horn of Africa: Ethiopia, Eritrea, Djibouti and Somalia',
  },
  andean_spine: { all: 'Hold every country along the Andes.', noun: 'countries along the Andes' },
  mekong: { all: 'Hold every country of the lower Mekong.', noun: 'countries of the lower Mekong' },
};

/** Real-world sizes to compare an area with. */
const AREA_LIKE: Record<number, string> = {
  7_500_000: 'about the size of Australia',
  20_000_000: 'more than Russia',
};

/** A mission in a sentence, without targets, with the numbers of the campaign's version. */
export function missionSummary(kind: MissionKind, cfg: MissionRules): string {
  const won = cfg.positionsNeedConquest;
  switch (kind) {
    case 'expansion':
      return 'Grow your empire’s total value well past what you drafted.';
    case 'regional_power':
      return `Hold most of the value of one marked region${won ? ', with a country in it won after the draft' : ''}.`;
    case 'strategic_positions': {
      const { need, count } = cfg.strategicPositions;
      return `Hold any ${words(need)} of ${words(count)} marked countries at once${won ? ', one of them won after the draft' : ''}.`;
    }
    case 'great_connection': {
      const [lo, hi] = cfg.greatConnection.between;
      return (
        `Hold two marked countries with ${words(lo)} to ${words(hi)} countries between them, and an unbroken ` +
        `chain of yours linking them${won ? ' through a country won after the draft' : ''}.`
      );
    }
    case 'campaign_veteran': {
      const { wins, opponents, attackWins, attackOnly } = cfg.campaignVeteran;
      const against = opponents === 2 ? 'more than one opponent' : `${words(opponents)} different opponents`;
      return attackOnly
        ? `Win ${words(wins)} wars as the attacker, against ${against}.`
        : `Win ${words(wins)} wars against ${against}, at least ${words(attackWins)} as the attacker.`;
    }
    case 'great_powers': {
      const { count, newCount } = cfg.greatPowers;
      const fresh = newCount >= count ? 'all of them' : `${words(newCount)} of them`;
      return `Hold ${words(count)} of the most valuable countries, ${fresh} won after the draft.`;
    }
    case 'across_the_seas':
      return `Win ${words(cfg.acrossTheSeas.count)} attacks launched across sea lanes, and keep what they took.`;
    case 'continental_bridge':
      return (
        `Hold one connected block spanning ${words(cfg.continentalBridge.continents)} continents` +
        `${won ? ', with a country in it won after the draft' : ''}.`
      );
    case 'consolidation':
      return 'Pull a scattered empire together into one block.';
    case 'two_fronts':
      return `Win new ground on ${words(cfg.twoFronts.continents)} continents.`;
    case 'mare_nostrum': {
      const { need, perShore } = cfg.mareNostrum;
      return (
        `Hold ${words(need)} Mediterranean countries, at least ${words(perShore)} on each of its shores` +
        `${won ? ', one of them won after the draft' : ''}.`
      );
    }
    case 'one_billion': {
      const n = cfg.oneBillion.people / 1e9;
      return `Win countries home to ${n === 1 ? 'a' : Number.isInteger(n) ? words(n) : n} billion people, and hold them.`;
    }
    case 'great_expanse': {
      const { areaKm2 } = cfg.greatExpanse;
      const like = AREA_LIKE[areaKm2];
      return `Win ${bigNumber(areaKm2)} km² of land${like ? `, ${like}` : ''}, and hold it.`;
    }
    case 'seven_wonders': {
      const { count, newCount } = cfg.sevenWonders;
      return `Hold ${words(count)} countries with wonders of the world, ${words(newCount)} of them won after the draft.`;
    }
    case 'kingslayer': {
      const { lead } = cfg.kingslayer;
      return lead === undefined
        ? 'Declare war on the leader of the race while you trail, and win it.'
        : `Declare war on the leader of the race while they’re ${words(lead)} or more points ahead of you, and win it.`;
    }
    case 'lightning_campaign':
      return `Win ${words(cfg.lightningCampaign.wins)} wars you declared in the same round.`;
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
    case 'mekong': {
      const tpl = cfg.namedSets.find((t) => t.kind === kind);
      const text = NAMED_SETS[kind]!;
      if (!tpl || tpl.need >= tpl.territories.length) return text.all;
      return `Hold ${words(tpl.need)} of the ${words(tpl.territories.length)} ${text.noun}.`;
    }
    case 'island_empire': {
      const { count, need, newCount } = cfg.islandEmpire;
      return `Hold ${words(need)} of ${words(count)} marked islands, ${words(newCount)} of them won after the draft.`;
    }
    case 'mountain_kingdom': {
      const { count, need } = cfg.mountainKingdom;
      return `Hold ${need < count ? `${words(need)} of ` : ''}${words(count)} marked mountain countries close together.`;
    }
    case 'unification':
      return 'Join two separate pieces of your drafted empire.';
    case 'encirclement':
      return 'Surround a marked country held by someone else.';
    case 'hidden_triangle': {
      const { count, need } = cfg.hiddenTriangle;
      return `Hold ${need < count ? `${words(need)} of ` : ''}${words(count)} marked countries lying in different directions from your empire.`;
    }
    case 'two_theater_power':
      return 'Grow on two marked continents at once.';
    case 'protected_expansion':
      return `Expand while accords with ${words(cfg.protectedExpansion.partners)} partners guard your back.`;
    case 'measured_expansion':
      return 'Grow steadily past what you drafted.';
    case 'buffer_zone':
      return 'Hold a marked country of yours and every country around it.';
    case 'silk_road':
      return 'Join China and Italy with an unbroken chain of your countries.';
    case 'cape_to_cairo':
      return 'Join South Africa and Egypt with an unbroken chain of your countries.';
    case 'pan_american_highway':
      return 'Join the United States and Chile with an unbroken chain of your countries.';
    case 'strait_keeper':
      return cfg.straitKeeper.count === 1
        ? 'Hold both shores of a marked strait.'
        : `Hold both shores of ${words(cfg.straitKeeper.count)} marked straits.`;
    case 'half_of_humanity': {
      const { sharePct } = cfg.halfOfHumanity;
      return `Rule ${sharePct === 50 ? 'half' : `${sharePct}%`} of the world’s people.`;
    }
    case 'nemesis':
      return `Take ${words(cfg.nemesis.count)} countries from a marked rival, and hold them.`;
    case 'backstab': {
      const { rounds, count = 1 } = cfg.backstab;
      return (
        `Break an accord, then take ${count === 1 ? 'a country' : `${words(count)} countries`} from that partner ` +
        `within the next ${rounds === 1 ? 'round' : `${words(rounds)} rounds`}.`
      );
    }
    case 'iron_wall':
      return `Win ${words(cfg.ironWall.wins)} wars as the defender.`;
    case 'checkmate_artist':
      return `Win ${words(cfg.checkmateArtist.wins)} wars by checkmate.`;
  }
}

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
        `from at least ${words(spec.minTerritories)} of its countries: ${listNames(idx, spec.territories)}.` +
        (spec.needsConquest ? ` At least one of the countries you hold there must be won since the draft.` : '')
      );
    }
    case 'strategic_positions':
      return (
        `Hold any ${words(spec.need)} of these ${words(spec.territories.length)} at once` +
        `${spec.needsConquest ? ', at least one of them won since the draft' : ''}: ${listNames(idx, spec.territories)}.`
      );
    case 'great_connection': {
      const [a, b] = spec.endpoints;
      return (
        `Hold ${nameOf(idx, a)} and ${nameOf(idx, b)} and an unbroken chain of your countries between them, by land or sea lane` +
        `${spec.needsConquest ? ', with at least one country on the chain won since the draft' : ''}.`
      );
    }
    case 'campaign_veteran': {
      const opponents = Math.min(spec.opponents, Math.max(1, (opts.players ?? spec.opponents + 1) - 1));
      const against =
        opponents === 1
          ? opts.players === 2
            ? ''
            : ' against any opponent'
          : ` against at least ${words(opponents)} different opponents`;
      if (spec.attackOnly) {
        return (
          `Win ${words(spec.wins)} wars as the attacker${against}. Wins as the defender, draws, tribute and ` +
          'withdrawals don’t count.'
        );
      }
      return (
        `Win ${words(spec.wins)} wars${against}, at least ${words(spec.attackWins)} of them as the attacker. ` +
        'Draws, tribute and withdrawals don’t count.'
      );
    }
    case 'great_powers': {
      const won = spec.newCount >= spec.count ? 'all of them' : `at least ${words(spec.newCount)} of them`;
      return `Hold ${words(spec.count)} countries worth ${spec.minValue} or more, ${won} won since the draft.`;
    }
    case 'across_the_seas':
      return (
        `Win ${words(spec.count)} attacks launched across sea lanes, each taking a different country you ` +
        `didn’t draft, and hold all ${words(spec.count)}.`
      );
    case 'continental_bridge':
      return (
        `Hold one connected block of countries with at least ${words(spec.perContinent)} on each of ` +
        `${words(spec.continents)} continents${spec.needsConquest ? ', at least one of them won since the draft' : ''}.`
      );
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
        `${words(spec.perShore)} on each of its shores: ${joinWords(shores)}.` +
        (spec.needsConquest ? ' At least one of those you hold must be won since the draft.' : '')
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
      return spec.lead === undefined
        ? 'Declare war on the leader of the race (the most victory points, then the most valuable empire) ' +
            'while you trail, and win it. Tribute and withdrawals don’t count.'
        : `Declare war on the leader of the race (the most victory points) while they’re at least ` +
            `${words(spec.lead)} points ahead of you, and win it. Tribute and withdrawals don’t count.`;
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
      return spec.straits.length === 1
        ? `Hold both shores of ${joinWords(straits)}.`
        : `Hold both shores of ${words(spec.straits.length)} straits: ${joinWords(straits)}.`;
    }
    case 'half_of_humanity':
      return `Hold countries home to at least ${spec.sharePct}% of the world’s people.`;
    case 'nemesis':
      return (
        `Take ${words(spec.count)} countries from ${opts.playerName?.(spec.rival) ?? 'your marked rival'}, in wars ` +
        'or as tribute, and hold them.'
      );
    case 'backstab': {
      const count = spec.count ?? 1;
      const rounds = spec.rounds === 1 ? 'the next round' : `the next ${words(spec.rounds)} rounds`;
      return (
        `Break an accord, then by the end of ${rounds} declare war on that partner and take ` +
        `${count === 1 ? 'a country' : `${words(count)} countries`} from them, by winning or as tribute.`
      );
    }
    case 'iron_wall':
      return `Win ${words(spec.wins)} wars as the defender.`;
    case 'checkmate_artist':
      return `Win ${words(spec.wins)} wars by checkmate. Wins by resignation or on time don’t count.`;
    case 'mountain_kingdom':
    case 'hidden_triangle':
      return spec.need >= spec.territories.length
        ? `Hold all ${words(spec.territories.length)}: ${listNames(idx, spec.territories)}.`
        : `Hold any ${words(spec.need)} of these ${words(spec.territories.length)}: ${listNames(idx, spec.territories)}.`;
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
      return spec.reveal >= spec.need
        ? 'Revealed only once it’s complete.'
        : `Revealed once you hold ${words(spec.reveal)} of them.`;
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
      return spec.reveal >= spec.straits.length
        ? 'Revealed only once it’s complete.'
        : `Revealed once you hold both shores of ${words(spec.reveal)} of them.`;
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
    case 'backstab': {
      const count = spec.count ?? 1;
      return `An accord to sign and break, then ${count === 1 ? 'a conquest' : `${words(count)} conquests`} from that partner.`;
    }
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
