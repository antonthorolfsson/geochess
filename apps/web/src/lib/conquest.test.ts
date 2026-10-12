import { DEFAULT_RULES, indexDataset, type CampaignView, type EventView, type WarView } from '@empire/rules';
import { makeTerritory } from '@empire/rules/testing';
import { describe, expect, it } from 'vitest';
import { buildModel } from './campaign';
import { conquestSteps, conquestsFrom } from './conquest';

/**
 * K - L - T - X - Y      F - G
 * Ann holds K, L and G; Bo holds T, X, Y and F (F borders none of Ann's but G).
 */
const idx = indexDataset({
  version: 'test',
  generatedAt: '2026-01-01T00:00:00.000Z',
  attribution: [],
  territories: [
    makeTerritory('F', 2, ['G'], []),
    makeTerritory('G', 2, ['F'], []),
    makeTerritory('K', 3, ['L'], []),
    makeTerritory('L', 4, ['K', 'T'], []),
    makeTerritory('T', 5, ['L', 'X'], []),
    makeTerritory('X', 3, ['T', 'Y'], []),
    makeTerritory('Y', 2, ['X'], []),
  ],
  seaLanes: [],
});
const neighbors = idx.neighbors;

const member = (userId: string, color: number) => ({
  userId,
  name: userId === 'ann' ? 'Ann' : userId === 'bo' ? 'Bo' : 'Cy',
  lichessUsername: null,
  color,
  autodraft: false,
  tokens: 2,
  reputation: 100,
  joinedAt: '2026-01-01T00:00:00.000Z',
  bot: null,
  rating: null,
});

/** Ann attacks T from L, staking L and K: the game is on. */
const WAR: WarView = {
  id: 'w1',
  attackerId: 'ann',
  defenderId: 'bo',
  targetId: 'T',
  launchId: 'L',
  stake: ['L', 'K'],
  redirectedFrom: null,
  status: 'playing',
  counter: null,
  outcome: null,
  declaredRound: 2,
  resolvedRound: null,
  respondBy: null,
  declaredAt: '2026-01-01T00:00:00.000Z',
  resolvedAt: null,
  games: [],
  reserves: [],
  peace: [],
};

const view: CampaignView = {
  id: 'c1',
  name: 'Test',
  status: 'active',
  round: 2,
  hostId: 'ann',
  rules: DEFAULT_RULES,
  datasetVersion: 'test',
  inviteCode: 'code',
  createdAt: '2026-01-01T00:00:00.000Z',
  deleteAt: null,
  members: [member('ann', 0), member('bo', 3), member('cy', 5)],
  holdings: { K: 'ann', L: 'ann', G: 'ann', T: 'bo', X: 'bo', Y: 'bo', F: 'bo' },
  draft: null,
  myDraftList: [],
  myAutodraftFallback: 'best',
  turns: null,
  events: [],
  wars: [WAR],
  truces: [],
  acquired: {},
  fortified: {},
  accords: [],
  victory: null,
  mySecret: null,
};
const user = (id: string) => ({ id, name: id, email: null, lichessUsername: null, hasPassword: false });
const modelFor = (viewer: string) => buildModel(view, user(viewer), idx)!;

let eventId = 40;
const resolved = (
  outcome: 'attacker' | 'defender' | 'held' | 'settled',
  transfers: { territoryId: string; from: string; to: string }[],
): EventView => ({
  id: ++eventId,
  round: 2,
  actorId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  type: 'war.resolved',
  payload: { warId: 'w1', outcome, transfers },
});

describe('the order countries fall in', () => {
  it('spreads from the source, wave by wave', () => {
    expect(conquestSteps(neighbors, 'L', ['X', 'T'], () => false)).toEqual([
      { id: 'T', from: 'L', wave: 0 },
      { id: 'X', from: 'T', wave: 1 },
    ]);
    expect(conquestSteps(neighbors, 'T', ['L', 'K'], () => false)).toEqual([
      { id: 'L', from: 'T', wave: 0 },
      { id: 'K', from: 'L', wave: 1 },
    ]);
  });

  it('brings a country the spread never reaches from a neighbor the winner holds, or else from the source', () => {
    expect(conquestSteps(neighbors, 'L', ['T', 'F'], (id) => id === 'G')).toEqual([
      { id: 'T', from: 'L', wave: 0 },
      { id: 'F', from: 'G', wave: 0 },
    ]);
    expect(conquestSteps(neighbors, 'L', ['F'], () => false)).toEqual([{ id: 'F', from: 'L', wave: 0 }]);
    expect(conquestSteps(neighbors, null, ['T'], () => false)).toEqual([{ id: 'T', from: null, wave: 0 }]);
  });
});

describe('conquests from campaign events', () => {
  it("crawls a winning attacker's color over the target from the country it attacked from", () => {
    const event = resolved('attacker', [{ territoryId: 'T', from: 'bo', to: 'ann' }]);
    expect(conquestsFrom(modelFor('ann'), [event])).toEqual([
      {
        key: `${event.id}:bo>ann`,
        color: 0,
        previous: 3,
        steps: [{ id: 'T', from: 'L', wave: 0 }],
        frame: true,
      },
    ]);
  });

  it("crawls a winning defender's color over the stake from the country they defended", () => {
    const event = resolved('defender', [
      { territoryId: 'L', from: 'ann', to: 'bo' },
      { territoryId: 'K', from: 'ann', to: 'bo' },
    ]);
    const [conquest] = conquestsFrom(modelFor('bo'), [event]);
    expect(conquest).toMatchObject({ color: 3, previous: 0, frame: true });
    expect(conquest!.steps).toEqual([
      { id: 'L', from: 'T', wave: 0 },
      { id: 'K', from: 'L', wave: 1 },
    ]);
  });

  it('plays for everyone, but frames only for the two at war', () => {
    const event = resolved('attacker', [{ territoryId: 'T', from: 'bo', to: 'ann' }]);
    expect(conquestsFrom(modelFor('cy'), [event])[0]!.frame).toBe(false);
  });

  it('makes one conquest for each way countries went, and none where nothing changed hands', () => {
    const settled = resolved('settled', [
      { territoryId: 'T', from: 'bo', to: 'ann' },
      { territoryId: 'K', from: 'ann', to: 'bo' },
    ]);
    const held = resolved('held', []);
    const conquests = conquestsFrom(modelFor('ann'), [held, settled]);
    expect(conquests.map((c) => [c.color, c.steps])).toEqual([
      [0, [{ id: 'T', from: 'L', wave: 0 }]],
      // K borders only L, which isn't Bo's: it comes from the country Bo defended, across the map.
      [3, [{ id: 'K', from: 'T', wave: 0 }]],
    ]);
  });
});
