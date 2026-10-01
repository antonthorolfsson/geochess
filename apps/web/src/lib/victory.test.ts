import {
  DEFAULT_RULES,
  indexDataset,
  type CampaignView,
  type ClaimView,
  type MissionView,
  type VictoryView,
  type WarView,
} from '@empire/rules';
import { lineDataset } from '@empire/rules/testing';
import { describe, expect, it } from 'vitest';
import { buildModel } from './campaign';
import { claimTiming, findMission, missionOverlay, pointsRace, progressOf, rivalClaims } from './victory';

const idx = indexDataset(lineDataset());
const member = (userId: string, color: number) => ({
  userId,
  name: userId === 'ann' ? 'Ann' : userId === 'bo' ? 'Bo' : 'Cy',
  lichessUsername: null,
  color,
  autodraft: false,
  tokens: 1,
  reputation: 100,
  joinedAt: '2026-01-01T00:00:00.000Z',
  bot: null,
  rating: null,
});
const positions: MissionView = {
  key: 'p0',
  scope: 'public',
  points: 2,
  spec: { kind: 'strategic_positions', territories: ['A', 'C', 'E'], need: 2 },
};
const bosSecret: MissionView = {
  key: 'secret',
  scope: 'secret',
  points: 3,
  spec: { kind: 'hidden_triangle', territories: ['B', 'D', 'F'], need: 3, reveal: 2 },
};
const evaluation = (have: number) => ({
  complete: have >= 2,
  near: have >= 1,
  parts: [{ label: 'Positions held', have, need: 2, done: have >= 2 }],
  evidence: { territories: ['A', 'C'].slice(0, have) },
});

function view(victory: Partial<VictoryView>, overrides: Partial<CampaignView> = {}): CampaignView {
  return {
    id: 'c1',
    name: 'Test',
    status: 'active',
    round: 4,
    hostId: 'ann',
    rules: DEFAULT_RULES,
    datasetVersion: 'test',
    inviteCode: 'code',
    createdAt: '2026-01-01T00:00:00.000Z',
    members: [member('ann', 0), member('bo', 3), member('cy', 5)],
    holdings: { A: 'ann', B: 'bo', C: 'ann', D: 'cy', E: 'bo', F: 'cy' },
    draft: null,
    myDraftList: [],
    myAutodraftFallback: 'best',
    turns: null,
    events: [],
    wars: [],
    truces: [],
    acquired: {},
    fortified: {},
    accords: [],
    victory: {
      version: 1,
      pointsToWin: 7,
      publicPoints: 2,
      secretPoints: 3,
      holdMs: 24 * 3_600_000,
      lastRound: null,
      publicMissions: [positions],
      players: [
        { userId: 'ann', points: 4, awards: [], ready: true, secret: null, progress: { p0: evaluation(2) } },
        { userId: 'bo', points: 4, awards: [], ready: true, secret: null, progress: { p0: evaluation(1) } },
        { userId: 'cy', points: 6, awards: [], ready: true, secret: null, progress: { p0: evaluation(0) } },
      ],
      claims: [],
      selection: null,
      result: null,
      ...victory,
    },
    mySecret: null,
    ...overrides,
  };
}

const user = (id: string) => ({ id, name: id, email: null, lichessUsername: null, hasPassword: false });

describe('the race', () => {
  it('ranks by points, then by name, never by order of arrival', () => {
    const model = buildModel(view({}), user('ann'), idx)!;
    expect(pointsRace(model)).toEqual([
      { userId: 'cy', points: 6 },
      { userId: 'ann', points: 4 },
      { userId: 'bo', points: 4 },
    ]);
  });
});

describe('seeing missions', () => {
  it('never finds another player’s secret mission until it is revealed', () => {
    const hidden = buildModel(view({}), user('ann'), idx)!;
    expect(findMission(hidden, 'bo', 'secret')).toBeNull();
    expect(progressOf(hidden, 'bo', 'secret')).toBeUndefined();

    const revealed = view({
      players: [
        { userId: 'ann', points: 0, awards: [], ready: true, secret: null, progress: {} },
        {
          userId: 'bo',
          points: 0,
          awards: [],
          ready: true,
          secret: { mission: bosSecret, revealedRound: 3, revealedAt: '2026-01-02T00:00:00.000Z', reason: 'near' },
          progress: { secret: evaluation(1) },
        },
      ],
    });
    const model = buildModel(revealed, user('ann'), idx)!;
    expect(findMission(model, 'bo', 'secret')).toEqual({ mission: bosSecret, ownerId: 'bo' });
  });

  it('finds the viewer’s own secret mission, and its private progress', () => {
    const own = view(
      {},
      {
        mySecret: {
          options: null,
          mission: bosSecret,
          auto: false,
          none: false,
          revealed: false,
          progress: evaluation(1),
        },
      },
    );
    const model = buildModel(own, user('bo'), idx)!;
    expect(findMission(model, 'bo', 'secret')?.mission).toEqual(bosSecret);
    expect(progressOf(model, 'bo', 'secret')).toEqual(evaluation(1));
  });

  it('calls out a mission’s targets and what counts, or a whole theater', () => {
    const model = buildModel(view({}), user('ann'), idx)!;
    expect(missionOverlay(model, positions.spec, evaluation(2))).toEqual({
      targets: ['A', 'C', 'E'],
      held: ['A', 'C'],
      path: null,
    });
    const theater = missionOverlay(
      model,
      { kind: 'two_theater_power', continents: ['europe', 'asia'], netValue: 8, newCount: 2 },
      undefined,
    );
    expect(theater.targets).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });
});

describe('claims', () => {
  const claim: ClaimView = {
    id: 7,
    userId: 'bo',
    missionKey: 'p0',
    status: 'pending',
    startedRound: 3,
    startedAt: '2026-01-01T00:00:00.000Z',
    eligibleRound: 5,
    eligibleAt: null,
    blockedBy: [],
  };

  it('say when a claim could score, without promising it will', () => {
    const model = buildModel(view({ claims: [claim] }), user('ann'), idx)!;
    expect(rivalClaims(model)).toEqual([claim]);
    const early = claimTiming(model, claim, Date.parse('2026-01-01T00:00:00.000Z'));
    expect(early).toMatchObject({
      round: 'Can score in round 5 at the earliest.',
      time: 'The 24 hours holding time starts with round 4.',
      roundDue: false,
    });
    const timed = { ...claim, eligibleAt: '2026-01-03T00:00:00.000Z' };
    expect(claimTiming(model, timed, Date.parse('2026-01-02T12:00:00.000Z')).time).toBe(
      'At least 12h 0m more to hold.',
    );
    expect(claimTiming(model, timed, Date.parse('2026-01-03T00:00:00.000Z')).time).toBeNull();
  });

  it('name the wars that hold a claim back', () => {
    const war: WarView = {
      id: 'w1',
      attackerId: 'bo',
      defenderId: 'ann',
      targetId: 'C',
      launchId: 'B',
      stake: ['B'],
      redirectedFrom: null,
      status: 'playing',
      counter: null,
      outcome: null,
      declaredRound: 4,
      resolvedRound: null,
      respondBy: null,
      declaredAt: '2026-01-01T00:00:00.000Z',
      resolvedAt: null,
      games: [],
      reserves: [],
      peace: [],
    };
    const blocked = { ...claim, blockedBy: ['w1'] };
    const model = buildModel(view({ claims: [blocked] }, { wars: [war] }), user('ann'), idx)!;
    expect(claimTiming(model, blocked, 0).blockers).toEqual([war]);
  });
});
