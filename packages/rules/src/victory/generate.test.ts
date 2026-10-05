import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, parseRules, type CampaignRules } from '../config';
import type { TerritoryId } from '../dataset';
import {
  MISSION_RULES_V1,
  MISSION_RULES_V3,
  MISSION_RULES_V4,
  PUBLIC_MISSION_KINDS,
  missionInfo,
  type PublicMissionKind,
  type PublicMissionSpec,
} from './catalog';
import { evaluateMission } from './evaluate';
import {
  drawPublicKinds,
  generatePublicMission,
  generatePublicMissions,
  publicMissionIssue,
  publicTargets,
  secretCandidates,
  secretOptions,
  seededRandom,
} from './generate';
import { all, buildMap, makeWorld, type Place } from './test-maps';

const ANN = 'ann';
const BO = 'bo';
const CY = 'cy';
const DI = 'di';

/**
 * A 10 by 8 grid: the left half Europe, the right half Asia, each half in four subregions of two
 * rows. Values run 1 to 7. A column of islands lies off the east coast, and mountains in the north.
 */
function grid() {
  const places: Record<string, Place> = {};
  const id = (x: number, y: number) => `G${x}${y}`;
  for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 8; y++) {
      const land: string[] = [];
      if (x + 1 < 10) land.push(id(x + 1, y));
      if (y + 1 < 8) land.push(id(x, y + 1));
      places[id(x, y)] = {
        v: ((x + 2 * y) % 7) + 1,
        land,
        c: x < 5 ? 'europe' : 'asia',
        sub: `${x < 5 ? 'West' : 'East'} ${Math.floor(y / 2) + 1}`,
        terrain: y === 0 && x % 2 === 0 ? ['mountains'] : [],
        at: [x * 6, 45 - y * 6],
      };
    }
  }
  for (let y = 0; y < 8; y++) {
    places[`I${y}`] = {
      v: 2,
      sea: [id(9, y), ...(y + 1 < 8 ? [`I${y + 1}`] : [])],
      c: 'oceania',
      sub: 'Isles',
      terrain: ['island'],
      at: [66, 45 - y * 6],
    };
  }
  return buildMap(places);
}

const idx = grid();
const quarter = (x0: number, y0: number) => {
  const ids: TerritoryId[] = [];
  for (let x = x0; x < x0 + 5; x++) for (let y = y0; y < y0 + 4; y++) ids.push(`G${x}${y}`);
  return ids;
};
/** Four empires, one per quarter; the islands go to whoever holds the east. */
const quarters = {
  ...all(ANN, ...quarter(0, 0)),
  ...all(BO, ...quarter(5, 0), 'I0', 'I1', 'I2', 'I3'),
  ...all(CY, ...quarter(0, 4)),
  ...all(DI, ...quarter(5, 4), 'I4', 'I5', 'I6', 'I7'),
};
const free: CampaignRules = parseRules({ victory: { mode: 'objectives' }, draft: { mode: 'free' } });
const v2: CampaignRules = parseRules({ victory: { mode: 'objectives', version: 2 } });
const v3: CampaignRules = parseRules({ victory: { mode: 'objectives', version: 3 } });

describe('seeded randomness', () => {
  it('repeats for the same seed and differs between seeds', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const c = seededRandom(43);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('public missions', () => {
  it('explain why a mission does not fit the campaign', () => {
    expect(publicMissionIssue('consolidation', idx, DEFAULT_RULES)).toMatch(/free drafts/);
    expect(publicMissionIssue('consolidation', idx, free)).toBeNull();
    const line = buildMap({ A: { v: 1, land: ['B'] }, B: { v: 1 } });
    expect(publicMissionIssue('two_fronts', line, DEFAULT_RULES)).toMatch(/one continent/);
    expect(publicMissionIssue('great_powers', line, DEFAULT_RULES)).toMatch(/too few countries/);
    expect(publicMissionIssue('across_the_seas', line, DEFAULT_RULES)).toMatch(/sea lanes/);
    expect(publicMissionIssue('regional_power', line, DEFAULT_RULES)).toMatch(/region/);
  });

  it('generate the default four with targets that do not overlap', () => {
    const result = generatePublicMissions(MISSION_RULES_V1.defaultPublic, idx, DEFAULT_RULES, seededRandom(7));
    if ('error' in result) throw new Error(result.error);
    expect(result.missions.map((m) => m.kind)).toEqual([
      'expansion',
      'strategic_positions',
      'great_connection',
      'campaign_veteran',
    ]);
    const positions = result.missions[1] as Extract<PublicMissionSpec, { kind: 'strategic_positions' }>;
    const connection = result.missions[2] as Extract<PublicMissionSpec, { kind: 'great_connection' }>;
    expect(positions.territories).toHaveLength(5);
    expect(positions.need).toBe(3);
    expect(positions.territories.some((id) => connection.endpoints.includes(id))).toBe(false);
    for (const id of positions.territories) {
      const t = idx.byId.get(id)!;
      expect(t.value).toBeGreaterThanOrEqual(3);
      expect(t.micro).toBe(false);
    }
    expect(connection.endpoints[0]).not.toBe(connection.endpoints[1]);
  });

  it('are the same for the same seed', () => {
    const a = generatePublicMissions(MISSION_RULES_V1.defaultPublic, idx, DEFAULT_RULES, seededRandom(11));
    const b = generatePublicMissions(MISSION_RULES_V1.defaultPublic, idx, DEFAULT_RULES, seededRandom(11));
    expect(a).toEqual(b);
  });

  it('link two countries with six to ten between them, on a chain that stays on the map', () => {
    // Twenty-four countries around the equator. The first and last meet across the date line, where
    // B03 and B20 have only six countries between them; along the belt they have sixteen.
    const belt = (i: number) => `B${String(i).padStart(2, '0')}`;
    const places: Record<string, Place> = {};
    for (let i = 0; i < 24; i++) {
      places[belt(i)] = {
        v: 3,
        land: i + 1 < 24 ? [belt(i + 1)] : [],
        sea: i === 0 ? [belt(23)] : [],
        sub: `Belt ${i}`,
        at: [-172.5 + 15 * i, 0],
      };
    }
    const ring = buildMap(places);
    for (let seed = 1; seed <= 30; seed++) {
      const spec = generatePublicMission('great_connection', ring, DEFAULT_RULES, seededRandom(seed));
      if (spec?.kind !== 'great_connection') throw new Error(`seed ${seed}: no endpoints`);
      const [a, b] = spec.endpoints.map((id) => Number(id.slice(1))) as [number, number];
      expect(b - a - 1).toBeGreaterThanOrEqual(6);
      expect(b - a - 1).toBeLessThanOrEqual(10);
    }
  });

  it('pick a region of workable size that is not a whole continent', () => {
    const spec = generatePublicMission('regional_power', idx, DEFAULT_RULES, seededRandom(3));
    expect(spec).toMatchObject({ kind: 'regional_power', minTerritories: 3 });
    if (spec?.kind !== 'regional_power') throw new Error('no region');
    // Two rows of five; the islands (too little value) never qualify.
    expect(spec.territories).toHaveLength(10);
    expect(spec.region).not.toBe('Isles');
    expect(spec.needValue).toBe(Math.ceil(spec.totalValue * 0.6));
  });

  it('can generate every applicable kind on this map, keeping clear of other targets', () => {
    const taken = new Set<TerritoryId>();
    for (const kind of PUBLIC_MISSION_KINDS) {
      if (publicMissionIssue(kind, idx, free)) continue;
      const spec = generatePublicMission(kind, idx, free, seededRandom(5), taken);
      expect(spec, kind).not.toBeNull();
      for (const id of publicTargets(spec!)) {
        if (kind !== 'regional_power') expect(taken.has(id), `${kind} reuses ${id}`).toBe(false);
        taken.add(id);
      }
    }
  });

  it('offer the missions version 2 added only to campaigns of that version', () => {
    const v1 = parseRules({ victory: { mode: 'objectives', version: 1 } });
    const kinds = ['expansion', 'kingslayer', 'lightning_campaign', 'campaign_veteran'] as const;
    expect(publicMissionIssue('kingslayer', idx, v1)).toMatch(/before it was added/);
    expect(generatePublicMissions(kinds, idx, v1, Math.random)).toMatchObject({
      error: expect.stringMatching(/added/),
    });
    expect(generatePublicMissions(kinds, idx, v2, Math.random)).toEqual({
      missions: [
        { kind: 'expansion', gain: 15 },
        { kind: 'kingslayer' },
        { kind: 'lightning_campaign', wins: 2 },
        { kind: 'campaign_veteran', wins: 3, opponents: 2, attackWins: 1 },
      ],
    });
  });

  it('carry version 3’s numbers: records and giants harder, positions needing a conquest', () => {
    const kinds: PublicMissionKind[] = ['kingslayer', 'campaign_veteran', 'across_the_seas', 'lightning_campaign'];
    expect(generatePublicMissions(kinds, idx, v3, Math.random)).toEqual({
      missions: [
        { kind: 'kingslayer', lead: 4 },
        { kind: 'campaign_veteran', wins: 4, opponents: 3, attackWins: 4, attackOnly: true },
        { kind: 'across_the_seas', count: 2 },
        { kind: 'lightning_campaign', wins: 2 },
      ],
    });
    expect(generatePublicMission('great_powers', idx, v3, Math.random)).toEqual({
      kind: 'great_powers',
      minValue: 8,
      count: 3,
      newCount: 3,
    });
    expect(generatePublicMission('one_billion', idx, v3, Math.random)).toEqual({
      kind: 'one_billion',
      people: 2_000_000_000,
    });
    expect(generatePublicMission('great_expanse', idx, v3, Math.random)).toEqual({
      kind: 'great_expanse',
      areaKm2: 20_000_000,
    });
    for (const kind of ['strategic_positions', 'regional_power', 'great_connection', 'continental_bridge'] as const) {
      expect(generatePublicMission(kind, idx, DEFAULT_RULES, seededRandom(4)), kind).toMatchObject({
        needsConquest: true,
      });
      expect(generatePublicMission(kind, idx, v2, seededRandom(4)), kind).not.toHaveProperty('needsConquest');
    }
    expect(MISSION_RULES_V3.defaultPublic).toEqual([
      'expansion',
      'strategic_positions',
      'great_powers',
      'campaign_veteran',
    ]);
  });

  it('carry version 4’s numbers, written for values 1 to 20 (versions 5 and 6 keep them)', () => {
    expect(DEFAULT_RULES.victory.version).toBe(6);
    expect(MISSION_RULES_V4.valueScale).toBe(1.29);
    expect(generatePublicMission('expansion', idx, DEFAULT_RULES, Math.random)).toEqual({
      kind: 'expansion',
      gain: 22,
    });
    expect(generatePublicMission('expansion', idx, v3, Math.random)).toEqual({ kind: 'expansion', gain: 15 });
    expect(MISSION_RULES_V4).toMatchObject({
      regionalPower: { value: [26, 71] },
      strategicPositions: { value: [3, 15] },
      greatPowers: { minValue: 13, count: 3, newCount: 3 },
      hiddenTriangle: { value: [2, 12] },
      twoTheater: { netValue: 10 },
      measuredExpansion: { gain: 26, revealGain: 21 },
      fit: { value: 0.062, freeValue: 21 },
    });
  });

  it('keep The Great Connection and Mare Nostrum to tables of four or fewer, from version 3', () => {
    expect(publicMissionIssue('great_connection', idx, DEFAULT_RULES, 4)).toBeNull();
    expect(publicMissionIssue('great_connection', idx, DEFAULT_RULES, 5)).toMatch(/up to four players/);
    expect(publicMissionIssue('great_connection', idx, DEFAULT_RULES)).toBeNull();
    expect(publicMissionIssue('great_connection', idx, v2, 8)).toBeNull();
    const kinds: PublicMissionKind[] = ['expansion', 'great_connection', 'campaign_veteran', 'two_fronts'];
    expect(generatePublicMissions(kinds, idx, DEFAULT_RULES, seededRandom(1), 6)).toMatchObject({
      error: expect.stringMatching(/up to four players/),
    });
    for (let seed = 1; seed <= 30; seed++) {
      expect(drawPublicKinds(idx, DEFAULT_RULES, seededRandom(seed), 6)).not.toContain('great_connection');
    }
  });

  it('draw at most one mission that takes a long campaign, from version 3', () => {
    let longest = 0;
    let longestV2 = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const kinds = drawPublicKinds(idx, free, seededRandom(seed), 3);
      expect(kinds).toHaveLength(4);
      const long = kinds.filter((k) => MISSION_RULES_V3.long.includes(k)).length;
      expect(long, kinds.join()).toBeLessThanOrEqual(1);
      longest = Math.max(longest, long);
      const older = drawPublicKinds(
        idx,
        parseRules({ ...free, victory: { ...free.victory, version: 2 } }),
        seededRandom(seed),
      );
      longestV2 = Math.max(longestV2, older.filter((k) => MISSION_RULES_V3.long.includes(k)).length);
    }
    expect(longest).toBe(1);
    // Version 2 draws uniformly, with no limit.
    expect(longestV2).toBeGreaterThan(1);
  });

  it('draw four different playable missions at random, in catalog order', () => {
    const v1 = parseRules({ victory: { mode: 'objectives', version: 1 } });
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const kinds = drawPublicKinds(idx, DEFAULT_RULES, seededRandom(seed));
      expect(kinds).toHaveLength(4);
      expect(new Set(kinds).size).toBe(4);
      for (const kind of kinds) expect(publicMissionIssue(kind, idx, DEFAULT_RULES), kind).toBeNull();
      expect(kinds).toEqual(
        [...kinds].sort((a, b) => PUBLIC_MISSION_KINDS.indexOf(a) - PUBLIC_MISSION_KINDS.indexOf(b)),
      );
      kinds.forEach((k) => seen.add(k));
      for (const kind of drawPublicKinds(idx, v1, seededRandom(seed)))
        expect(MISSION_RULES_V1.publicKinds).toContain(kind);
    }
    // Every mission this map and a contiguous draft can play comes up, and nothing else.
    const playable = PUBLIC_MISSION_KINDS.filter((k) => publicMissionIssue(k, idx, DEFAULT_RULES) === null);
    expect([...seen].sort()).toEqual([...playable].sort());
    expect(seen).not.toContain('consolidation');
    const free = parseRules({ victory: { mode: 'objectives' }, draft: { mode: 'free' } });
    const inFree = Array.from({ length: 20 }, (_, i) => drawPublicKinds(idx, free, seededRandom(i + 1))).flat();
    expect(inFree).toContain('consolidation');
  });

  it('explain which of the new missions this map cannot hold', () => {
    expect(publicMissionIssue('mare_nostrum', idx, DEFAULT_RULES)).toMatch(/Mediterranean/);
    expect(publicMissionIssue('seven_wonders', idx, DEFAULT_RULES)).toMatch(/wonder/);
    // A million people and no known area per country.
    expect(publicMissionIssue('one_billion', idx, DEFAULT_RULES)).toMatch(/people/);
    expect(publicMissionIssue('great_expanse', idx, DEFAULT_RULES)).toMatch(/too small/);
  });

  it('refuses a set that repeats a mission, is the wrong size, or does not fit', () => {
    const r = DEFAULT_RULES;
    expect(
      generatePublicMissions(['expansion', 'expansion', 'two_fronts', 'great_powers'], idx, r, Math.random),
    ).toEqual({ error: 'Each public mission can only be chosen once.' });
    expect(generatePublicMissions(['expansion'], idx, r, Math.random)).toEqual({ error: 'Choose 4 public missions.' });
    expect(
      generatePublicMissions(['expansion', 'consolidation', 'two_fronts', 'great_powers'], idx, r, Math.random),
    ).toMatchObject({
      error: expect.stringMatching(/free drafts/),
    });
  });
});

describe('secret options', () => {
  const world4 = makeWorld(idx, quarters);

  it('deals up to three ranked options, each at least two conquests from done and not yet revealable', () => {
    const options = secretOptions(world4, ANN, DEFAULT_RULES, seededRandom(1));
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(3);
    expect(options.map((o) => o.rank)).toEqual(options.map((_, i) => i + 1));
    expect(options.map((o) => o.id)).toEqual(options.map((_, i) => `o${i + 1}`));
    expect(new Set(options.map((o) => o.spec.kind)).size).toBe(options.length);
    for (const o of options) {
      const e = evaluateMission(world4, ANN, o.spec);
      expect(e.complete, o.spec.kind).toBe(false);
      expect(e.near, o.spec.kind).toBe(false);
      expect(o.estimate.conquests, o.spec.kind).toBeGreaterThanOrEqual(2);
      expect(o.estimate.conquests, o.spec.kind).toBeLessThanOrEqual(MISSION_RULES_V1.effort.max);
    }
  });

  it('mixes families where it can: three options from three families, which three drawn with the seed', () => {
    const drawn = new Set<string>();
    for (const player of [ANN, BO, CY, DI]) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const families = secretOptions(world4, player, DEFAULT_RULES, seededRandom(seed)).map(
          (o) => missionInfo(o.spec.kind).family!,
        );
        expect(new Set(families).size, `${player} seed ${seed}`).toBe(3);
        families.forEach((f) => drawn.add(f));
      }
    }
    expect([...drawn].sort()).toEqual(['battle', 'expansion', 'region', 'route']);
  });

  it('deal only the missions of the campaign’s version', () => {
    const v1 = parseRules({ victory: { mode: 'objectives', version: 1 } });
    for (const seed of [1, 2, 3]) {
      for (const player of [ANN, BO, CY, DI]) {
        for (const c of secretCandidates(world4, player, v1, seededRandom(seed))) {
          expect(MISSION_RULES_V1.secretKinds).toContain(c.spec.kind);
        }
      }
    }
    const kinds = secretCandidates(world4, ANN, DEFAULT_RULES, seededRandom(1)).map((c) => c.spec.kind);
    expect(kinds).toEqual(expect.arrayContaining(['nemesis', 'backstab', 'iron_wall', 'checkmate_artist']));
  });

  it('mark the rival with the longest front for Nemesis', () => {
    const nemesis = secretCandidates(world4, ANN, DEFAULT_RULES, seededRandom(1)).find(
      (c) => c.spec.kind === 'nemesis',
    );
    // Cy borders Ann along five countries, Bo along four.
    expect(nemesis).toMatchObject({
      family: 'battle',
      spec: { rival: CY, count: 4, reveal: 3 },
      estimate: { conquests: 4, inTheWay: 0, rivals: 1 },
    });
  });

  it('deal version 3’s harder battles: Backstab two countries, Iron Wall from four players', () => {
    const kinds = (world: ReturnType<typeof makeWorld>, rules: CampaignRules) =>
      secretCandidates(world, ANN, rules, seededRandom(1)).map((c) => c.spec);
    expect(kinds(world4, DEFAULT_RULES)).toEqual(
      expect.arrayContaining([
        { kind: 'backstab', rounds: 2, count: 2 },
        { kind: 'iron_wall', wins: 3 },
        { kind: 'checkmate_artist', wins: 3 },
      ]),
    );
    const three = makeWorld(idx, {
      ...all(ANN, ...quarter(0, 0)),
      ...all(BO, ...quarter(5, 0), ...quarter(5, 4), 'I0', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'),
      ...all(CY, ...quarter(0, 4)),
    });
    expect(kinds(three, DEFAULT_RULES).map((s) => s.kind)).not.toContain('iron_wall');
    expect(kinds(three, v2).map((s) => s.kind)).toContain('iron_wall');
  });

  it('deal Nemesis from three players from version 6, when the rival it marks isn’t the only one', () => {
    const kinds = (world: ReturnType<typeof makeWorld>, rules: CampaignRules) =>
      secretCandidates(world, ANN, rules, seededRandom(1)).map((c) => c.spec.kind);
    const v5 = parseRules({ victory: { mode: 'objectives', version: 5 } });
    const two = makeWorld(idx, {
      ...all(ANN, ...quarter(0, 0), ...quarter(0, 4)),
      ...all(BO, ...quarter(5, 0), ...quarter(5, 4), 'I0', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'),
    });
    expect(kinds(two, DEFAULT_RULES)).not.toContain('nemesis');
    expect(kinds(two, v5)).toContain('nemesis');
    const three = makeWorld(idx, {
      ...all(ANN, ...quarter(0, 0)),
      ...all(BO, ...quarter(5, 0), ...quarter(5, 4), 'I0', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'),
      ...all(CY, ...quarter(0, 4)),
    });
    expect(kinds(three, DEFAULT_RULES)).toContain('nemesis');
  });

  it('mark for Buffer Zone the most valuable drafted country with three to six neighbors', () => {
    const map = buildMap({
      BIG: { v: 9, land: ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'] },
      CAP: { v: 6, land: ['BIG', 'R1', 'R2'] },
      N1: { v: 1 },
      N2: { v: 1 },
      N3: { v: 1 },
      N4: { v: 1 },
      N5: { v: 1 },
      N6: { v: 1 },
      N7: { v: 1 },
      R1: { v: 2 },
      R2: { v: 2 },
    });
    const owners = { ...all(ANN, 'BIG', 'CAP'), ...all(BO, 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'R1', 'R2') };
    const zone = secretCandidates(makeWorld(map, owners), ANN, DEFAULT_RULES, seededRandom(1)).find(
      (c) => c.spec.kind === 'buffer_zone',
    );
    // BIG has eight neighbors: too many to ring.
    expect(zone).toMatchObject({
      family: 'region',
      spec: { center: 'CAP', ring: ['BIG', 'R1', 'R2'] },
      estimate: { conquests: 2 },
    });
  });

  it('offer Half of Humanity only to an empire holding one of the two most populous countries', () => {
    const map = buildMap({
      IND: { v: 5, land: ['X1'], people: 400 },
      CHN: { v: 5, land: ['X2'], people: 350 },
      X1: { v: 1, land: ['X2'], people: 50 },
      X2: { v: 1, land: ['X3'], people: 50 },
      X3: { v: 1, people: 150 },
    });
    const world = makeWorld(map, { IND: ANN, ...all(BO, 'CHN', 'X1', 'X2'), X3: CY });
    const kinds = (userId: string) =>
      secretCandidates(world, userId, DEFAULT_RULES, seededRandom(1)).map((c) => c.spec.kind);
    expect(kinds(ANN)).toContain('half_of_humanity');
    expect(kinds(CY)).not.toContain('half_of_humanity');
  });

  it('are the same for the same seed', () => {
    expect(secretOptions(world4, BO, DEFAULT_RULES, seededRandom(9))).toEqual(
      secretOptions(world4, BO, DEFAULT_RULES, seededRandom(9)),
    );
  });

  it('vary with the private seed, so rivals cannot work them out from the map and the draft', () => {
    const deals = Array.from({ length: 12 }, (_, seed) =>
      JSON.stringify(secretOptions(world4, BO, DEFAULT_RULES, seededRandom(seed + 1)).map((o) => o.spec)),
    );
    expect(new Set(deals).size).toBeGreaterThan(3);
    // Each kind's instance is drawn from its best few: Encirclement doesn't always circle the same country.
    const centers = new Set(
      Array.from({ length: 12 }, (_, seed) =>
        secretCandidates(world4, BO, DEFAULT_RULES, seededRandom(seed + 1)).flatMap((c) =>
          c.spec.kind === 'encirclement' ? [c.spec.center] : [],
        ),
      ).flat(),
    );
    expect(centers.size).toBeGreaterThan(1);
  });

  it('offer Protected Expansion only with four or more players', () => {
    const kinds = (world: ReturnType<typeof makeWorld>) =>
      [1, 2, 3, 4, 5].flatMap((seed) =>
        secretOptions(world, ANN, DEFAULT_RULES, seededRandom(seed)).map((o) => o.spec.kind),
      );
    const two = makeWorld(idx, {
      ...all(ANN, ...quarter(0, 0), ...quarter(0, 4)),
      ...all(BO, ...quarter(5, 0), ...quarter(5, 4), 'I0', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'),
    });
    expect(kinds(two)).not.toContain('protected_expansion');
  });

  it('consider Unification only for an empire drafted in pieces, needing two conquests to join them', () => {
    const kinds = (world: ReturnType<typeof makeWorld>) =>
      secretCandidates(world, ANN, DEFAULT_RULES, seededRandom(1)).map((c) => c.spec.kind);
    expect(kinds(world4)).not.toContain('unification');
    // Ann drafted two separate blocks, two columns apart.
    const pieces = {
      ...quarters,
      ...all(BO, 'G20', 'G21', 'G22', 'G23', 'G30', 'G31', 'G32', 'G33'),
      ...all(ANN, 'G50', 'G51', 'G60', 'G61'),
    };
    const world = makeWorld(idx, pieces);
    const unification = secretCandidates(world, ANN, DEFAULT_RULES, seededRandom(1)).find(
      (c) => c.spec.kind === 'unification',
    );
    expect(unification).toMatchObject({ family: 'route', estimate: { conquests: 2, inTheWay: 2 } });
    if (unification?.spec.kind !== 'unification') throw new Error('no unification');
    // The marks are the most valuable country of each piece, joined only through Bo's columns.
    expect(unification.spec.marks.every((id) => world.owners.get(id) === ANN)).toBe(true);
    // One column apart would need a single conquest: not offered.
    const close = { ...quarters, ...all(BO, 'G20', 'G21', 'G22', 'G23') };
    expect(kinds(makeWorld(idx, close))).not.toContain('unification');
  });

  it('only deal a named set with every country on the map, within reach, and at least two conquests away', () => {
    const atlantic = buildMap({
      USA: { v: 10, land: ['CAN'] },
      CAN: { v: 8, sea: ['GRL'] },
      GRL: { v: 1, sea: ['ISL'] },
      ISL: { v: 2, sea: ['GBR'] },
      GBR: { v: 8, land: ['IRL'] },
      IRL: { v: 5, land: ['FAR1'] },
      FAR1: { v: 3, land: ['FAR2'] },
      FAR2: { v: 3, land: ['FAR3'] },
      FAR3: { v: 3, land: ['FAR4'] },
      FAR4: { v: 3 },
    });
    const kinds = (owners: Record<string, string>) =>
      [1, 2, 3, 4, 5, 6].flatMap((s) =>
        secretOptions(makeWorld(atlantic, owners), ANN, DEFAULT_RULES, seededRandom(s)).map((o) => o.spec.kind),
      );
    const near = {
      USA: ANN,
      ...all(BO, 'CAN', 'GRL', 'ISL', 'GBR', 'IRL'),
      ...all(CY, 'FAR1', 'FAR2', 'FAR3', 'FAR4'),
    };
    expect(kinds(near)).toContain('northern_passage');
    // Holding three of the four would leave one conquest: never dealt.
    const three = {
      ...all(ANN, 'USA', 'CAN', 'GRL', 'ISL'),
      ...all(BO, 'GBR', 'IRL'),
      ...all(CY, 'FAR1', 'FAR2', 'FAR3', 'FAR4'),
    };
    expect(kinds(three)).not.toContain('northern_passage');
    // No plausible access to the North Atlantic from the far end.
    const far = { ...all(BO, 'USA', 'CAN', 'GRL', 'ISL', 'GBR', 'IRL', 'FAR1', 'FAR2'), ...all(ANN, 'FAR3', 'FAR4') };
    expect(kinds(far)).not.toContain('northern_passage');
  });

  it('fall back to Measured Expansion when fewer than three others fit, and to nothing when nothing does', () => {
    // Version 1, which deals no battle missions: those fit anyone with an opponent.
    const v1 = parseRules({ victory: { mode: 'objectives', version: 1 } });
    const small = buildMap({
      H: { v: 1, land: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'] },
      Y1: { v: 6 },
      Y2: { v: 6 },
      Y3: { v: 6 },
      Y4: { v: 4 },
      Y5: { v: 2 },
    });
    const options = secretOptions(
      makeWorld(small, { H: ANN, ...all(BO, 'Y1', 'Y2', 'Y3', 'Y4', 'Y5') }),
      ANN,
      v1,
      seededRandom(1),
    );
    expect(options.map((o) => o.spec.kind)).toContain('measured_expansion');
    const tiny = buildMap({ H: { v: 1, land: ['Y'] }, Y: { v: 1 } });
    expect(secretOptions(makeWorld(tiny, { H: ANN, Y: BO }), ANN, v1, seededRandom(1))).toEqual([]);
    // Version 2 always has battles to offer; version 3 keeps Iron Wall for four players or more.
    expect(
      secretOptions(makeWorld(tiny, { H: ANN, Y: BO }), ANN, v2, seededRandom(1))
        .map((o) => o.spec.kind)
        .sort(),
    ).toEqual(['backstab', 'checkmate_artist', 'iron_wall']);
    expect(
      secretOptions(makeWorld(tiny, { H: ANN, Y: BO }), ANN, DEFAULT_RULES, seededRandom(1))
        .map((o) => o.spec.kind)
        .sort(),
    ).toEqual(['backstab', 'checkmate_artist']);
  });
});
