import { missionComplete, protectedEpisodes, seededRandom, type TerritoryId } from '@empire/rules';
import { describe, expect, it } from 'vitest';
import { makeBots } from '../src/bots';
import { answer, propose, renounce } from '../src/engine/diplomacy';
import { runCampaign } from '../src/engine/engine';
import { nextRound } from '../src/engine/lifecycle';
import { heldBy } from '../src/engine/state';
import { fight, reply, respond } from '../src/engine/wars';
import { isComplete } from '../src/engine/victory';
import { missionWorld } from '../src/engine/world';
import { recordOf } from '../src/record';
import { baseConfig } from '../src/scenarios';
import { awardsOf, declareOn, give, idx, pointsOf, result, scripted, targetOf, war } from './helpers';

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
    // Tokens as tribute take no country: they don't count.
    const paid = declareOn(s, 'p1', targetOf(s, 'p1', 'p2'));
    s.byId.get('p2')!.tokens = 1;
    respond(s, paid, { kind: 'tribute', tokens: 1 });
    reply(s, paid, { kind: 'accept' });
    expect(paid.outcome).toBe('tribute');
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
    const s = scripted({ players: 3, publics: () => [] });
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
