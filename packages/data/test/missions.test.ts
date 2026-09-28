import {
  EMPTY_HISTORY,
  MISSION_RULES_V1,
  PUBLIC_MISSION_KINDS,
  captureCosts,
  components,
  crossesMapEdge,
  evaluateMission,
  generatePublicMission,
  generatePublicMissions,
  hopDistances,
  indexDataset,
  parseRules,
  pickerAt,
  publicMissionIssue,
  regionsFor,
  secretOptions,
  seededRandom,
  shuffled,
  suggestPick,
  type Dataset,
  type MissionWorld,
  type TerritoryId,
} from '@empire/rules';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Victory missions on the real map: every named place resolves and generation finds workable targets. */
const DATASETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'datasets');
const readJson = <T>(...parts: string[]): T => JSON.parse(readFileSync(path.join(DATASETS, ...parts), 'utf8')) as T;
const index = readJson<{ latest: string; versions: string[] }>('index.json');
const dataset = readJson<Dataset>(index.latest, 'territories.json');
const idx = indexDataset(dataset);
const objectives = parseRules({ victory: { mode: 'objectives' } });
const freeDraft = parseRules({ victory: { mode: 'objectives' }, draft: { mode: 'free' } });

/** A whole-map draft where everyone takes the most valuable legal country, in a seeded snake order. */
function simulateDraft(players: string[], rules = objectives, seed = 1): Map<TerritoryId, string> {
  const order = shuffled(players, seededRandom(seed));
  const owners = new Map<TerritoryId, string>();
  for (let pick = 0; pick < idx.ids.length; pick++) {
    const picker = pickerAt(order, pick);
    const choice = suggestPick(idx, rules, owners, picker);
    if (!choice) break;
    owners.set(choice, picker);
  }
  return owners;
}

function worldAfterDraft(owners: Map<TerritoryId, string>, players: string[]): MissionWorld {
  const baseline = new Map(players.map((p) => [p, new Set([...owners].filter(([, o]) => o === p).map(([id]) => id))]));
  return { idx, players, owners, baseline, history: EMPTY_HISTORY };
}

describe(`missions on ${index.latest}`, () => {
  it('resolves every named set to countries on the map that hang together', () => {
    for (const set of MISSION_RULES_V1.namedSets) {
      for (const id of set.territories) expect(idx.byId.has(id), `${set.kind}: ${id}`).toBe(true);
      expect(components(idx, new Set(set.territories)), set.kind).toHaveLength(1);
    }
  });

  it('finds regions of workable size for Regional Power, never a whole continent', () => {
    const regions = regionsFor(idx, MISSION_RULES_V1);
    expect(regions.length).toBeGreaterThanOrEqual(5);
    for (const r of regions) {
      expect(r.territories.length).toBeGreaterThanOrEqual(5);
      expect(r.territories.length).toBeLessThanOrEqual(12);
    }
    expect(regions.map((r) => r.name)).not.toContain('South America');
    expect(regions.map((r) => r.name)).toContain('Western Europe');
  });

  it('can play every public mission, Consolidation in free drafts only', () => {
    for (const kind of PUBLIC_MISSION_KINDS) {
      const issue = publicMissionIssue(kind, idx, objectives);
      expect(issue, kind).toEqual(kind === 'consolidation' ? expect.stringMatching(/free drafts/) : null);
      expect(publicMissionIssue(kind, idx, freeDraft), kind).toBeNull();
    }
  });

  it('finds the links that cross the edge of the map', () => {
    const edge = idx.ids.flatMap((a) =>
      idx
        .neighbors(a)
        .filter((b) => a < b && crossesMapEdge(idx, a, b))
        .map((b) => `${a}-${b}`),
    );
    expect(edge.sort()).toEqual(['FJI-POLYNESIA', 'MICRONESIA-POLYNESIA', 'NZL-POLYNESIA', 'RUS-USA']);
  });

  it('generates the default set for many seeds, with spread positions and routes that stay on the map', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = generatePublicMissions(MISSION_RULES_V1.defaultPublic, idx, objectives, seededRandom(seed));
      if ('error' in result) throw new Error(`seed ${seed}: ${result.error}`);
      const [, positions, connection] = result.missions;
      if (positions?.kind !== 'strategic_positions' || connection?.kind !== 'great_connection')
        throw new Error('kinds');
      expect(new Set(positions.territories.map((id) => idx.byId.get(id)!.subregion)).size).toBeGreaterThan(1);
      for (const id of positions.territories) expect(idx.byId.get(id)!.micro).toBe(false);
      expect(positions.territories.some((id) => connection.endpoints.includes(id))).toBe(false);
      const [a, b] = connection.endpoints;
      expect(idx.byId.get(a)!.subregion).not.toBe(idx.byId.get(b)!.subregion);
      const between = hopDistances(idx, a).get(b)! - 1;
      expect(between, `${a}-${b}`).toBeGreaterThanOrEqual(6);
      expect(between, `${a}-${b}`).toBeLessThanOrEqual(10);
      expect(hopDistances(idx, a, { onMap: true }).get(b)! - 1, `${a}-${b}`).toBe(between);
    }
  });

  it('generates every kind with fresh targets', () => {
    for (const kind of PUBLIC_MISSION_KINDS) {
      expect(generatePublicMission(kind, idx, freeDraft, seededRandom(3)), kind).not.toBeNull();
    }
  });

  it.each([2, 3, 4, 8])('deals every player valid secret options after a %i-player draft', (n) => {
    const players = ['ann', 'bo', 'cy', 'di', 'ed', 'flo', 'gus', 'hal'].slice(0, n);
    for (const [rules, seed] of [
      [objectives, 1],
      [freeDraft, 2],
    ] as const) {
      const world = worldAfterDraft(simulateDraft(players, rules, seed), players);
      for (const p of players) {
        const options = secretOptions(world, p, rules, seededRandom(seed * 100 + players.indexOf(p)));
        expect(options.length, `${rules.draft.mode} ${n}p ${p}`).toBeGreaterThanOrEqual(1);
        expect(options.length).toBeLessThanOrEqual(3);
        for (const o of options) {
          const e = evaluateMission(world, p, o.spec);
          expect(e.complete || e.near, `${p} ${o.spec.kind}`).toBe(false);
          expect(o.estimate.conquests).toBeGreaterThanOrEqual(2);
          if (o.spec.kind === 'protected_expansion') expect(n).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it('deals the Northern Passage only to empires near the North Atlantic', () => {
    const players = ['ann', 'bo', 'cy', 'di'];
    let dealtTo = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const owners = simulateDraft(players, objectives, seed);
      const world = worldAfterDraft(owners, players);
      for (const p of players) {
        const dealt = secretOptions(world, p, objectives, seededRandom(seed)).find(
          (o) => o.spec.kind === 'northern_passage',
        );
        if (!dealt) continue;
        dealtTo++;
        expect(dealt.estimate.conquests).toBeLessThanOrEqual(MISSION_RULES_V1.effort.max);
        // Within reach: at most three conquests from Canada, Greenland, Iceland or the United Kingdom.
        const costs = captureCosts(idx, new Set([...owners].filter(([, o]) => o === p).map(([id]) => id)));
        const nearest = Math.min(...['CAN', 'GRL', 'ISL', 'GBR'].map((id) => costs.cost.get(id) ?? Infinity));
        expect(nearest, `${p} dealt Northern Passage far from the Atlantic`).toBeLessThanOrEqual(
          MISSION_RULES_V1.effort.reach,
        );
      }
    }
    expect(dealtTo).toBeGreaterThan(0);
  });
});
