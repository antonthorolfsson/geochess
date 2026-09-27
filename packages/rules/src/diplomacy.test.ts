import { describe, expect, it } from 'vitest';
import {
  ACCORD_TERMS_MAX,
  REPUTATION_PER_ROUND,
  accordBetween,
  accordEndsRound,
  accordsHeldThrough,
  accordsInForce,
  checkProposal,
  cleanText,
  conversationKey,
  feedShows,
  partnerIn,
  firstSignedRound,
  renunciationAgainst,
  renunciationsFrom,
  reputationForKeeping,
  type AccordHistory,
  type AccordRecord,
} from './diplomacy';
import type { FeedItem } from './protocol';

const ANN = 'ann';
const BO = 'bo';
const CY = 'cy';

const record = (over: Partial<AccordRecord> = {}): AccordRecord => ({
  id: 'a1',
  proposerId: ANN,
  recipientId: BO,
  status: 'active',
  endsRound: 5,
  endedRound: null,
  brokenBy: null,
  ...over,
});

describe('accord lengths', () => {
  it('count round starts, like truces', () => {
    // Signed in round 3 for 3 rounds: in force through round 5, over when round 6 starts.
    expect(accordEndsRound(3, 3)).toBe(6);
    // Signed during the draft (round 0): over when round 3 starts.
    expect(accordEndsRound(0, 3)).toBe(3);
  });
});

describe('accords in force', () => {
  it('are signed accords whose end round has not started', () => {
    const records = [
      record(),
      record({ id: 'a2', recipientId: CY, endsRound: 3 }),
      record({ id: 'a3', status: 'proposed', endsRound: null }),
      record({ id: 'a4', status: 'kept' }),
    ];
    expect(accordsInForce(records, 3)).toEqual([{ id: 'a1', players: [ANN, BO], endsRound: 5 }]);
    const board = { round: 3, accords: accordsInForce(records, 3) };
    expect(accordBetween(board, BO, ANN)?.id).toBe('a1');
    expect(accordBetween(board, ANN, CY)).toBeUndefined();
  });
});

describe('reputation for accords', () => {
  const held = (over: Partial<AccordHistory> = {}): AccordHistory => ({
    id: 'a1',
    proposerId: ANN,
    recipientId: BO,
    status: 'active',
    signedRound: 1,
    renews: null,
    ...over,
  });
  const paying = (accords: AccordHistory[], round: number) => accordsHeldThrough(accords, round).map((a) => a.id);

  it('is paid for each whole round an accord held, from the round after it was signed', () => {
    // Signed during round 1: round 1 doesn't count, round 2 is paid when round 3 starts.
    expect(paying([held()], 2)).toEqual([]);
    expect(paying([held()], 3)).toEqual(['a1']);
    expect(paying([held()], 4)).toEqual(['a1']);
  });

  it('is never paid for a one-round accord, nor for the draft', () => {
    // A one-round accord signed in round 2 ends when round 3 starts, having held no whole round.
    expect(paying([held({ signedRound: 2 })], 3)).toEqual([]);
    // Signed during the draft: nothing when the draft ends, then round 1 is paid when round 2 starts.
    expect(paying([held({ signedRound: 0 })], 1)).toEqual([]);
    expect(paying([held({ signedRound: 0 })], 2)).toEqual(['a1']);
  });

  it('carries on through renewals, however many', () => {
    const first = held({ status: 'renewed' });
    const second = held({ id: 'a2', status: 'renewed', signedRound: 2, renews: 'a1' });
    const third = held({ id: 'a3', signedRound: 2, renews: 'a2' });
    // Renewed twice during round 2: the partners were covered all through it.
    expect(paying([first, second, third], 3)).toEqual(['a3']);
    expect(firstSignedRound(third, [first, second, third])).toBe(1);
    // Without the history, a renewal counts from its own signing.
    expect(paying([third], 3)).toEqual([]);
  });

  it('stops when an accord is broken, and never pays proposals', () => {
    expect(paying([held({ status: 'broken' }), held({ id: 'a2', status: 'proposed', signedRound: null })], 5)).toEqual(
      [],
    );
  });

  it('can be worked out before signing', () => {
    expect(reputationForKeeping(4, 3)).toBe(2 * REPUTATION_PER_ROUND);
    expect(reputationForKeeping(4, 1)).toBe(0);
    expect(reputationForKeeping(0, 3)).toBe(2 * REPUTATION_PER_ROUND);
    // Renewing an accord in force since round 2 keeps this round paid too.
    expect(reputationForKeeping(4, 3, 2)).toBe(3 * REPUTATION_PER_ROUND);
    expect(reputationForKeeping(4, 3, 4)).toBe(2 * REPUTATION_PER_ROUND);
  });
});

describe('renunciations', () => {
  it('hold the breaker back from the former partner for the rest of the round', () => {
    const broken = record({ status: 'broken', brokenBy: BO, endedRound: 2 });
    expect(renunciationsFrom([broken], 2)).toEqual([{ breakerId: BO, partnerId: ANN, untilRound: 3 }]);
    expect(renunciationsFrom([broken], 3)).toEqual([]);
    const board = { round: 2, renunciations: renunciationsFrom([broken], 2) };
    expect(renunciationAgainst(board, BO, ANN)).toBeDefined();
    expect(renunciationAgainst(board, ANN, BO)).toBeUndefined();
  });
});

describe('proposals', () => {
  const campaign = { status: 'active' as const, memberIds: [ANN, BO, CY], accords: [] as AccordRecord[] };

  it('are open from the draft until the campaign ends', () => {
    expect(checkProposal(campaign, ANN, BO, 3)).toBeNull();
    expect(checkProposal({ ...campaign, status: 'draft' }, ANN, BO, 3)).toBeNull();
    expect(checkProposal({ ...campaign, status: 'lobby' }, ANN, BO, 3)).toBe('closed');
    expect(checkProposal({ ...campaign, status: 'finished' }, ANN, BO, 3)).toBe('closed');
  });

  it('need another member, a sensible length and short terms', () => {
    expect(checkProposal(campaign, ANN, ANN, 3)).toBe('self');
    expect(checkProposal(campaign, ANN, 'dee', 3)).toBe('not-member');
    expect(checkProposal(campaign, ANN, BO, 0)).toBe('bad-length');
    expect(checkProposal(campaign, ANN, BO, 11)).toBe('bad-length');
    expect(checkProposal(campaign, ANN, BO, 2.5)).toBe('bad-length');
    expect(checkProposal(campaign, ANN, BO, 3, 'x'.repeat(ACCORD_TERMS_MAX + 1))).toBe('terms-too-long');
  });

  it('allow one waiting proposal per pair, but can renew an accord in force', () => {
    const pending = { ...campaign, accords: [record({ status: 'proposed', proposerId: BO, recipientId: ANN })] };
    expect(checkProposal(pending, ANN, BO, 3)).toBe('pending');
    expect(checkProposal(pending, ANN, CY, 3)).toBeNull();
    const signed = { ...campaign, accords: [record()] };
    expect(checkProposal(signed, BO, ANN, 3)).toBeNull();
  });
});

describe('helpers', () => {
  it('name the partner and the conversation', () => {
    expect(partnerIn(record(), ANN)).toBe(BO);
    expect(partnerIn(record(), BO)).toBe(ANN);
    expect(conversationKey(BO, ANN)).toBe('ann:bo');
    expect(conversationKey(ANN, BO)).toBe('ann:bo');
    expect(conversationKey(ANN, null)).toBe('channel');
  });

  it('trim free text to null when empty', () => {
    expect(cleanText('  hold the line  ')).toBe('hold the line');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });
});

describe('feed filters', () => {
  const event = (type: string) => ({ kind: 'event', event: { type } }) as FeedItem;
  const message = (recipientId: string | null) => ({ kind: 'message', message: { recipientId } }) as FeedItem;

  it('sort dispatches and messages', () => {
    expect(feedShows('wars', event('war.declared'))).toBe(true);
    expect(feedShows('wars', event('round.started'))).toBe(true);
    expect(feedShows('wars', event('accord.signed'))).toBe(false);
    expect(feedShows('accords', event('reputation.changed'))).toBe(true);
    expect(feedShows('accords', event('reputation.earned'))).toBe(true);
    expect(feedShows('all', event('draft.pick'))).toBe(true);
    expect(feedShows('chat', event('draft.pick'))).toBe(false);
    expect(feedShows('chat', message(null))).toBe(true);
    expect(feedShows('all', message(null))).toBe(true);
    expect(feedShows('wars', message(null))).toBe(false);
    expect(feedShows('all', message('bo'))).toBe(false);
  });
});
