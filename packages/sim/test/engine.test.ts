import {
  WHITE_PEACE,
  attackableTargets,
  missionComplete,
  protectedEpisodes,
  raiseDemand,
  raiseOptions,
  seededRandom,
  suggestStake,
  tributeCountries,
  turnOrder,
  type TerritoryId,
} from '@empire/rules';
import { describe, expect, it } from 'vitest';
import { makeBots } from '../src/bots';
import { answer, propose, renounce } from '../src/engine/diplomacy';
import { runCampaign } from '../src/engine/engine';
import { nextRound } from '../src/engine/lifecycle';
import { heldBy } from '../src/engine/state';
import { pass } from '../src/engine/turns';
import { warBoard } from '../src/engine/board';
import { finish } from '../src/engine/victory';
import { answerPeace, declare, fight, fortify, offerPeace, recall, reply, respond } from '../src/engine/wars';
import { isComplete } from '../src/engine/victory';
import { missionWorld } from '../src/engine/world';
import { recordOf } from '../src/record';
import { baseConfig } from '../src/scenarios';
import { ORIGINAL_ANSWERS, awardsOf, declareOn, give, idx, pointsOf, result, scripted, targetOf, war } from './helpers';

/** In the scripted three-player draft p1 holds France, Germany and Italy; p2 China; p3 India. */
const positions = (territories: TerritoryId[], need = 3) => ({
  kind: 'strategic_positions' as const,
  territories,
  need,
});
const EUROPE = positions(['CHN', 'DEU', 'FRA', 'IND', 'ITA']);

describe('claims', () => {
  it('start in round 1 for drafted positions and score when round 3 starts, never in round 2', () => {
    const s = scripted({ players: 3, publics: () => [EUROPE] });
    expect(s.claims.get('p1\np0')?.startedRound).toBe(1);
    nextRound(s);
    expect(pointsOf(s, 'p1')).toBe(0);
    nextRound(s);
    expect(awardsOf(s)).toEqual(['p1:strategic_positions@3']);
  });

  it('break when the position breaks, and start again from scratch', () => {
    const s = scripted({ players: 3, publics: () => [EUROPE] });
    nextRound(s);
    give(s, ['DEU'], 'p2');
    expect(s.claimLog.map((c) => c.status)).toEqual(['interrupted']);
    nextRound(s);
    give(s, ['DEU'], 'p1');
    expect(s.claims.get('p1\np0')?.startedRound).toBe(3);
    nextRound(s);
    expect(pointsOf(s, 'p1')).toBe(0);
    nextRound(s);
    expect(awardsOf(s)).toEqual(['p1:strategic_positions@5']);
  });

  it('wait while an open war could break the position, then score when it ends well', () => {
    const s = scripted({ players: 3, publics: () => [EUROPE], config: { pace: 'correspondence' } });
    nextRound(s);
    const w = declareOn(s, 'p2', 'ITA');
    w.dueRound = 3;
    respond(s, w, { kind: 'accept' });
    nextRound(s);
    expect(s.claims.get('p1\np0')?.blockedBy).toEqual([w.id]);
    expect(pointsOf(s, 'p1')).toBe(0);
    fight(s, w, result('defender'));
    expect(awardsOf(s)).toEqual(['p1:strategic_positions@3']);
  });
});

describe('historic missions', () => {
  it('score the moment they are complete: Campaign Veteran with defensive wins', () => {
    const s = scripted({
      players: 3,
      publics: () => [{ kind: 'campaign_veteran', wins: 3, opponents: 2, attackWins: 1 }],
    });
    // Declared before any ends: once a war between two players ends, they're in truce for the round.
    const wars = [declareOn(s, 'p1', targetOf(s, 'p1', 'p2')), declareOn(s, 'p2', targetOf(s, 'p2', 'p1'))];
    wars.push(declareOn(s, 'p3', targetOf(s, 'p3', 'p1')));
    for (const w of wars) respond(s, w, { kind: 'accept' });
    fight(s, wars[0]!, result('attacker'));
    fight(s, wars[1]!, result('defender'));
    expect(pointsOf(s, 'p1')).toBe(0);
    fight(s, wars[2]!, result('defender'));
    expect(awardsOf(s)).toEqual(['p1:campaign_veteran@1']);
  });

  it('Kingslayer: a war won on whoever led when it was declared, by a player who trailed', () => {
    const s = scripted({ players: 3, publics: () => [{ kind: 'kingslayer' }] });
    // p1 leads on value (no points yet); p1's own win over p2 doesn't count.
    war(s, 'p1', targetOf(s, 'p1', 'p2'), 'attacker');
    expect(awardsOf(s)).toEqual([]);
    war(s, 'p3', targetOf(s, 'p3', 'p1'), 'attacker');
    expect(awardsOf(s)).toEqual(['p3:kingslayer@1']);
  });

  it('Backstab: break an accord, then take a country from that partner within two rounds', () => {
    const s = scripted({ players: 3, publics: () => [], secrets: () => ({ p1: { kind: 'backstab', rounds: 2 } }) });
    answer(s, propose(s, 'p1', 'p2', 3), true);
    nextRound(s);
    renounce(s, s.accords[0]!, 'p1');
    expect(s.byId.get('p1')!.revealedRound).toBe(2);
    nextRound(s);
    // Tokens in peace terms take no country: they don't count.
    const paid = declareOn(s, 'p1', targetOf(s, 'p1', 'p2'));
    s.byId.get('p2')!.tokens = 1;
    const offer = offerPeace(s, paid, 'p2', { ...WHITE_PEACE, tokensToAttacker: 1 });
    if (typeof offer === 'string') throw new Error(offer);
    expect(answerPeace(s, paid, offer, true)).toBeNull();
    expect(paid.outcome).toBe('settled');
    expect(pointsOf(s, 'p1')).toBe(0);
    nextRound(s);
    nextRound(s);
    // Round 5 is past the window (the break was in round 2).
    war(s, 'p1', targetOf(s, 'p1', 'p2'), 'attacker');
    expect(pointsOf(s, 'p1')).toBe(0);
  });

  it('Backstab scores for a strike declared in the last round of the window', () => {
    const s = scripted({ players: 3, publics: () => [], secrets: () => ({ p1: { kind: 'backstab', rounds: 2 } }) });
    answer(s, propose(s, 'p1', 'p2', 3), true);
    nextRound(s);
    renounce(s, s.accords[0]!, 'p1');
    nextRound(s);
    nextRound(s);
    war(s, 'p1', targetOf(s, 'p1', 'p2'), 'attacker');
    expect(awardsOf(s)).toEqual(['p1:backstab@4']);
  });
});

describe('secrets', () => {
  const nordic = { kind: 'nordic' as const, territories: ['DNK', 'FIN', 'NOR', 'SWE'], need: 4, reveal: 3 };

  it('are revealed one step away, before any claim', () => {
    const s = scripted({
      players: 3,
      publics: () => [],
      give: () => ({ FIN: 'p2', DNK: 'p2' }),
      secrets: () => ({ p1: nordic }),
    });
    expect(s.byId.get('p1')!.revealedRound).toBeNull();
    nextRound(s);
    give(s, ['FIN'], 'p1');
    expect(s.byId.get('p1')!.revealedRound).toBe(2);
    expect(s.claims.size).toBe(0);
    give(s, ['DNK'], 'p1');
    expect(s.claims.get('p1\nsecret')?.startedRound).toBe(2);
  });

  it('completed in one jump are revealed together with the claim', () => {
    const s = scripted({
      players: 3,
      publics: () => [],
      give: () => ({ FIN: 'p2', DNK: 'p2' }),
      secrets: () => ({ p1: nordic }),
    });
    give(s, ['FIN', 'DNK'], 'p1');
    expect(s.byId.get('p1')!.revealedRound).toBe(1);
    expect(s.claims.get('p1\nsecret')?.startedRound).toBe(1);
  });
});

describe('winning', () => {
  it('is shared by players who cross the line together on equal totals', () => {
    const s = scripted({
      players: 3,
      publics: () => [positions(['FRA', 'CHN'], 1), positions(['DEU', 'KEN'], 1)],
      secrets: () => ({
        p1: { kind: 'nordic', territories: ['NOR', 'SWE'], need: 2, reveal: 2 },
        p2: { kind: 'horn_of_africa', territories: ['ETH', 'ERI'], need: 2, reveal: 2 },
      }),
    });
    nextRound(s);
    nextRound(s);
    expect(s.status).toBe('finished');
    expect(s.winners).toEqual(['p1', 'p2']);
    expect(pointsOf(s, 'p1')).toBe(7);
  });

  it('ends the campaign at once: wars still open are cancelled with nothing changing hands', () => {
    const s = scripted({
      players: 3,
      publics: () => [positions(['FRA', 'CHN'], 1), positions(['DEU', 'KEN'], 1)],
      secrets: () => ({ p1: { kind: 'nordic', territories: ['NOR', 'SWE'], need: 2, reveal: 2 } }),
    });
    nextRound(s);
    const open = declareOn(s, 'p3', targetOf(s, 'p3', 'p2'));
    nextRound(s);
    expect(s.winners).toEqual(['p1']);
    expect(open.outcome).toBe('cancelled');
    expect(open.transfers).toEqual([]);
  });
});

describe('titles (a what-if)', () => {
  const TITLES = { stats: ['population', 'areaKm2'] as const, points: 2 };
  const titled = (toWin = 10) =>
    scripted({
      players: 3,
      publics: () => [EUROPE],
      config: { variant: { name: 'titles', description: '', titles: TITLES, points: { toWin } } },
    });

  it('go to the leaders when round 1 starts, and move, points and all, when the lead changes', () => {
    const s = titled();
    const leader = (key: 'population' | 'areaKm2') => s.titles.get(key);
    expect(leader('population')).not.toBeNull();
    expect(leader('areaKm2')).not.toBeNull();
    // Everything p2 and p3 hold but one country each goes to p1, who now leads on both.
    const keep = new Set(['p2', 'p3'].map((id) => [...heldBy(s, id)].sort()[0]!));
    give(
      s,
      [...s.holdings].filter(([id, h]) => h.ownerId !== 'p1' && !keep.has(id)).map(([id]) => id),
      'p1',
    );
    expect(leader('population')).toBe('p1');
    expect(leader('areaKm2')).toBe('p1');
    expect(pointsOf(s, 'p1')).toBe(4);
    expect(pointsOf(s, 'p2') + pointsOf(s, 'p3')).toBe(0);
    expect(s.history.awards.reduce((n, a) => n + a.points, 0)).toBe(4);
  });

  it('count toward the points to win alongside missions', () => {
    const s = titled(6);
    const keep = new Set(['p2', 'p3'].map((id) => [...heldBy(s, id)].sort()[0]!));
    give(
      s,
      [...s.holdings].filter(([id, h]) => h.ownerId !== 'p1' && !keep.has(id)).map(([id]) => id),
      'p1',
    );
    expect(s.status).toBe('active');
    // Strategic Positions, claimed from the draft, scores when round 3 starts: 4 + 2.
    nextRound(s);
    nextRound(s);
    expect(s.status).toBe('finished');
    expect(s.winners).toEqual(['p1']);
    expect(pointsOf(s, 'p1')).toBe(6);
  });
});

describe('accords', () => {
  it('count whole rounds for Protected Expansion in the round-start order the server uses', () => {
    const s = scripted({ players: 3, publics: () => [] });
    answer(s, propose(s, 'p1', 'p2', 3), true);
    answer(s, propose(s, 'p1', 'p3', 3), true);
    nextRound(s);
    nextRound(s);
    nextRound(s);
    const world = missionWorld(s);
    const [episode] = protectedEpisodes({
      world,
      userId: 'p1',
      held: heldBy(s, 'p1'),
      base: s.byId.get('p1')!.baseline,
    });
    expect(episode?.rounds).toBe(2);
    // Two rounds held through, paid at the starts of rounds 3 and 4, on each accord.
    expect(s.byId.get('p1')!.reputation).toBe(108);
    expect(s.byId.get('p2')!.reputation).toBe(104);
  });
});

describe('tribute', () => {
  it('holds offered tokens back, returning them if refused and handing them over if accepted', () => {
    const s = scripted({ players: 3, publics: () => [], config: { war: ORIGINAL_ANSWERS } });
    const p2 = s.byId.get('p2')!;
    p2.tokens = 2;
    const p1 = s.byId.get('p1')!;
    p1.tokens = 2;
    const refused = declareOn(s, 'p1', targetOf(s, 'p1', 'p2'));
    const accepted = declareOn(s, 'p1', targetOf(s, 'p1', 'p2', [refused.targetId]));
    respond(s, refused, { kind: 'tribute', tokens: 1 });
    expect(p2.tokens).toBe(1);
    reply(s, refused, { kind: 'refuse' });
    expect(p2.tokens).toBe(2);
    expect(refused.status).toBe('ready');
    const before = p1.tokens;
    respond(s, accepted, { kind: 'tribute', tokens: 2 });
    reply(s, accepted, { kind: 'accept' });
    expect(p1.tokens).toBe(before + 2);
    expect(p2.tokens).toBe(0);
  });
});

describe('the revised answers', () => {
  /** The stakes before October 2026, which these tests' targets and stakes are sized for. */
  const stakes = { stakeFloorPct: 80, raisePct: 125 };

  it('a matched raise puts a country in, which a win takes with the target', () => {
    const s = scripted({ players: 3, publics: () => [] });
    // The first of p2's countries p1 can attack where p2 has something to put in.
    const raisable = [...attackableTargets(warBoard(s), 'p1')].sort().find((targetId) => {
      if (s.holdings.get(targetId)!.ownerId !== 'p2') return false;
      const plan = suggestStake(warBoard(s), 'p1', targetId)!;
      const trial = { id: 'trial', attackerId: 'p1', defenderId: 'p2', targetId, stake: plan.stake, offered: null };
      return raiseOptions({ ...warBoard(s), wars: [trial] }, trial).length > 0;
    })!;
    const w = declareOn(s, 'p1', raisable);
    const board = warBoard(s);
    const active = board.wars.find((x) => x.id === w.id)!;
    const added = raiseOptions(board, active)[0]!;
    expect(respond(s, w, { kind: 'raise' })).toBe('raise-country');
    expect(respond(s, w, { kind: 'raise', territoryId: added })).toBeNull();
    const counter = w.counter as { kind: 'raise'; minValue: number; added: string };
    expect(counter.added).toBe(added);
    const plan = suggestStake(warBoard(s), 'p1', w.targetId, {
      launchId: w.launchId,
      minValue: counter.minValue,
      exceptWarId: w.id,
    })!;
    expect(reply(s, w, { kind: 'accept', stake: plan.stake })).toBeNull();
    fight(s, w, result('attacker'));
    expect(w.transfers.map((t) => t.territoryId)).toEqual([w.targetId, added]);
    expect(s.holdings.get(added)!.ownerId).toBe('p1');
  });

  it('reserves meet a token raise at once, and the attacker gets the token', () => {
    const s = scripted({ players: 3, publics: () => [], config: { war: { ...stakes, raise: 'token' } } });
    const p1 = s.byId.get('p1')!;
    const p2 = s.byId.get('p2')!;
    p1.tokens = 1;
    p2.tokens = 1;
    const targetId = targetOf(s, 'p1', 'p2');
    const floor = raiseDemand(warBoard(s), { targetId, stake: [] });
    const plan = suggestStake(warBoard(s), 'p1', targetId)!;
    const raised = suggestStake(warBoard(s), 'p1', targetId, { launchId: plan.launchId, minValue: floor })!;
    const reserves = raised.stake.filter((id) => !plan.stake.includes(id));
    const w = declare(s, 'p1', { targetId, launchId: plan.launchId, stake: plan.stake, reserves });
    if (typeof w === 'string') throw new Error(w);
    const replies = s.actions.filter((a) => a.t === 'reply').length;
    expect(respond(s, w, { kind: 'raise' })).toBeNull();
    // Met at once, which the server does itself: no reply to replay.
    expect(w.status).toBe('ready');
    expect(s.actions.filter((a) => a.t === 'reply').length).toBe(replies);
    expect(s.stats.fromReserves).toBe(1);
    expect([p1.tokens, p2.tokens]).toEqual([1, 0]);
  });

  it('a declaration can be called off before an answer; a country fortified needs a raised stake', () => {
    const s = scripted({ players: 3, publics: () => [], config: { war: stakes } });
    const w = declareOn(s, 'p1', targetOf(s, 'p1', 'p2'));
    expect(recall(s, w)).toBeNull();
    expect(w.outcome).toBe('withdrawn');
    const p2 = s.byId.get('p2')!;
    p2.tokens = 1;
    const targetId = targetOf(s, 'p1', 'p2');
    const before = suggestStake(warBoard(s), 'p1', targetId)!.value;
    expect(fortify(s, 'p2', targetId)).toBeNull();
    expect(p2.tokens).toBe(0);
    expect(s.holdings.get(targetId)!.fortifiedUntil).toBe(s.round + 2);
    expect(suggestStake(warBoard(s), 'p1', targetId)?.value ?? Infinity).toBeGreaterThan(before);
  });

  it('peace terms settle a war and sign any accord they name', () => {
    const s = scripted({ players: 3, publics: () => [] });
    const w = declareOn(s, 'p1', targetOf(s, 'p1', 'p2'));
    const board = warBoard(s);
    const tribute = tributeCountries(
      board,
      board.wars.find((x) => x.id === w.id)!,
    )[0]!;
    const declined = offerPeace(s, w, 'p2', { ...WHITE_PEACE, toAttacker: [tribute] });
    if (typeof declined === 'string') throw new Error(declined);
    expect(answerPeace(s, w, declined, false)).toBeNull();
    expect(w.status).toBe('declared');
    const offer = offerPeace(s, w, 'p2', { ...WHITE_PEACE, toAttacker: [tribute], accordRounds: 2 });
    if (typeof offer === 'string') throw new Error(offer);
    expect(answerPeace(s, w, offer, true)).toBeNull();
    expect(w).toMatchObject({ status: 'resolved', outcome: 'settled', response: 'peace' });
    expect(s.holdings.get(tribute)!.ownerId).toBe('p1');
    expect(s.accords.at(-1)).toMatchObject({ proposerId: 'p2', recipientId: 'p1', status: 'active', rounds: 2 });
    expect(s.actions.at(-1)).toMatchObject({ t: 'peace-answer', accept: true, accord: s.accords.at(-1)!.id });
  });

  it('the campaign’s end gives back a token paid for a counter still unanswered', () => {
    const s = scripted({ players: 3, publics: () => [], config: { war: { ...stakes, raise: 'token' } } });
    const p2 = s.byId.get('p2')!;
    p2.tokens = 1;
    const w = declareOn(s, 'p1', targetOf(s, 'p1', 'p2'));
    expect(respond(s, w, { kind: 'raise' })).toBeNull();
    expect(p2.tokens).toBe(0);
    finish(s, ['p3']);
    expect(p2.tokens).toBe(1);
    expect(w.outcome).toBe('cancelled');
  });
});

describe('declaring in turns', () => {
  const inTurns = () => scripted({ players: 3, publics: () => [EUROPE], config: { war: { turns: true } } });
  /** The cheapest declaration `attacker` could make on one of `defender`'s countries. */
  const planOn = (s: ReturnType<typeof inTurns>, attacker: string, defender: string) => {
    const targetId = targetOf(s, attacker, defender);
    const plan = suggestStake(warBoard(s), attacker, targetId)!;
    return { targetId, launchId: plan.launchId, stake: plan.stake };
  };

  it('take one declaration or fortification a turn, in an order that moves on a seat a round', () => {
    const s = inTurns();
    const order = turnOrder(s.order, 1) as [string, string, string];
    expect(s.turns).toEqual({ order, passed: [], current: order[0] });
    const [first, second, third] = order;
    expect(declare(s, second, planOn(s, second, third))).toBe('not-your-turn');
    expect(fortify(s, second, [...heldBy(s, second)][0]!)).toBe('not-your-turn');
    expect(pass(s, second)).toBe('not-your-turn');

    expect(pass(s, first)).toBeNull();
    expect(s.actions.at(-1)).toEqual({ t: 'pass', by: first });
    expect(s.turns).toMatchObject({ passed: [first], current: second });
    expect(fortify(s, second, [...heldBy(s, second)].sort()[0]!)).toBeNull();
    expect(s.turns!.current).toBe(third);
    const w = declare(s, third, planOn(s, third, second));
    expect(typeof w).not.toBe('string');
    // The first passed, and the others have spent their token: declaring is over.
    expect(s.turns!.current).toBeNull();
    expect(declare(s, first, planOn(s, first, second))).toBe('turns-over');

    nextRound(s);
    expect(s.turns).toEqual({ order: turnOrder(s.order, 2), passed: [], current: turnOrder(s.order, 2)[0] });
  });

  it('run whole campaigns with every declaration on its player’s turn', () => {
    const cfg = baseConfig({ players: 4, debug: true });
    const s = runCampaign(cfg, 3, { bots: makeBots(cfg.bots), idx });
    expect(s.rules.war.turns).toBe(true);
    let done = new Set<string>();
    let passes = 0;
    for (const a of s.actions) {
      if (a.t === 'open' || a.t === 'round') done = new Set();
      if (a.t !== 'pass' && a.t !== 'declare' && a.t !== 'fortify') continue;
      // Nobody declares or fortifies after passing in the same round.
      expect(done.has(a.by)).toBe(false);
      if (a.t === 'pass') {
        done.add(a.by);
        passes++;
      }
    }
    // Bots mostly spend every token, and a player without one is passed over, so passes are few.
    expect(passes).toBeGreaterThan(0);
  });
});

describe('whole campaigns', () => {
  const play = (players: number, seed: number) => {
    const cfg = baseConfig({ players, debug: true });
    return runCampaign(cfg, seed, { bots: makeBots(cfg.bots), idx });
  };

  it('are the same campaign for the same seed', () => {
    const strip = (r: ReturnType<typeof recordOf>) => ({ ...r, ms: 0 });
    expect(strip(recordOf(play(3, 5), 0))).toEqual(strip(recordOf(play(3, 5), 0)));
  });

  it('decide the connection missions exactly as the rules do', () => {
    const s = play(4, 3);
    const world = missionWorld(s);
    const random = seededRandom(9);
    let complete = 0;
    for (let i = 0; i < 300; i++) {
      const owner = s.players[i % s.players.length]!.id;
      const mine = [...heldBy(s, owner)];
      const any = idx.ids;
      const at = (ids: readonly TerritoryId[]) => ids[Math.floor(random() * ids.length)]!;
      // Mostly ends the player holds, so plenty of chains are complete.
      const endpoints: [TerritoryId, TerritoryId] = [at(mine), i % 3 === 0 ? at(any) : at(mine)];
      for (const spec of [
        { kind: 'great_connection' as const, endpoints },
        { kind: 'great_connection' as const, endpoints, needsConquest: true },
        { kind: 'silk_road' as const, endpoints },
      ]) {
        const expected = missionComplete(world, owner, spec);
        expect(isComplete(s, world, owner, spec), `${JSON.stringify(spec)}`).toBe(expected);
        if (expected) complete++;
      }
    }
    expect(complete).toBeGreaterThan(50);
  });

  it.each([2, 8])('play out at %i players with every invariant holding', (players) => {
    const s = play(players, 2);
    expect(s.round).toBeGreaterThan(0);
    expect(s.status === 'finished' || s.round === s.cfg.roundCap).toBe(true);
  });
});

describe('the season', () => {
  const play = (players: number, seed: number, overrides: Parameters<typeof baseConfig>[0] = {}) => {
    const cfg = baseConfig({ players, debug: true, ...overrides });
    return runCampaign(cfg, seed, { bots: makeBots(cfg.bots), idx });
  };

  it('ends after the last round, when the host moves on: the most points win, then the most value', () => {
    let ended = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = play(3, seed, { lastRound: 3 });
      expect(s.status).toBe('finished');
      expect(s.finishedRound).toBeLessThanOrEqual(3);
      if (!s.endedByLimit) continue;
      ended++;
      expect(s.actions.at(-1)).toEqual({ t: 'end' });
      const best = Math.max(...s.players.map((p) => pointsOf(s, p.id)));
      for (const w of s.winners) expect(pointsOf(s, w)).toBe(best);
    }
    expect(ended).toBeGreaterThan(0);
  });

  it('is new campaigns’ default, and can be turned off or ignored when measuring missions', () => {
    expect(play(2, 1).rules.victory.lastRound).toBe(25);
    expect(play(2, 1, { lastRound: null }).rules.victory.lastRound).toBeNull();
    const horizon = play(2, 1, { mode: 'horizon', roundCap: 6, lastRound: 3 });
    expect(horizon.round).toBe(6);
    expect(horizon.endedByLimit).toBe(false);
  });

  it('can replay an earlier mission rules version', () => {
    const s = play(2, 1, { missionVersion: 2, lastRound: null });
    expect(s.rules.victory.version).toBe(2);
    expect(s.publicSpecs.map((m) => m.kind)).toEqual([
      'expansion',
      'strategic_positions',
      'great_connection',
      'campaign_veteran',
    ]);
    const now = play(2, 1);
    expect(now.publicSpecs.map((m) => m.kind)).toEqual([
      'expansion',
      'strategic_positions',
      'great_powers',
      'campaign_veteran',
    ]);
  });
});
