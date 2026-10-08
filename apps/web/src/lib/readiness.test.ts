import {
  DEFAULT_RULES,
  indexDataset,
  type CampaignRules,
  type CampaignView,
  type ClaimView,
  type MissionView,
  type VictoryView,
  type WarView,
} from '@empire/rules';
import { lineDataset } from '@empire/rules/testing';
import { describe, expect, it } from 'vitest';
import { buildModel } from './campaign';
import { formatWhen } from './format';
import {
  finalRoundText,
  nextRoundQuestion,
  pauseQuestion,
  readinessOf,
  readinessText,
  resumeQuestion,
  roundClock,
  roundEndText,
} from './readiness';
import { seasonEndText } from './rules-text';

/** A - B - C ~ D - E - F: Ann holds A B C, Bo D E, Cy F; everyone has a token and someone to attack. */
const idx = indexDataset(lineDataset());
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-08T12:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();
const NAMES: Record<string, string> = { ann: 'Ann', bo: 'Bo', cy: 'Cy' };
const member = (userId: string, color: number) => ({
  userId,
  name: NAMES[userId]!,
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
const SCHEDULED: CampaignRules = { ...DEFAULT_RULES, rounds: { progression: 'scheduled', hours: 72 } };

function war(over: Partial<WarView> & Pick<WarView, 'id' | 'attackerId' | 'defenderId' | 'targetId'>): WarView {
  return {
    launchId: over.targetId,
    stake: [],
    redirectedFrom: null,
    status: 'playing',
    counter: null,
    outcome: null,
    declaredRound: 4,
    resolvedRound: null,
    respondBy: null,
    declaredAt: at(-HOUR),
    resolvedAt: null,
    games: [],
    reserves: [],
    peace: [],
    ...over,
  };
}

function claim(over: Partial<ClaimView> & Pick<ClaimView, 'id' | 'userId'>): ClaimView {
  return {
    missionKey: 'p0',
    status: 'pending',
    startedRound: 3,
    startedAt: at(-DAY),
    eligibleRound: 5,
    eligibleAt: null,
    turnsHeld: false,
    blockedBy: [],
    ...over,
  };
}

function view(over: Partial<CampaignView> = {}, victory: Partial<VictoryView> = {}): CampaignView {
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
    holdings: { A: 'ann', B: 'ann', C: 'ann', D: 'bo', E: 'bo', F: 'cy' },
    draft: null,
    myDraftList: [],
    myAutodraftFallback: 'best',
    events: [],
    wars: [],
    truces: [],
    acquired: {},
    fortified: {},
    accords: [],
    turns: { order: ['bo', 'cy', 'ann'], current: 'bo', deadline: at(5 * HOUR), passed: [] },
    schedule: null,
    victory: {
      version: 6,
      pointsToWin: 10,
      publicPoints: 2,
      secretPoints: 3,
      hold: 'turns',
      holdMs: DAY,
      lastRound: 25,
      tiebreak: 'realWorld',
      publicMissions: [positions],
      titles: [],
      titlePoints: 1,
      players: [],
      claims: [],
      selection: null,
      result: null,
      ...victory,
    },
    mySecret: null,
    ...over,
  };
}

const user = (id: string) => ({ id, name: NAMES[id]!, email: null, lichessUsername: null, hasPassword: false });
const modelFor = (id: string, v: CampaignView) => buildModel(v, user(id), idx)!;
const over = { order: ['bo', 'cy', 'ann'], current: null, deadline: null, passed: ['bo', 'cy', 'ann'] };

describe('what a round is waiting for', () => {
  it('waits for the turns still to be taken, and says what ending the round first does to them', () => {
    const model = modelFor('ann', view());
    const r = readinessOf(model, NOW);
    expect(r.turnsLeft).toEqual(['bo', 'cy', 'ann']);
    expect(readinessText(model, r, NOW)).toEqual({
      heading: 'Before round 5',
      summary: 'Waiting for declaring to finish.',
      checklist: [{ state: 'waiting', text: 'Bo’s turn to declare, 5h 0m left; then Cy and you.' }],
      carries: null,
      claims: [],
      boundary:
        'If round 5 starts before declaring is over, anyone still to declare loses the rest of their turns this round. Unused war tokens carry over, up to 3.',
    });
    expect(roundEndText(model, NOW)).toBe('You start the next round when the group is ready.');
    expect(roundEndText(modelFor('bo', view()), NOW)).toBe('The host starts the next round when the group is ready.');
    expect(nextRoundQuestion(model, r)).toBe(
      'Start round 5? Everyone gains 1 war token, up to 3. Bo, Cy and you haven’t finished declaring: turns not yet taken this round are lost.',
    );
    // From Bo's seat, it's his turn.
    const bo = modelFor('bo', view());
    expect(readinessText(bo, readinessOf(bo, NOW), NOW).checklist[0]!.text).toBe(
      'Your turn to declare, 5h 0m left; then Cy and Ann.',
    );
  });

  it('lets wars carry into the next round, never holding it up', () => {
    const wars = [
      war({
        id: 'w1',
        attackerId: 'bo',
        defenderId: 'ann',
        targetId: 'C',
        status: 'declared',
        respondBy: at(20 * HOUR),
      }),
      war({ id: 'w2', attackerId: 'cy', defenderId: 'bo', targetId: 'E' }),
      war({ id: 'w3', attackerId: 'ann', defenderId: 'bo', targetId: 'D', status: 'ready' }),
    ];
    const model = modelFor('ann', view({ turns: over, wars }));
    const r = readinessOf(model, NOW);
    expect(r.ready).toBe(true);
    expect(readinessText(model, r, NOW)).toMatchObject({
      summary: 'Nothing is cut short if round 5 starts now.',
      checklist: [{ state: 'done', text: 'Declaring is over for this round.' }],
      carries:
        '3 wars carry on into round 5 as they stand, deadlines and clocks too, and their countries stay locked: 1 answer due, 1 battle underway and 1 game waiting to start.',
      boundary: null,
    });
    expect(nextRoundQuestion(model, r)).toBe(
      'Start round 5? Everyone gains 1 war token, up to 3. 3 wars carry on into round 5.',
    );
  });

  it('leaves out declaring where players declare whenever they like', () => {
    const model = modelFor('ann', view({ turns: null }));
    expect(readinessText(model, readinessOf(model, NOW), NOW)).toMatchObject({ checklist: [], boundary: null });
  });
});

describe('claims at the end of a round', () => {
  it('say which score as the next round starts and which the round’s turns hold up', () => {
    const claims = [claim({ id: 1, userId: 'bo' }), claim({ id: 2, userId: 'cy', startedRound: 4, eligibleRound: 6 })];
    const model = modelFor('ann', view({}, { claims }));
    const r = readinessOf(model, NOW);
    expect(readinessText(model, r, NOW).claims).toEqual([
      {
        state: 'note',
        text: 'Bo’s claim on Strategic Positions waits for everyone’s turns this round: if round 5 starts first, it waits for round 5’s.',
      },
      {
        state: 'note',
        text: 'Cy’s claim on Strategic Positions: can score in round 6 at the earliest. It waits for everyone’s turns to declare war in round 5.',
      },
    ]);
    expect(nextRoundQuestion(model, r)).toContain(' Bo’s claim then waits for round 5’s turns.');

    const served = modelFor(
      'ann',
      view({ turns: over }, { claims: [claim({ id: 1, userId: 'ann', turnsHeld: true })] }),
    );
    expect(readinessText(served, readinessOf(served, NOW), NOW).claims).toEqual([
      {
        state: 'note',
        text: 'Your claim on Strategic Positions scores as round 5 starts, if the position still holds.',
      },
    ]);
  });
});

describe('a schedule', () => {
  const scheduled = (schedule: CampaignView['schedule'], round = 4) =>
    modelFor('ann', view({ rules: SCHEDULED, schedule, round }));

  it('says when the next round starts by itself, and that it won’t wait for declaring', () => {
    const endsAt = NOW + 30 * HOUR;
    const model = scheduled({ roundStartedAt: at(-42 * HOUR), nextRoundAt: at(30 * HOUR), paused: null });
    expect(roundClock(model)).toEqual({ kind: 'scheduled', endsAt });
    expect(roundEndText(model, NOW)).toBe(`Round 5 starts by itself ${formatWhen(endsAt)} (in 30h 0m).`);
    expect(roundEndText(model, endsAt + 1000)).toBe(`Round 5 starts by itself ${formatWhen(endsAt)} (any moment now).`);
    const r = readinessOf(model, NOW);
    expect(readinessText(model, r, NOW).boundary).toBe(
      `Round 5 starts at ${formatWhen(endsAt)} even if declaring isn’t over: anyone still to declare loses the rest of their turns this round. Unused war tokens carry over, up to 3.`,
    );
    expect(nextRoundQuestion(model, r)).toBe(
      `Start round 5 now, ahead of ${formatWhen(endsAt)}? Everyone gains 1 war token, up to 3. Bo, Cy and you haven’t finished declaring: turns not yet taken this round are lost. Round 5 then runs 3 days from now.`,
    );
    expect(pauseQuestion(model, NOW)).toBe(
      'Pause the schedule? Round 4 keeps the 30h 0m it has left until you resume it. Turns, answers and games keep their own deadlines meanwhile.',
    );
  });

  it('says how long the round keeps while the host has it paused', () => {
    const model = scheduled({
      roundStartedAt: at(-6 * HOUR),
      nextRoundAt: null,
      paused: { since: at(-HOUR), remainingMs: 18 * HOUR },
    });
    expect(roundClock(model)).toEqual({ kind: 'paused', remainingMs: 18 * HOUR });
    expect(roundEndText(model, NOW)).toBe('You have paused the schedule, with 18h 0m left in this round.');
    expect(resumeQuestion(model, NOW)).toBe(
      `Resume the schedule? Round 4 then ends ${formatWhen(NOW + 18 * HOUR)}, in 18h 0m.`,
    );
    expect(readinessText(model, readinessOf(model, NOW), NOW).boundary).toMatch(
      /^If round 5 starts before declaring is over/,
    );
  });

  it('is the host’s word once the campaign is over, or never was', () => {
    const schedule = { roundStartedAt: at(-HOUR), nextRoundAt: at(HOUR), paused: null };
    expect(roundClock(modelFor('ann', view({ rules: SCHEDULED, status: 'finished', schedule })))).toEqual({
      kind: 'host',
    });
    expect(roundClock(modelFor('ann', view()))).toEqual({ kind: 'host' });
  });
});

describe('the last round', () => {
  const claims = [
    claim({ id: 1, userId: 'bo', startedRound: 23, eligibleRound: 25 }),
    claim({ id: 2, userId: 'cy', startedRound: 24, eligibleRound: 26 }),
  ];
  const wars = [
    war({ id: 'w1', attackerId: 'bo', defenderId: 'ann', targetId: 'C', status: 'declared', respondBy: at(2 * HOUR) }),
  ];

  it('waits for the wars its end calls off and the claims that could still score, and says what ending it does', () => {
    const model = modelFor('ann', view({ round: 25, wars }, { claims }));
    const r = readinessOf(model, NOW);
    expect(r).toMatchObject({ final: true, ready: false });
    expect(readinessText(model, r, NOW)).toEqual({
      heading: 'Before the campaign ends',
      summary: 'Waiting for declaring to finish, a war to end and a claim that could still score.',
      checklist: [
        { state: 'waiting', text: 'Bo’s turn to declare, 5h 0m left; then Cy and you.' },
        {
          state: 'waiting',
          text: 'A war still underway is called off if the campaign ends first, with nothing changing hands: 1 answer due.',
        },
        {
          state: 'waiting',
          text: 'Bo’s claim on Strategic Positions can still score before the end. It waits for everyone’s turns to declare war in round 25.',
        },
        {
          state: 'note',
          text: 'Cy’s claim on Strategic Positions can’t score before the campaign ends: round 26 would be its first.',
        },
      ],
      carries: null,
      claims: [],
      boundary: null,
    });
    expect(roundEndText(model, NOW)).toBe('The campaign ends on points when you end this round.');
    expect(roundEndText(modelFor('cy', view({ round: 25, wars }, { claims })), NOW)).toBe(
      'The campaign ends on points when the host ends this round.',
    );
    expect(finalRoundText(model, 10)).toBe(
      `The last round: if nobody has reached 10 points when it ends, ${seasonEndText(DEFAULT_RULES)}. Wars still underway then are called off, with nothing changing hands, and claims that haven’t scored don’t count.`,
    );
    expect(nextRoundQuestion(model, r)).toBe(
      'Round 25 was the last. End the campaign? The most victory points win, then the largest population, then the most land, then the largest GDP. A war still underway is called off. A claim that could still score this round doesn’t count.',
    );
  });

  it('gives the time the campaign ends on a schedule', () => {
    const endsAt = NOW + 50 * HOUR;
    const model = modelFor(
      'ann',
      view({
        rules: SCHEDULED,
        round: 25,
        turns: over,
        schedule: { roundStartedAt: at(-22 * HOUR), nextRoundAt: at(50 * HOUR), paused: null },
      }),
    );
    expect(roundEndText(model, NOW)).toBe(`The campaign ends on points ${formatWhen(endsAt)} (in 2d 2h).`);
    expect(readinessText(model, readinessOf(model, NOW), NOW)).toMatchObject({
      summary: 'Nothing is cut short if the campaign ends now.',
      checklist: [
        { state: 'done', text: 'Declaring is over for this round.' },
        { state: 'done', text: 'No war underway.' },
      ],
    });
    expect(nextRoundQuestion(model, readinessOf(model, NOW))).toBe(
      `Round 25 was the last. End the campaign now, ahead of ${formatWhen(endsAt)}? The most victory points win, then the largest population, then the most land, then the largest GDP.`,
    );
  });
});
