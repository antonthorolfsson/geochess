import { describe, expect, it } from 'vitest';
import { parseRules } from './config';
import {
  claimAtRoundEnd,
  roundMs,
  roundProgression,
  roundReadiness,
  roundsIssue,
  type ReadinessClaim,
  type ReadinessWar,
  type RoundMoment,
  type RoundReadinessInput,
} from './rounds';

const ANN = 'ann';
const BO = 'bo';
const CY = 'cy';
const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-08T12:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe('round progression', () => {
  it('is the host’s unless a correspondence campaign chose a schedule', () => {
    expect(roundProgression(parseRules({}))).toBe('manual');
    const scheduled = parseRules({ war: { pace: 'correspondence' }, rounds: { progression: 'scheduled', hours: 48 } });
    expect(roundProgression(scheduled)).toBe('scheduled');
    expect(roundMs(scheduled)).toBe(48 * HOUR);
    // Live rounds stay the host's, whatever was stored.
    const live = parseRules({ war: { pace: 'live' }, rounds: { progression: 'scheduled' } });
    expect(roundProgression(live)).toBe('manual');
  });

  it('refuses a schedule for a live campaign', () => {
    expect(roundsIssue(parseRules({ war: { pace: 'live' }, rounds: { progression: 'scheduled' } }))).toBe(
      'Rounds run on a schedule only in correspondence campaigns: in a live one, the host starts each round.',
    );
    expect(
      roundsIssue(parseRules({ war: { pace: 'correspondence' }, rounds: { progression: 'scheduled' } })),
    ).toBeNull();
    expect(roundsIssue(parseRules({ war: { pace: 'live' } }))).toBeNull();
  });
});

const claim = (over: Partial<ReadinessClaim> = {}): ReadinessClaim => ({
  id: 1,
  userId: BO,
  startedRound: 3,
  eligibleRound: 5,
  eligibleAt: null,
  turnsHeld: false,
  blockedBy: [],
  ...over,
});

describe('what the end of a round means for a claim', () => {
  const moment = (over: Partial<RoundMoment> = {}): RoundMoment => ({
    round: 3,
    final: false,
    hold: 'turns',
    declaring: true,
    now: NOW,
    endsAt: null,
    ...over,
  });

  describe('held through a round’s turns', () => {
    it('is a step on the way for a claim made this round', () => {
      expect(claimAtRoundEnd(claim(), moment())).toBe('waits');
      expect(claimAtRoundEnd(claim(), moment({ declaring: false }))).toBe('waits');
    });

    it('is delayed while this round’s turns, which it waits for, are still being taken', () => {
      const lastRounds = claim({ startedRound: 2, eligibleRound: 4 });
      expect(claimAtRoundEnd(lastRounds, moment())).toBe('delayed');
      // Its round has come, and it still waits for turns that run to their end.
      expect(claimAtRoundEnd(claim({ startedRound: 1, eligibleRound: 3 }), moment())).toBe('delayed');
    });

    it('scores as the next round starts once its turns are served and no war could break it', () => {
      const served = claim({ startedRound: 2, eligibleRound: 4, turnsHeld: true });
      expect(claimAtRoundEnd(served, moment({ declaring: false }))).toBe('scores');
      expect(claimAtRoundEnd({ ...served, blockedBy: ['w1'] }, moment({ declaring: false }))).toBe('waits');
      // Served, but its round is further off.
      expect(claimAtRoundEnd({ ...served, eligibleRound: 5 }, moment({ declaring: false }))).toBe('waits');
    });
  });

  describe('held for a time', () => {
    const timed = (over: Partial<RoundMoment> = {}) => moment({ hold: 'time', ...over });

    it('waits for its time, whatever the turns', () => {
      expect(claimAtRoundEnd(claim(), timed())).toBe('waits');
      const running = claim({ startedRound: 2, eligibleRound: 4, eligibleAt: at(HOUR) });
      expect(claimAtRoundEnd(running, timed())).toBe('waits');
      expect(claimAtRoundEnd(running, timed({ now: NOW + HOUR }))).toBe('scores');
      expect(claimAtRoundEnd({ ...running, blockedBy: ['w1'] }, timed({ now: NOW + HOUR }))).toBe('waits');
    });
  });

  describe('in the last round', () => {
    const last = (over: Partial<RoundMoment> = {}) => moment({ round: 5, final: true, ...over });

    it('can still score once its round has come, and not after the campaign ends', () => {
      expect(claimAtRoundEnd(claim(), last())).toBe('last-chance');
      expect(claimAtRoundEnd(claim({ startedRound: 4, eligibleRound: 6 }), last())).toBe('too-late');
      expect(claimAtRoundEnd(claim({ startedRound: 5, eligibleRound: 7 }), last())).toBe('too-late');
    });

    it('is too late for a holding time that runs past the scheduled end', () => {
      const timed = claim({ eligibleAt: at(5 * HOUR) });
      expect(claimAtRoundEnd(timed, last({ hold: 'time', endsAt: NOW + 4 * HOUR }))).toBe('too-late');
      expect(claimAtRoundEnd(timed, last({ hold: 'time', endsAt: NOW + 6 * HOUR }))).toBe('last-chance');
      // Where the host ends it, it's up to them.
      expect(claimAtRoundEnd(timed, last({ hold: 'time', endsAt: null }))).toBe('last-chance');
    });
  });
});

describe('what a round is waiting for', () => {
  const war = (over: Partial<ReadinessWar> & { id: string }): ReadinessWar => ({
    attackerId: ANN,
    defenderId: BO,
    status: 'playing',
    counter: null,
    respondBy: null,
    ...over,
  });
  const input = (over: Partial<RoundReadinessInput> = {}): RoundReadinessInput => ({
    round: 3,
    lastRound: 25,
    turns: { order: [ANN, BO, CY], passed: [], current: BO },
    canAct: () => true,
    wars: [],
    claims: [],
    hold: 'turns',
    now: NOW,
    endsAt: null,
    ...over,
  });

  it('waits for the turns still to be taken, and nothing else', () => {
    const r = roundReadiness(input({ turns: { order: [ANN, BO, CY], passed: [ANN], current: BO } }));
    expect(r).toMatchObject({ final: false, turnsLeft: [BO, CY], ready: false });
    expect(roundReadiness(input({ turns: { order: [ANN, BO, CY], passed: [ANN, BO], current: null } }))).toMatchObject({
      turnsLeft: [],
      ready: true,
    });
    // Without turns, nothing holds a round up.
    expect(roundReadiness(input({ turns: null }))).toMatchObject({ turnsLeft: [], ready: true });
  });

  it('lets wars carry into the next round: answers due and battles never hold it up', () => {
    const wars = [
      war({ id: 'declared', status: 'declared', respondBy: at(5 * HOUR) }),
      war({ id: 'raised', status: 'countered', counter: { kind: 'raise', minValue: 6 }, respondBy: at(2 * HOUR) }),
      war({
        id: 'raised-back',
        status: 'countered',
        counter: { kind: 'raise', minValue: 6, steps: [{ by: 'attacker', stake: ['A1'], more: 2 }] },
        respondBy: at(3 * HOUR),
      }),
      war({ id: 'fought', status: 'playing' }),
      war({ id: 'queued', status: 'ready' }),
      war({ id: 'over', status: 'resolved' }),
    ];
    const r = roundReadiness(input({ turns: null, wars }));
    expect(r.answers).toEqual([
      { warId: 'raised', userId: ANN, respondBy: at(2 * HOUR) },
      { warId: 'raised-back', userId: BO, respondBy: at(3 * HOUR) },
      { warId: 'declared', userId: BO, respondBy: at(5 * HOUR) },
    ]);
    expect(r.battles).toEqual([
      { warId: 'fought', queued: false },
      { warId: 'queued', queued: true },
    ]);
    expect(r.ready).toBe(true);
  });

  it('says what the round’s end means for each claim', () => {
    const r = roundReadiness(
      input({
        claims: [
          claim({ id: 1, startedRound: 2, eligibleRound: 4 }),
          claim({ id: 2, userId: CY, startedRound: 3, eligibleRound: 5 }),
        ],
      }),
    );
    expect(r.claims).toEqual([
      { claimId: 1, userId: BO, atRoundEnd: 'delayed' },
      { claimId: 2, userId: CY, atRoundEnd: 'waits' },
    ]);
  });

  it('in the last round, waits for wars the end would call off and claims that could still score', () => {
    const last = { round: 25, turns: null };
    expect(roundReadiness(input(last))).toMatchObject({ final: true, ready: true });
    expect(roundReadiness(input({ ...last, wars: [war({ id: 'fought' })] }))).toMatchObject({ ready: false });
    const chance = claim({ startedRound: 23, eligibleRound: 25 });
    expect(roundReadiness(input({ ...last, claims: [chance] }))).toMatchObject({
      claims: [{ claimId: 1, userId: BO, atRoundEnd: 'last-chance' }],
      ready: false,
    });
    // A claim the season can't wait for doesn't hold the end up.
    const late = claim({ startedRound: 24, eligibleRound: 26 });
    expect(roundReadiness(input({ ...last, claims: [late] }))).toMatchObject({
      claims: [{ atRoundEnd: 'too-late' }],
      ready: true,
    });
    // No last round: never final.
    expect(roundReadiness(input({ lastRound: null, round: 40 })).final).toBe(false);
  });
});
