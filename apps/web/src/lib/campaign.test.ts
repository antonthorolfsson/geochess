import { DEFAULT_RULES, indexDataset, type CampaignView, type WarView } from '@empire/rules';
import { lineDataset } from '@empire/rules/testing';
import { describe, expect, it } from 'vitest';
import { buildModel, totalValue } from './campaign';

const idx = indexDataset(lineDataset());
const user = (id: string) => ({ id, name: id, email: null, lichessUsername: null });
const member = (userId: string, color: number) => ({
  userId,
  name: userId,
  lichessUsername: null,
  color,
  autodraft: false,
  tokens: 1,
  joinedAt: '2026-01-01T00:00:00.000Z',
});

function campaign(overrides: Partial<CampaignView> = {}): CampaignView {
  return {
    id: 'c1',
    name: 'Test',
    status: 'draft',
    round: 0,
    hostId: 'ann',
    rules: DEFAULT_RULES,
    datasetVersion: 'test',
    inviteCode: 'code',
    createdAt: '2026-01-01T00:00:00.000Z',
    members: [member('ann', 0), member('bo', 3)],
    holdings: {},
    draft: { order: ['ann', 'bo'], pickIndex: 0, totalPicks: 6, round: 1, currentPicker: 'ann' },
    myDraftList: [],
    myAutodraftFallback: 'best',
    events: [],
    wars: [],
    truces: [],
    acquired: {},
    ...overrides,
  };
}

describe('buildModel', () => {
  it('returns null for someone outside the campaign', () => {
    expect(buildModel(campaign(), user('cy'), idx)).toBeNull();
  });

  it('knows whose pick it is and what they may claim', () => {
    const mine = buildModel(campaign(), user('ann'), idx)!;
    expect(mine.myTurn).toBe(true);
    expect(mine.isHost).toBe(true);
    expect([...mine.legal!]).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    // Every free country is legal on a first pick, so nothing needs calling out on the map.
    expect(mine.highlighted).toBeNull();
    expect(mine.upcoming.map((m) => m.userId)).toEqual(['ann', 'bo', 'bo', 'ann', 'ann', 'bo']);
    expect(mine.totalRounds).toBe(3);

    const theirs = buildModel(campaign(), user('bo'), idx)!;
    expect(theirs.myTurn).toBe(false);
    expect(theirs.legal).toBeNull();
    expect(theirs.picksUntilMine).toBe(1);
  });

  it('highlights only bordering countries once contiguity narrows the choice', () => {
    const view = campaign({
      holdings: { B: 'ann', F: 'bo' },
      draft: { order: ['ann', 'bo'], pickIndex: 3, totalPicks: 6, round: 2, currentPicker: 'ann' },
    });
    const model = buildModel(view, user('ann'), idx)!;
    expect([...model.highlighted!].sort()).toEqual(['A', 'C']);
    expect(model.ownerColors.get('F')).toBe(3);
    expect(model.holdingsByUser.get('ann')).toEqual(['B']);
    expect(totalValue(idx, model.holdingsByUser.get('ann')!)).toBe(5);
  });
});

describe('draft list in the model', () => {
  it('reports where each entry stands and how much is unclaimed', () => {
    const view = campaign({
      holdings: { B: 'ann' },
      myDraftList: ['F', 'C', 'A'],
      draft: { order: ['ann', 'bo'], pickIndex: 1, totalPicks: 6, round: 1, currentPicker: 'bo' },
    });
    const model = buildModel(view, user('ann'), idx)!;
    expect(model.unclaimed).toBe(5);
    expect(model.draftListOpen).toBe(true);
    expect(model.draftList).toEqual([
      { id: 'F', status: 'not-bordering' },
      { id: 'C', status: 'next' },
      { id: 'A', status: 'available' },
    ]);
  });

  it('knows when auto-draft is waiting for me', () => {
    const waiting = campaign({
      members: [{ ...member('ann', 0), autodraft: true }, member('bo', 3)],
      myAutodraftFallback: 'wait',
    });
    const model = buildModel(waiting, user('ann'), idx)!;
    expect(model.autodraftFallback).toBe('wait');
    expect(model.autodraftWaiting).toBe(true);
    expect(buildModel(campaign(), user('ann'), idx)!.autodraftWaiting).toBe(false);
  });

  it('closes the list once the draft is over', () => {
    const model = buildModel(campaign({ status: 'active', draft: null }), user('ann'), idx)!;
    expect(model.draftListOpen).toBe(false);
  });
});

describe('wars in the model', () => {
  // A - B - C ~ D - E - F: Ann holds A B C, Bo holds D E F. C reaches D across the sea lane.
  const holdings = { A: 'ann', B: 'ann', C: 'ann', D: 'bo', E: 'bo', F: 'bo' };
  const underway = (overrides: Partial<CampaignView> = {}) =>
    campaign({ status: 'active', round: 1, draft: null, holdings, ...overrides });
  const war = (overrides: Partial<WarView> = {}): WarView => ({
    id: 'w1',
    attackerId: 'ann',
    defenderId: 'bo',
    targetId: 'D',
    launchId: 'C',
    stake: ['C', 'B'],
    redirectedFrom: null,
    status: 'declared',
    counter: null,
    outcome: null,
    declaredRound: 1,
    resolvedRound: null,
    respondBy: null,
    declaredAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    games: [],
    ...overrides,
  });

  it('finds the countries I can attack', () => {
    expect([...buildModel(underway(), user('ann'), idx)!.targets]).toEqual(['D']);
    expect([...buildModel(underway(), user('bo'), idx)!.targets]).toEqual(['C']);
    expect(buildModel(campaign(), user('ann'), idx)!.targets.size).toBe(0);
  });

  it('locks the countries caught up in a war and knows who must answer', () => {
    const declared = buildModel(underway({ wars: [war()] }), user('ann'), idx)!;
    expect(declared.targets.size).toBe(0);
    expect([...declared.warOf.keys()].sort()).toEqual(['B', 'C', 'D']);
    expect(declared.awaitingMe).toEqual([]);
    expect(buildModel(underway({ wars: [war()] }), user('bo'), idx)!.awaitingMe.map((w) => w.id)).toEqual(['w1']);

    const countered = underway({
      wars: [war({ status: 'countered', counter: { kind: 'tribute', territoryId: 'F', tokens: 0 } })],
    });
    const attacker = buildModel(countered, user('ann'), idx)!;
    expect(attacker.awaitingMe.map((w) => w.id)).toEqual(['w1']);
    expect(attacker.warOf.get('F')?.id).toBe('w1');
  });

  it('separates past wars and respects truces', () => {
    const over = war({ status: 'resolved', outcome: 'held', resolvedRound: 1 });
    const model = buildModel(
      underway({ wars: [over], truces: [{ players: ['ann', 'bo'], endsRound: 2 }] }),
      user('ann'),
      idx,
    )!;
    expect(model.activeWars).toEqual([]);
    expect(model.pastWars.map((w) => w.id)).toEqual(['w1']);
    expect(model.targets.size).toBe(0);
  });
});
