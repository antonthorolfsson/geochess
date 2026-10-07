import {
  DEFAULT_RULES,
  indexDataset,
  type CampaignView,
  type ClaimView,
  type MissionView,
  type VictoryResultView,
  type VictoryView,
  type WarView,
} from '@empire/rules';
import { lineDataset } from '@empire/rules/testing';
import { describe, expect, it } from 'vitest';
import { buildModel } from './campaign';
import {
  claimTiming,
  findMission,
  missionOverlay,
  pointsRace,
  progressOf,
  rivalClaims,
  tiebreakClause,
} from './victory';

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
    deleteAt: null,
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
      hold: 'time',
      holdMs: 24 * 3_600_000,
      lastRound: null,
      tiebreak: 'realWorld',
      publicMissions: [positions],
      titles: [],
      titlePoints: 0,
      players: [
        {
          userId: 'ann',
          points: 4,
          titles: [],
          awards: [],
          ready: true,
          secret: null,
          progress: { p0: evaluation(2) },
        },
        { userId: 'bo', points: 4, titles: [], awards: [], ready: true, secret: null, progress: { p0: evaluation(1) } },
        { userId: 'cy', points: 6, titles: [], awards: [], ready: true, secret: null, progress: { p0: evaluation(0) } },
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
        { userId: 'ann', points: 0, titles: [], awards: [], ready: true, secret: null, progress: {} },
        {
          userId: 'bo',
          points: 0,
          titles: [],
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
    turnsHeld: false,
    blockedBy: [],
  };

  it('say when a claim could score, without promising it will', () => {
    const model = buildModel(view({ claims: [claim] }), user('ann'), idx)!;
    expect(rivalClaims(model)).toEqual([claim]);
    const early = claimTiming(model, claim, Date.parse('2026-01-01T00:00:00.000Z'));
    expect(early).toMatchObject({
      round: 'Can score in round 5 at the earliest.',
      hold: 'The 24 hours holding time starts with round 4.',
      roundDue: false,
    });
    const timed = { ...claim, eligibleAt: '2026-01-03T00:00:00.000Z' };
    expect(claimTiming(model, timed, Date.parse('2026-01-02T12:00:00.000Z')).hold).toBe(
      'At least 12h 0m more to hold.',
    );
    expect(claimTiming(model, timed, Date.parse('2026-01-03T00:00:00.000Z')).hold).toBeNull();
  });

  it('held by turns, wait for everyone’s turns in a round after the claim’s, however long it takes', () => {
    const model = (round: number) => buildModel(view({ claims: [claim], hold: 'turns' }, { round }), user('ann'), idx)!;
    expect(claimTiming(model(3), claim, 0)).toMatchObject({
      hold: 'It waits for everyone’s turns to declare war in round 4.',
      roundDue: false,
    });
    // The host moved on to round 5 before round 4's turns were over: round 5's count instead.
    expect(claimTiming(model(5), claim, 0)).toMatchObject({
      hold: 'It waits for everyone’s turns to declare war in round 5.',
      roundDue: true,
    });
    expect(claimTiming(model(5), { ...claim, turnsHeld: true }, 0)).toMatchObject({
      hold: null,
      held: 'Everyone has had their turns to declare war since.',
    });
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

describe('the end of the season', () => {
  const standing = (userId: string, points: number, measures?: number[]) => ({
    userId,
    points,
    value: 10,
    ...(measures && { measures }),
    countries: 3,
    awards: [],
    secret: null,
  });
  const result = (
    winners: string[],
    standings: VictoryResultView['standings'],
    more: Partial<VictoryResultView> = {},
  ) => ({
    winners,
    round: 25,
    finishedAt: '2026-01-01T00:00:00.000Z',
    seasonEnd: true,
    tiebreak: 'realWorld' as const,
    standings,
    holdings: {},
    ...more,
  });

  it('says nothing more when points alone decided it', () => {
    expect(tiebreakClause(result(['ann'], [standing('ann', 6, [1, 1, 1]), standing('bo', 5, [9, 9, 9])]))).toBe('');
    expect(tiebreakClause(result(['ann'], [standing('ann', 9)], { seasonEnd: false }))).toBe('');
  });

  it('names the measure that separated players level on points, with both figures', () => {
    const byPeople = result(['ann'], [standing('ann', 5, [812e6, 1e6, 1e12]), standing('bo', 5, [640e6, 9e6, 9e12])]);
    expect(tiebreakClause(byPeople)).toBe(', then the larger population: 812M to 640M');
    const byGdp = result(['bo'], [standing('bo', 5, [5e6, 2e5, 3.2e11]), standing('ann', 5, [5e6, 2e5, 1.5e11])]);
    expect(tiebreakClause(byGdp)).toBe(', then the larger GDP: $320B to $150B');
  });

  it('says the winners who share it were level on the tiebreak too', () => {
    const shared = result(['ann', 'bo'], [standing('ann', 5, [1, 2, 3]), standing('bo', 5, [1, 2, 3])]);
    expect(tiebreakClause(shared)).toBe(', and the winners were level on population, land area and GDP too');
  });

  it('reads results stored before the real-world tiebreak as decided by value', () => {
    const stored = result(['ann'], [standing('ann', 5), standing('bo', 5)], { tiebreak: undefined });
    expect(tiebreakClause(stored)).toBe(', then the most valuable empire');
  });
});
