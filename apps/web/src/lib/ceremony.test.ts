import type { CampaignEvent, EventView, MissionSpec, SecretMissionSpec } from '@empire/rules';
import { describe, expect, it } from 'vitest';
import {
  awardKey,
  ceremoniesFrom,
  ceremonyLabel,
  ceremonyPlayers,
  ceremonySummary,
  isFresh,
  markFresh,
  moveText,
  rankByPoints,
  type Standings,
  type TitlesCeremony,
} from './ceremony';

let nextId = 100;
const event = (e: CampaignEvent): EventView => ({
  ...e,
  id: nextId++,
  round: 3,
  actorId: null,
  createdAt: '2026-10-05T12:00:00.000Z',
});
const titleChanged = (
  title: 'population' | 'land' | 'economy' | 'military',
  from: string | null,
  to: string | null,
  totals: Record<string, number>,
) => event({ type: 'title.changed', payload: { title, from, to, points: 1, totals } });
const awarded = (userId: string, missionKey: string, points: number, total: number) =>
  event({
    type: 'mission.awarded',
    payload: { userId, missionKey, kind: missionKey === 'secret' ? 'iron_wall' : 'kingslayer', points, total },
  });

const start: Standings = {
  points: { ann: 4, bo: 3, cy: 1 },
  holders: { population: 'ann', land: 'bo', economy: 'ann', military: null },
};
const kingslayer: MissionSpec = { kind: 'kingslayer', lead: 4 };
const specs = (userId: string, key: string) => (key === 'p0' ? kingslayer : null);
const names: Record<string, string> = { ann: 'Ann', bo: 'Bo', cy: 'Cy' };
const nameOf = (id: string) => names[id] ?? id;

describe('ceremoniesFrom', () => {
  it('plays the titles of one change together, then each mission scored, keeping everyone else as they were', () => {
    const events = [
      event({ type: 'round.started', payload: { round: 3 } }),
      titleChanged('population', 'ann', 'bo', { ann: 3, bo: 4 }),
      titleChanged('military', null, 'cy', { cy: 2 }),
      awarded('bo', 'p0', 2, 6),
    ];
    const { ceremonies, end } = ceremoniesFrom(events, start, specs);
    expect(ceremonies.map((c) => c.kind)).toEqual(['titles', 'mission']);
    const [titles, mission] = ceremonies;
    expect(titles!.id).toBe(events[1]!.id);
    expect(titles!.before).toEqual(start);
    expect((titles as TitlesCeremony).moves).toEqual([
      { title: 'population', from: 'ann', to: 'bo', points: 1, after: { ann: 3, bo: 4 } },
      { title: 'military', from: null, to: 'cy', points: 1, after: { cy: 2 } },
    ]);
    expect(titles!.after).toEqual({
      points: { ann: 3, bo: 4, cy: 2 },
      holders: { population: 'bo', land: 'bo', economy: 'ann', military: 'cy' },
    });
    expect(mission).toMatchObject({
      kind: 'mission',
      userId: 'bo',
      missionKey: 'p0',
      scope: 'public',
      spec: kingslayer,
      points: 2,
      before: titles!.after,
    });
    expect(mission!.after.points).toEqual({ ann: 3, bo: 6, cy: 2 });
    expect(end).toEqual(mission!.after);
    // The standings it started from are left alone.
    expect(start.points.ann).toBe(4);
  });

  it('takes a secret completed in the same change from the event that revealed it', () => {
    const secret: SecretMissionSpec = { kind: 'iron_wall', wins: 3 };
    const events = [
      event({ type: 'mission.revealed', payload: { userId: 'cy', mission: secret, reason: 'claim' } }),
      awarded('cy', 'secret', 3, 4),
    ];
    const [mission] = ceremoniesFrom(events, start, () => null).ceremonies;
    expect(mission).toMatchObject({ kind: 'mission', scope: 'secret', spec: secret, points: 3 });
    expect(mission!.before.points.cy).toBe(1);
    expect(mission!.after.points.cy).toBe(4);
  });

  it('leaves out what it may not show: no spec for a secret nobody revealed', () => {
    const [mission] = ceremoniesFrom([awarded('bo', 'secret', 3, 6)], start, () => null).ceremonies;
    expect(mission).toMatchObject({ scope: 'secret', spec: null, missionKind: 'iron_wall' });
  });

  it('starts a new ceremony when a title moves again, or after a mission', () => {
    const events = [
      titleChanged('land', 'bo', 'ann', { bo: 2, ann: 5 }),
      titleChanged('land', 'ann', 'cy', { ann: 4, cy: 2 }),
      awarded('ann', 'p0', 2, 6),
      titleChanged('economy', 'ann', null, { ann: 5 }),
    ];
    const { ceremonies } = ceremoniesFrom(events, start, specs);
    expect(ceremonies.map((c) => c.kind)).toEqual(['titles', 'titles', 'mission', 'titles']);
    expect(ceremonies[1]!.before.holders.land).toBe('ann');
    expect(ceremonies[3]!.after).toEqual({
      points: { ann: 5, bo: 2, cy: 2 },
      holders: { population: 'ann', land: 'cy', economy: null, military: null },
    });
  });

  it('starts from before the change, even from standings that already have it (a refetch got there first)', () => {
    const events = [titleChanged('population', 'ann', 'bo', { ann: 3, bo: 4 }), awarded('cy', 'p0', 2, 3)];
    const already: Standings = {
      points: { ann: 3, bo: 4, cy: 3 },
      holders: { ...start.holders, population: 'bo' },
    };
    const [titles, mission] = ceremoniesFrom(events, already, specs).ceremonies;
    expect(titles!.before).toEqual(start);
    expect(mission!.before.points).toEqual({ ann: 3, bo: 4, cy: 1 });
    expect(mission!.after.points).toEqual(already.points);
  });

  it('works the points out from the move when an event carries no totals', () => {
    const [titles] = ceremoniesFrom([titleChanged('population', 'ann', 'bo', {})], start, specs).ceremonies;
    expect((titles as TitlesCeremony).moves[0]!.after).toEqual({ ann: 3, bo: 4 });
  });

  it('has nothing to play for a change that moves no points', () => {
    const events = [event({ type: 'round.started', payload: { round: 4 } })];
    expect(ceremoniesFrom(events, start, specs)).toEqual({ ceremonies: [], end: start });
  });
});

describe('wording', () => {
  const ceremony = (moves: TitlesCeremony['moves']): TitlesCeremony => ({
    kind: 'titles',
    id: 1,
    moves,
    before: start,
    after: { points: { ann: 3, bo: 4, cy: 1 }, holders: {} },
  });

  it('says how each title moved, the viewer as "you"', () => {
    const taken = { title: 'population' as const, from: 'ann', to: 'bo', points: 1, after: {} };
    expect(moveText(taken, nameOf, 'cy')).toBe('Bo takes it from Ann');
    expect(moveText(taken, nameOf, 'bo')).toBe('You take it from Ann');
    expect(moveText(taken, nameOf, 'ann')).toBe('Bo takes it from you');
    expect(moveText({ ...taken, from: null }, nameOf, 'bo')).toBe('You hold it');
    expect(moveText({ ...taken, to: null }, nameOf, 'cy')).toBe('Ann loses it: the lead is shared');
  });

  it('heads each kind of ceremony', () => {
    const move = { title: 'land' as const, from: 'ann', to: 'bo', points: 1, after: {} };
    expect(ceremonyLabel(ceremony([move]))).toBe('Title changes hands');
    expect(ceremonyLabel(ceremony([move, { ...move, title: 'economy' }]))).toBe('Titles change hands');
    expect(ceremonyLabel(ceremony([{ ...move, from: null }]))).toBe('Title awarded');
    expect(
      ceremonyLabel(
        ceremony([
          { ...move, from: null },
          { ...move, title: 'economy', from: null },
        ]),
      ),
    ).toBe('Titles awarded');
    expect(ceremonyLabel(ceremony([{ ...move, to: null }]))).toBe('Title lost');
    const [mission] = ceremoniesFrom([awarded('bo', 'secret', 3, 6)], start, () => null).ceremonies;
    expect(ceremonyLabel(mission!)).toBe('Secret mission complete');
  });

  it('sums a ceremony up for screen readers', () => {
    const c = ceremony([{ title: 'population', from: 'ann', to: 'bo', points: 1, after: { ann: 3, bo: 4 } }]);
    expect(ceremonyPlayers(c)).toEqual(['ann', 'bo']);
    expect(ceremonySummary(c, nameOf, 'ann', 5)).toBe('Largest Population: Bo takes it from you. Points: you 3, Bo 4.');
    const [mission] = ceremoniesFrom([awarded('bo', 'p0', 2, 6)], start, specs).ceremonies;
    expect(ceremonySummary(mission!, nameOf, 'bo', 5)).toBe('You scored Kingslayer: +2, 6 points.');
    expect(ceremonySummary(mission!, nameOf, 'ann', 5)).toBe('Bo scored Kingslayer: +2, 6 points.');
  });

  it('ranks by points, then by name', () => {
    expect(rankByPoints({ cy: 2, ann: 3, bo: 3 }, nameOf)).toEqual(['ann', 'bo', 'cy']);
  });
});

describe('fresh marks', () => {
  it('lasts as long as asked', () => {
    const key = awardKey('c1', 'ann', 'p0');
    expect(isFresh(key, 1_000)).toBe(false);
    markFresh(key, 5_000, 1_000);
    expect(isFresh(key, 5_999)).toBe(true);
    expect(isFresh(key, 6_000)).toBe(false);
    expect(isFresh(key, 1_000)).toBe(false);
  });
});
