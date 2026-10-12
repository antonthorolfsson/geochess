import {
  DEFAULT_RULES,
  indexDataset,
  type CampaignRules,
  type CampaignView,
  type GameSummary,
  type WarView,
} from '@empire/rules';
import { makeTerritory } from '@empire/rules/testing';
import { describe, expect, it } from 'vitest';
import { buildModel } from './campaign';
import { countryList, gameWinner, verdictOf } from './verdict';

/** K - L - T - X: Ann holds K and L, Bo T and X. */
const idx = indexDataset({
  version: 'test',
  generatedAt: '2026-01-01T00:00:00.000Z',
  attribution: [],
  territories: [
    makeTerritory('K', 3, ['L'], []),
    makeTerritory('L', 4, ['K', 'T'], []),
    makeTerritory('T', 5, ['L', 'X'], []),
    makeTerritory('X', 3, ['T'], []),
  ],
  seaLanes: [],
});

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

/** Ann attacks T from L, staking L and K. */
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

function modelFor(viewer: string, rules: CampaignRules = DEFAULT_RULES) {
  const view: CampaignView = {
    id: 'c1',
    name: 'Test',
    status: 'active',
    round: 2,
    hostId: 'ann',
    rules,
    datasetVersion: 'test',
    inviteCode: 'code',
    createdAt: '2026-01-01T00:00:00.000Z',
    deleteAt: null,
    members: [member('ann', 0), member('bo', 3), member('cy', 5)],
    holdings: { K: 'ann', L: 'ann', T: 'bo', X: 'bo' },
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
  return buildModel(view, { id: viewer, name: viewer, email: null, lichessUsername: null, hasPassword: false }, idx)!;
}

/** The attacker plays White; in an Armageddon, Black. */
const game = (result: GameSummary['result'], reason: GameSummary['reason'], armageddon = false): GameSummary => ({
  id: 'g1',
  armageddon,
  whiteId: armageddon ? 'bo' : 'ann',
  blackId: armageddon ? 'ann' : 'bo',
  status: 'finished',
  result,
  reason,
  overTheBoard: false,
});
const withRules = (draws: CampaignRules['war']['draws']): CampaignRules => ({
  ...DEFAULT_RULES,
  war: { ...DEFAULT_RULES.war, draws },
});

describe('a game’s verdict', () => {
  it('stamps the winner’s victory and what the war hands them', () => {
    expect(verdictOf(modelFor('ann'), game('1-0', 'checkmate'), WAR)).toEqual({
      mine: 'won',
      winnerId: 'ann',
      winnerColor: 'white',
      stamp: 'Victory',
      headline: 'Ann wins',
      how: 'Won by checkmate',
      spoils: 'Territory T is yours',
      summary: 'Victory. Won by checkmate. Territory T is yours.',
    });
  });

  it('stamps the loser’s defeat, and what they lose', () => {
    expect(verdictOf(modelFor('bo'), game('1-0', 'checkmate'), WAR)).toMatchObject({
      mine: 'lost',
      stamp: 'Defeat',
      how: 'Lost by checkmate',
      spoils: 'You lose Territory T',
    });
    expect(verdictOf(modelFor('ann'), game('0-1', 'resignation'), WAR)).toMatchObject({
      stamp: 'Defeat',
      how: 'Lost by resignation',
      spoils: 'You lose Territory L and Territory K',
    });
  });

  it('names the winner for anyone watching', () => {
    expect(verdictOf(modelFor('cy'), game('0-1', 'timeout'), WAR)).toMatchObject({
      mine: null,
      winnerId: 'bo',
      stamp: null,
      headline: 'Bo wins',
      how: 'On time',
      spoils: 'Bo takes Territory L and Territory K',
      summary: 'Bo wins on time. Bo takes Territory L and Territory K.',
    });
  });

  it('says what a draw does to the war, by the campaign’s rule', () => {
    expect(verdictOf(modelFor('cy', withRules('defender-holds')), game('1/2-1/2', 'agreement'), WAR)).toMatchObject({
      winnerId: null,
      stamp: null,
      headline: 'Draw',
      how: 'By agreement',
      spoils: 'Territory T holds',
      summary: 'Draw by agreement. Territory T holds.',
    });
    expect(verdictOf(modelFor('ann', withRules('armageddon')), game('1/2-1/2', 'stalemate'), WAR)).toMatchObject({
      mine: 'drawn',
      stamp: 'Draw',
      how: 'Drawn by stalemate',
      spoils: 'An Armageddon game decides it',
    });
  });

  it('gives a drawn Armageddon to Black', () => {
    const tiebreak = game('1/2-1/2', 'threefold-repetition', true);
    expect(gameWinner(tiebreak)).toBe('black');
    expect(verdictOf(modelFor('ann', withRules('armageddon')), tiebreak, WAR)).toMatchObject({
      mine: 'won',
      winnerId: 'ann',
      stamp: 'Victory',
      how: 'Drawn by threefold repetition: a draw goes to Black',
      spoils: 'Territory T is yours',
    });
    expect(verdictOf(modelFor('cy', withRules('armageddon')), tiebreak, WAR)?.summary).toBe(
      'Ann wins. Drawn by threefold repetition: a draw goes to Black. Ann takes Territory T.',
    );
  });

  it('has nothing to say before the end, or of a war it can’t see', () => {
    expect(verdictOf(modelFor('ann'), { ...game(null, null), status: 'playing' }, WAR)).toBeNull();
    expect(verdictOf(modelFor('ann'), game('1-0', 'checkmate'), undefined)?.spoils).toBeNull();
    expect(gameWinner(game(null, null))).toBeUndefined();
  });
});

describe('countryList', () => {
  it('names a few countries, and counts the rest', () => {
    const model = modelFor('ann');
    expect(countryList(model, ['T'])).toBe('Territory T');
    expect(countryList(model, ['T', 'X'])).toBe('Territory T and Territory X');
    expect(countryList(model, ['T', 'X', 'K'])).toBe('Territory T, Territory X and Territory K');
    expect(countryList(model, ['T', 'X', 'K', 'L'])).toBe('Territory T, Territory X and 2 more');
  });
});
