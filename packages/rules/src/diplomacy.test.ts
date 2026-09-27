import { describe, expect, it } from 'vitest';
import {
  ACCORD_TERMS_MAX,
  accordBetween,
  accordEndsRound,
  accordsInForce,
  checkProposal,
  cleanText,
  conversationKey,
  feedShows,
  partnerIn,
  renunciationAgainst,
  renunciationsFrom,
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
    expect(feedShows('all', event('draft.pick'))).toBe(true);
    expect(feedShows('chat', event('draft.pick'))).toBe(false);
    expect(feedShows('chat', message(null))).toBe(true);
    expect(feedShows('all', message(null))).toBe(true);
    expect(feedShows('wars', message(null))).toBe(false);
    expect(feedShows('all', message('bo'))).toBe(false);
  });
});
