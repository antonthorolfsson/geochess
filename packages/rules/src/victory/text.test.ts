import { describe, expect, it } from 'vitest';
import { MISSION_RULES_V2, MISSION_RULES_V3, type MissionSpec, type SecretMissionSpec } from './catalog';
import {
  effortText,
  kindName,
  missionName,
  missionRequirement,
  missionSummary,
  missionTargets,
  partAmount,
  revealRule,
} from './text';
import { buildMap } from './test-maps';

const idx = buildMap({ A: { v: 1 }, B: { v: 1 }, C: { v: 1 }, D: { v: 1 } });
const estimate = { conquests: 3, inTheWay: 1, targetValue: 7, rivals: 2 };

describe('mission wording', () => {
  it('reads large figures in words, never rounding up past what they are', () => {
    expect(partAmount({ unit: 'people' }, 1_464_000_000)).toBe('1.46 billion');
    expect(partAmount({ unit: 'people' }, 999_600_000)).toBe('999 million');
    expect(partAmount({ unit: 'people' }, 42_500)).toBe('42,500');
    expect(partAmount({ unit: 'km2' }, 7_500_000)).toBe('7.5 million km²');
    expect(partAmount({ unit: 'percent' }, 48)).toBe('48%');
    expect(partAmount({}, 3)).toBe('3');
  });

  it('spells out the new missions, naming a Nemesis’s rival', () => {
    const nemesis: MissionSpec = { kind: 'nemesis', rival: 'bo', count: 3, reveal: 2 };
    expect(missionRequirement(nemesis, idx, { playerName: (id) => (id === 'bo' ? 'Bo' : '?') })).toBe(
      'Take three countries from Bo, in wars fought out or as tribute, and hold them.',
    );
    const straits: MissionSpec = {
      kind: 'strait_keeper',
      straits: [
        { name: 'Strait of A', shores: ['A', 'B'] },
        { name: 'Bab-el-C', shores: ['C', 'D'] },
      ],
      reveal: 1,
    };
    expect(missionRequirement(straits, idx)).toBe(
      'Hold both shores of two straits: the Strait of A (Territory A and Territory B) and the Bab-el-C ' +
        '(Territory C and Territory D).',
    );
    expect(missionTargets(straits)).toEqual(['A', 'B', 'C', 'D']);
    expect(missionRequirement({ kind: 'one_billion', people: 1_000_000_000 }, idx)).toBe(
      'Win countries home to at least 1 billion people since the draft, and hold them.',
    );
    const sea: MissionSpec = {
      kind: 'mare_nostrum',
      shores: [
        { name: 'European', territories: ['A', 'B'] },
        { name: 'eastern', territories: ['C'] },
      ],
      need: 2,
      perShore: 1,
    };
    expect(missionRequirement(sea, idx)).toBe(
      'Hold two of the three Mediterranean countries, at least one on each of its shores: the European ' +
        '(Territory A and Territory B) and the eastern (Territory C).',
    );
  });

  it('says what a secret option asks: conquests, or wins for the missions about battles', () => {
    const iron: SecretMissionSpec = { kind: 'iron_wall', wins: 2 };
    expect(effortText(iron, { ...estimate, conquests: 2 })).toBe('2 wars to win, against whoever attacks you.');
    expect(revealRule(iron)).toBe('Revealed once you have won one.');
    const route: SecretMissionSpec = { kind: 'silk_road', endpoints: ['A', 'D'] };
    expect(effortText(route, estimate)).toBe(
      'About 3 conquests (1 of them in the way) against 2 rivals, targets worth 7.',
    );
  });

  it('names One Billion for the people it asks for', () => {
    expect(missionName({ kind: 'one_billion', people: 1_000_000_000 })).toBe('One Billion');
    expect(missionName({ kind: 'one_billion', people: 2_000_000_000 })).toBe('Two Billion');
    expect(missionName({ kind: 'one_billion' }, 3)).toBe('Two Billion');
    expect(missionName({ kind: 'one_billion' }, 2)).toBe('One Billion');
    expect(missionName({ kind: 'one_billion' })).toBe('One Billion');
    expect(kindName('one_billion', MISSION_RULES_V3)).toBe('Two Billion');
    expect(missionName({ kind: 'kingslayer' }, 3)).toBe('Kingslayer');
  });

  it('sums each mission up with its version’s numbers', () => {
    expect(missionSummary('campaign_veteran', MISSION_RULES_V2)).toBe(
      'Win three wars against more than one opponent, at least one as the attacker.',
    );
    expect(missionSummary('campaign_veteran', MISSION_RULES_V3)).toBe(
      'Win four wars as the attacker, against three different opponents.',
    );
    expect(missionSummary('great_expanse', MISSION_RULES_V2)).toBe(
      'Win 7.5 million km² of land, about the size of Australia, and hold it.',
    );
    expect(missionSummary('great_expanse', MISSION_RULES_V3)).toBe(
      'Win 20 million km² of land, more than Russia, and hold it.',
    );
    expect(missionSummary('one_billion', MISSION_RULES_V2)).toBe(
      'Win countries home to a billion people, and hold them.',
    );
    expect(missionSummary('one_billion', MISSION_RULES_V3)).toBe(
      'Win countries home to two billion people, and hold them.',
    );
    expect(missionSummary('strategic_positions', MISSION_RULES_V3)).toBe(
      'Hold any three of five marked countries at once, one of them won after the draft.',
    );
    expect(missionSummary('black_sea', MISSION_RULES_V2)).toBe('Hold five of the six countries around the Black Sea.');
    expect(missionSummary('nordic', MISSION_RULES_V2)).toBe('Unite Norway, Sweden, Finland and Denmark.');
    expect(missionSummary('backstab', MISSION_RULES_V2)).toBe(
      'Break an accord, then take a country from that partner within the next two rounds.',
    );
    expect(missionSummary('backstab', MISSION_RULES_V3)).toBe(
      'Break an accord, then take two countries from that partner within the next two rounds.',
    );
    expect(missionSummary('strait_keeper', MISSION_RULES_V3)).toBe('Hold both shores of a marked strait.');
    expect(missionSummary('horn_of_africa', MISSION_RULES_V3)).toBe(
      'Hold two of the four countries of the Horn of Africa: Ethiopia, Eritrea, Djibouti and Somalia.',
    );
    expect(revealRule({ kind: 'horn_of_africa', territories: ['A', 'B', 'C', 'D'], need: 2, reveal: 2 })).toBe(
      'Revealed only once it’s complete.',
    );
    expect(missionSummary('kingslayer', MISSION_RULES_V3)).toBe(
      'Declare war on the leader of the race while they’re four or more points ahead of you, and win it.',
    );
  });

  it('spells out version 3’s requirements', () => {
    expect(
      missionRequirement({ kind: 'campaign_veteran', wins: 4, opponents: 3, attackWins: 4, attackOnly: true }, idx, {
        players: 5,
      }),
    ).toBe(
      'Win four wars as the attacker against at least three different opponents. Wins as the defender, draws, ' +
        'tribute, withdrawals and backing down don’t count.',
    );
    expect(missionRequirement({ kind: 'kingslayer', lead: 4 }, idx)).toBe(
      'Declare war on the leader of the race (the most victory points) while they’re at least four points ahead ' +
        'of you, and win it. Tribute, withdrawals and backing down don’t count.',
    );
    expect(missionRequirement({ kind: 'backstab', rounds: 1, count: 2 }, idx)).toBe(
      'Break an accord, then by the end of the next round declare war on that partner and take two countries ' +
        'from them, by winning or as tribute.',
    );
    expect(
      missionRequirement(
        { kind: 'strategic_positions', territories: ['A', 'B', 'C'], need: 2, needsConquest: true },
        idx,
      ),
    ).toBe(
      'Hold any two of these three at once, at least one of them won since the draft: Territory A, Territory B and Territory C.',
    );
    expect(missionRequirement({ kind: 'great_connection', endpoints: ['A', 'D'], needsConquest: true }, idx)).toBe(
      'Hold Territory A and Territory D and an unbroken chain of your countries between them, by land or sea ' +
        'lane, with at least one country on the chain won since the draft.',
    );
    expect(
      missionRequirement({ kind: 'mountain_kingdom', territories: ['A', 'B', 'C'], need: 2, reveal: 1 }, idx),
    ).toBe('Hold any two of these three: Territory A, Territory B and Territory C.');
    expect(effortText({ kind: 'backstab', rounds: 1, count: 2 }, estimate)).toBe(
      'An accord to sign and break, then two conquests from that partner.',
    );
  });
});
