import {
  DEFAULT_RULES,
  indexDataset,
  type AccordView,
  type CampaignView,
  type PeaceOfferView,
  type WarView,
} from '@empire/rules';
import { lineDataset } from '@empire/rules/testing';
import { describe, expect, it } from 'vitest';
import { buildModel, nextAnswer, totalValue } from './campaign';
import { turnWaitText } from './wars';

const idx = indexDataset(lineDataset());
const user = (id: string) => ({ id, name: id, email: null, lichessUsername: null, hasPassword: false });
const member = (userId: string, color: number) => ({
  userId,
  name: userId,
  lichessUsername: null,
  color,
  autodraft: false,
  tokens: 1,
  reputation: 100,
  joinedAt: '2026-01-01T00:00:00.000Z',
  bot: null,
  rating: null,
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
    deleteAt: null,
    members: [member('ann', 0), member('bo', 3)],
    holdings: {},
    draft: { order: ['ann', 'bo'], pickIndex: 0, totalPicks: 6, round: 1, currentPicker: 'ann' },
    myDraftList: [],
    myAutodraftFallback: 'best',
    events: [],
    wars: [],
    truces: [],
    acquired: {},
    fortified: {},
    accords: [],
    turns: null,
    victory: null,
    mySecret: null,
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
    reserves: [],
    peace: [],
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

describe('turns in the model', () => {
  // Cy holds only F, with nothing to attack, but can fortify it while they have a token.
  const holdings = { A: 'ann', B: 'ann', C: 'ann', D: 'bo', E: 'bo', F: 'cy' };
  const members = [member('ann', 0), member('bo', 3), member('cy', 5)];
  const underway = (turns: CampaignView['turns'], cyTokens = 1) =>
    campaign({
      status: 'active',
      round: 2,
      draft: null,
      holdings,
      members: members.map((m) => (m.userId === 'cy' ? { ...m, tokens: cyTokens } : m)),
      turns,
    });
  const turns = (overrides: Partial<NonNullable<CampaignView['turns']>> = {}) => ({
    order: ['bo', 'cy', 'ann'],
    current: 'bo',
    deadline: '2026-01-02T00:00:00.000Z',
    passed: [],
    ...overrides,
  });

  it('knows whose turn it is to declare, and how many come before mine', () => {
    const bo = buildModel(underway(turns()), user('bo'), idx)!;
    expect(bo.turns).toMatchObject({ mine: true, before: 0, current: { userId: 'bo' } });
    expect(bo.turns!.order.map((m) => m.userId)).toEqual(['bo', 'cy', 'ann']);
    expect(bo.turnRejection).toBeNull();
    expect(turnWaitText(bo)).toBeNull();

    const ann = buildModel(underway(turns()), user('ann'), idx)!;
    expect(ann.turns).toMatchObject({ mine: false, before: 2 });
    expect(ann.turnRejection).toBe('not-your-turn');
    expect(turnWaitText(ann)).toBe("bo's turn to declare. 2 turns before yours.");
    // Targets still light up for planning ahead.
    expect([...ann.targets]).toEqual(['D']);
    const next = buildModel(underway(turns({ passed: ['cy'] })), user('ann'), idx)!;
    expect(turnWaitText(next)).toBe("bo's turn to declare. You're next.");
    // Out of tokens, Cy will be passed over.
    const skipped = buildModel(underway(turns(), 0), user('ann'), idx)!;
    expect(skipped.turns!.before).toBe(1);
    const cy = buildModel(underway(turns(), 0), user('cy'), idx)!;
    expect(cy.turns).toMatchObject({ canAct: false, before: null });
  });

  it('says when I have passed, and when declaring is over', () => {
    const passed = buildModel(underway(turns({ passed: ['ann'] })), user('ann'), idx)!;
    expect(passed.turns!.before).toBeNull();
    expect(turnWaitText(passed)).toBe("You passed: you're done declaring for this round.");
    const over = buildModel(underway(turns({ current: null, deadline: null })), user('bo'), idx)!;
    expect(over.turnRejection).toBe('turns-over');
    expect(turnWaitText(over)).toBe('Declaring is over for this round. The next round brings new turns.');
  });

  it('has no turns where anyone declares whenever they like', () => {
    const free = buildModel(underway(null), user('ann'), idx)!;
    expect(free.turns).toBeNull();
    expect(free.turnRejection).toBeNull();
    expect(turnWaitText(free)).toBeNull();
  });
});

describe('accords in the model', () => {
  const holdings = { A: 'ann', B: 'ann', C: 'ann', D: 'bo', E: 'bo', F: 'bo' };
  const underway = (accords: AccordView[]) => campaign({ status: 'active', round: 2, draft: null, holdings, accords });
  const accord = (overrides: Partial<AccordView> = {}): AccordView => ({
    id: 'a1',
    proposerId: 'ann',
    recipientId: 'bo',
    status: 'active',
    rounds: 3,
    terms: null,
    proposedRound: 1,
    proposedAt: '2026-01-01T00:00:00.000Z',
    respondBy: null,
    signedRound: 1,
    signedAt: '2026-01-01T00:00:00.000Z',
    endsRound: 4,
    endedRound: null,
    endedAt: null,
    brokenBy: null,
    renews: null,
    ...overrides,
  });

  it('keeps accord partners off each other’s target list', () => {
    const signed = buildModel(underway([accord()]), user('bo'), idx)!;
    expect(signed.targets.size).toBe(0);
    expect(signed.accordWith.get('ann')?.id).toBe('a1');
    expect(signed.accordsInForce.map((a) => a.id)).toEqual(['a1']);
    // Once its end round starts, the accord no longer holds.
    const over = buildModel({ ...underway([accord()]), round: 4 }, user('bo'), idx)!;
    expect([...over.targets]).toEqual(['C']);
    expect(over.accordWith.size).toBe(0);
  });

  it('holds a breaker back for the rest of the round, but not the betrayed player', () => {
    const broken = underway([accord({ status: 'broken', brokenBy: 'ann', endedRound: 2 })]);
    expect(buildModel(broken, user('ann'), idx)!.targets.size).toBe(0);
    expect([...buildModel(broken, user('bo'), idx)!.targets]).toEqual(['C']);
  });

  it('counts proposals waiting for my answer among the answers I owe', () => {
    const proposal = accord({ status: 'proposed', signedRound: null, signedAt: null, endsRound: null });
    const bo = buildModel(underway([proposal]), user('bo'), idx)!;
    expect(bo.proposalsToMe.map((a) => a.id)).toEqual(['a1']);
    expect(bo.answers).toEqual([{ kind: 'accord', id: 'a1', respondBy: null }]);
    expect(bo.proposalWith.get('ann')?.id).toBe('a1');
    const ann = buildModel(underway([proposal]), user('ann'), idx)!;
    expect(ann.proposalsToMe).toEqual([]);
    expect(ann.proposalWith.get('bo')?.id).toBe('a1');
    expect(ann.answers).toEqual([]);
  });
});

describe('answers I owe', () => {
  const holdings = { A: 'ann', B: 'ann', C: 'ann', D: 'bo', E: 'bo', F: 'bo' };
  const at = (hour: number) => `2026-01-02T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const war = (overrides: Partial<WarView>): WarView => ({
    id: 'w1',
    attackerId: 'ann',
    defenderId: 'bo',
    targetId: 'D',
    launchId: 'C',
    stake: ['C'],
    redirectedFrom: null,
    status: 'declared',
    counter: null,
    outcome: null,
    declaredRound: 1,
    resolvedRound: null,
    respondBy: null,
    declaredAt: at(0),
    resolvedAt: null,
    games: [],
    reserves: [],
    peace: [],
    ...overrides,
  });
  const peace = (id: string, respondBy: string): PeaceOfferView => ({
    id,
    warId: 'w1',
    proposerId: 'ann',
    recipientId: 'bo',
    terms: { toAttacker: [], toDefender: [], tokensToAttacker: 0, tokensToDefender: 0, accordRounds: null },
    status: 'proposed',
    createdAt: at(0),
    respondBy,
    endedAt: null,
  });
  const proposal: AccordView = {
    id: 'a1',
    proposerId: 'ann',
    recipientId: 'bo',
    status: 'proposed',
    rounds: 3,
    terms: null,
    proposedRound: 1,
    proposedAt: at(0),
    respondBy: at(11),
    signedRound: null,
    signedAt: null,
    endsRound: null,
    endedRound: null,
    endedAt: null,
    brokenBy: null,
    renews: null,
  };
  const view = campaign({
    status: 'active',
    round: 1,
    draft: null,
    holdings,
    wars: [
      // Ann's declaration on Bo, due at noon, with peace terms from her that lapse at nine.
      war({ respondBy: at(12), peace: [peace('p1', at(9))] }),
      // Bo's own attack, which Ann answered with a tribute offer: due at ten.
      war({
        id: 'w2',
        attackerId: 'bo',
        defenderId: 'ann',
        targetId: 'C',
        launchId: 'D',
        stake: ['D'],
        status: 'countered',
        counter: { kind: 'tribute', territoryId: 'A', tokens: 0 },
        respondBy: at(10),
      }),
      // Waiting on Ann, not Bo.
      war({ id: 'w3', targetId: 'E', respondBy: at(8), status: 'countered', counter: { kind: 'raise', minValue: 9 } }),
    ],
    accords: [proposal],
  });

  it('lists each war and proposal once, the soonest deadline first', () => {
    expect(buildModel(view, user('bo'), idx)!.answers).toEqual([
      { kind: 'war', id: 'w1', respondBy: at(9) },
      { kind: 'war', id: 'w2', respondBy: at(10) },
      { kind: 'accord', id: 'a1', respondBy: at(11) },
    ]);
    expect(buildModel(view, user('ann'), idx)!.answers).toEqual([{ kind: 'war', id: 'w3', respondBy: at(8) }]);
  });

  it('goes round them, one press at a time', () => {
    const { answers } = buildModel(view, user('bo'), idx)!;
    const next = (last: string | null) => nextAnswer(answers, last)?.id;
    expect(next(null)).toBe('w1');
    expect(next('w1')).toBe('w2');
    expect(next('w2')).toBe('a1');
    expect(next('a1')).toBe('w1');
    // Once the last one is answered, it starts over at the top.
    expect(next('w3')).toBe('w1');
    expect(nextAnswer([], null)).toBeNull();
  });
});
