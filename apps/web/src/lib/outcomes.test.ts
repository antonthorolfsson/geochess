import {
  DEFAULT_RULES,
  indexDataset,
  type CampaignRules,
  type CampaignView,
  type ClaimView,
  type MissionView,
  type PeaceOfferView,
  type VictoryView,
  type WarView,
} from '@empire/rules';
import { makeTerritory } from '@empire/rules/testing';
import { describe, expect, it } from 'vitest';
import { buildModel } from './campaign';
import { outcomeLines, proposedWar, stakesText, warOutlook } from './outcomes';
import { claimSteps, pointsBreakdown } from './victory';

/**
 * E - A - B - C ~ D   (values E2 A4 B5 C3 D7; people 1, 50, 40, 5 and 30 million)
 * Ann holds E and A (51 million: Largest Population), Bo B and C (45), Cy D (30).
 */
const idx = indexDataset({
  version: 'test',
  generatedAt: '2026-01-01T00:00:00.000Z',
  attribution: [],
  territories: [
    makeTerritory('E', 2, ['A'], [], 1e6),
    makeTerritory('A', 4, ['B', 'E'], [], 50e6),
    makeTerritory('B', 5, ['A', 'C'], [], 40e6),
    makeTerritory('C', 3, ['B'], ['D'], 5e6),
    makeTerritory('D', 7, [], ['C'], 30e6),
  ],
  seaLanes: [{ a: 'C', b: 'D', from: [0, 0], to: [1, 1], km: 100, manual: false }],
});
const name = (id: string) => `Territory ${id}`;

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
const positions: MissionView = {
  key: 'p0',
  scope: 'public',
  points: 2,
  spec: { kind: 'strategic_positions', territories: ['A', 'B', 'D'], need: 2 },
};
const homeland: MissionView = {
  key: 'p1',
  scope: 'public',
  points: 2,
  spec: { kind: 'strategic_positions', territories: ['E', 'A'], need: 2 },
};
const progress = { complete: false, near: false, parts: [], evidence: { territories: [] } };

/** Bo attacks A from B, staking B: the game is on. */
const BO_ON_A: WarView = {
  id: 'w1',
  attackerId: 'bo',
  defenderId: 'ann',
  targetId: 'A',
  launchId: 'B',
  stake: ['B'],
  redirectedFrom: null,
  status: 'playing',
  counter: null,
  outcome: null,
  declaredRound: 4,
  resolvedRound: null,
  respondBy: null,
  declaredAt: '2026-01-01T00:00:00.000Z',
  resolvedAt: null,
  games: [],
  reserves: [],
  peace: [],
};

function view(opts: { wars?: WarView[]; rules?: CampaignRules; victory?: Partial<VictoryView> } = {}): CampaignView {
  const players = [
    { userId: 'ann', points: 6 },
    { userId: 'bo', points: 9 },
    { userId: 'cy', points: 2 },
  ];
  return {
    id: 'c1',
    name: 'Test',
    status: 'active',
    round: 4,
    hostId: 'ann',
    rules: opts.rules ?? DEFAULT_RULES,
    datasetVersion: 'test',
    inviteCode: 'code',
    createdAt: '2026-01-01T00:00:00.000Z',
    deleteAt: null,
    members: [member('ann', 0), member('bo', 3), member('cy', 5)],
    holdings: { E: 'ann', A: 'ann', B: 'bo', C: 'bo', D: 'cy' },
    draft: null,
    myDraftList: [],
    myAutodraftFallback: 'best',
    turns: null,
    events: [],
    wars: opts.wars ?? [BO_ON_A],
    truces: [],
    acquired: {},
    fortified: {},
    accords: [],
    victory: {
      version: 6,
      pointsToWin: 10,
      publicPoints: 2,
      secretPoints: 3,
      hold: 'turns',
      holdMs: 0,
      lastRound: 25,
      tiebreak: 'realWorld',
      publicMissions: [positions, homeland],
      titles: [
        { kind: 'population', holderId: 'ann', totals: {} },
        { kind: 'land', holderId: null, totals: {} },
      ],
      titlePoints: 1,
      players: players.map((p) => ({
        ...p,
        titles: p.userId === 'ann' ? ['population'] : [],
        awards:
          p.points > 1
            ? [
                {
                  userId: p.userId,
                  missionKey: 'p9',
                  kind: 'expansion',
                  points: p.points - (p.userId === 'ann' ? 1 : 0),
                  round: 2,
                  awardedAt: '',
                },
              ]
            : [],
        ready: true,
        secret: null,
        progress: { p0: progress },
      })),
      claims: [],
      selection: null,
      result: null,
      world: {
        baselines: { ann: ['E', 'A'], bo: ['B', 'C'], cy: ['D'] },
        history: { wars: [], accords: [], roundStarts: [], awards: [] },
        declared: { w1: 5 },
      },
      ...opts.victory,
    },
    mySecret: null,
  };
}
const user = (id: string) => ({ id, name: id, email: null, lichessUsername: null, hasPassword: false });
const modelFor = (viewer: string, v = view()) => buildModel(v, user(viewer), idx)!;

describe('a war’s endings, from where it stands', () => {
  it('as the defender: your win first, then the loss, then a draw where the defender holds', () => {
    const model = modelFor('ann');
    const outlook = warOutlook(model, BO_ON_A)!;
    expect(outlook.current.map((e) => [e.label, e.tone, e.summary])).toEqual([
      ['If you win', 'good', `You take ${name('B')} (5).`],
      ['If you lose', 'bad', `Bo takes ${name('A')} (4).`],
      ['If drawn', 'even', `${name('A')} holds: nothing changes hands.`],
    ]);
    expect(outlook.alternatives).toEqual([]);
  });

  it('says what the loss does to the race: the title, a claim that is not points yet, and the campaign won', () => {
    const model = modelFor('ann');
    const loss = warOutlook(model, BO_ON_A)!.current[1]!;
    const lines = outcomeLines(model, loss.projection!);
    expect(lines[0]).toEqual({
      kind: 'victory',
      weight: 'major',
      tone: 'bad',
      text: 'Bo wins the campaign, with 10 points.',
    });
    expect(lines.find((l) => l.kind === 'title')?.text).toBe(
      'Largest Population passes from you to Bo: +1 while they lead, and it can be lost again.',
    );
    // Ann's homeland (E and A) and her share of A, B and D both go back; Bo gains on the homeland.
    expect(lines.filter((l) => l.kind === 'progress').map((l) => [l.weight, l.tone])).toEqual([
      ['minor', 'bad'],
      ['minor', 'bad'],
      ['minor', 'even'],
    ]);
    expect(lines.find((l) => l.kind === 'progress')?.text).toMatch(/^Strategic Positions \(you\) · .+: 1 → 0 of 2\.$/);
    // Bo completes two of A, B and D: a claim, worth nothing until it scores.
    expect(lines.find((l) => l.kind === 'claim')?.text).toBe(
      'Bo completes Strategic Positions: a claim, not points yet. It can score +2 in round 6 at the earliest, if held.',
    );
    expect(lines.at(-1)?.text).toBe('Points: you 6 → 5, Bo 9 → 10.');
  });

  it('calls out a war that could win the campaign, beside the war and the board', () => {
    expect(stakesText(modelFor('ann'), BO_ON_A)).toBe('Could win the campaign for Bo');
    expect(stakesText(modelFor('bo'), BO_ON_A)).toBe('Could win the campaign for you');
    // With the title already Bo's, winning sets up a claim that would take Bo to 11, if it scores.
    const held = { titles: [{ kind: 'population' as const, holderId: 'bo', totals: {} }] };
    expect(stakesText(modelFor('ann', view({ victory: held })), BO_ON_A)).toBe('Could set up a winning claim for Bo');
    // Twenty to win: nothing this war does decides the campaign.
    expect(stakesText(modelFor('ann', view({ victory: { ...held, pointsToWin: 20 } })), BO_ON_A)).toBeNull();
  });

  it('plays a draw by the campaign’s rule: an Armageddon to come, or one being played', () => {
    const rules = { ...DEFAULT_RULES, war: { ...DEFAULT_RULES.war, draws: 'armageddon' as const } };
    const model = modelFor('cy', view({ rules }));
    const draw = warOutlook(model, BO_ON_A)!.current.find((e) => e.key === 'draw')!;
    expect(draw.ending).toBeNull();
    expect(draw.summary).toBe(
      'An Armageddon game decides it: Bo plays Black with 80% of White’s time, and a draw then goes to Bo.',
    );
    const armageddon: WarView = {
      ...BO_ON_A,
      games: [
        { id: 'g2', armageddon: true, whiteId: 'ann', blackId: 'bo', status: 'playing' } as WarView['games'][number],
      ],
    };
    const underway = warOutlook(modelFor('cy', view({ rules, wars: [armageddon] })), armageddon)!;
    const drawn = underway.current.find((e) => e.key === 'draw')!;
    expect(drawn.ending?.outcome).toBe('attacker');
    expect(drawn.summary).toBe(`Black wins a drawn Armageddon. Bo takes ${name('A')} (4).`);
    // A spectator reads both sides by name, the attacker first.
    expect(underway.current.map((e) => e.label)).toEqual(['If Bo wins', 'If Ann wins', 'If drawn']);
  });

  it('a raise to meet: the stake is the attacker’s to choose, so the loss waits for it; withdrawing loses the token', () => {
    const raised: WarView = { ...BO_ON_A, status: 'countered', counter: { kind: 'raise', minValue: 7, added: 'E' } };
    const model = modelFor('bo', view({ wars: [raised] }));
    const open = warOutlook(model, raised)!;
    expect(open.current.map((e) => [e.label, e.summary, e.ending === null])).toEqual([
      ['If you win', `You take ${name('A')} and ${name('E')} (6).`, false],
      ['If you lose', 'Ann takes your stake, which must reach 7.', true],
      ['If drawn', `${name('A')} holds: nothing changes hands.`, false],
    ]);
    expect(open.alternatives.map((e) => [e.label, e.summary])).toEqual([
      ['If you withdraw', 'Nothing changes hands, and your war token is lost.'],
    ]);
    // With the stake being built, the loss is known.
    const built = warOutlook(model, raised, { stake: ['B', 'C'] })!;
    expect(built.current[1]!.summary).toBe(`Ann takes ${name('B')} and ${name('C')} (8).`);
    expect(built.current[1]!.projection).not.toBeNull();
  });

  it('a raise back: the defender can back down and yield the target, without a game', () => {
    const raised: WarView = {
      ...BO_ON_A,
      stake: ['B', 'C'],
      status: 'countered',
      counter: {
        kind: 'raise',
        minValue: 7,
        added: 'E',
        steps: [{ by: 'attacker', stake: ['B', 'C'], more: 2 }],
        declared: ['B'],
      },
    };
    const model = modelFor('ann', view({ wars: [raised] }));
    const open = warOutlook(model, raised)!;
    expect(open.current[1]!.summary).toBe(
      `Bo takes ${name('A')} and ${name('E')} (6), and the country you put in to meet the raise (worth 2 or more).`,
    );
    expect(open.alternatives.map((e) => [e.label, e.summary])).toEqual([
      ['If you back down', `Bo takes ${name('A')} (4). No game is played.`],
    ]);
  });

  it('tribute on the table, and peace terms only the viewer can see', () => {
    const tribute: WarView = {
      ...BO_ON_A,
      status: 'countered',
      counter: { kind: 'tribute', territoryId: 'E', tokens: 0 },
    };
    const offer: PeaceOfferView = {
      id: 'o1',
      warId: 'w1',
      proposerId: 'bo',
      recipientId: 'ann',
      terms: { toAttacker: ['E'], toDefender: [], tokensToAttacker: 0, tokensToDefender: 0, accordRounds: 2 },
      status: 'proposed',
      createdAt: '',
      respondBy: null,
      endedAt: null,
    };
    const model = modelFor('bo', view({ wars: [tribute] }));
    expect(warOutlook(model, tribute)!.alternatives.map((e) => [e.label, e.summary])).toEqual([
      ['If you accept the tribute', `You take ${name('E')} (2).`],
    ]);
    const offered = { ...BO_ON_A, peace: [offer] };
    const ann = modelFor('ann', view({ wars: [offered] }));
    expect(warOutlook(ann, offered)!.alternatives.map((e) => e.label)).toEqual(['If you accept Bo’s terms']);
  });

  it('a declaration: what it could change, what could still change it, and why it is provisional', () => {
    const model = modelFor('cy');
    const war = proposedWar(model, 'C', { launchId: 'D', stake: ['D'] });
    const outlook = warOutlook(model, war)!;
    expect(outlook.current.map((e) => e.label)).toEqual(['If you win', 'If you lose', 'If drawn']);
    expect(outlook.current[0]!.summary).toBe(`You take ${name('C')} (3).`);
    // Bo has nothing free to raise or redirect with: B is tied up in the war on A.
    expect(outlook.later).toEqual([
      'You may call it off until Bo answers; the war token stays spent.',
      'Either of you can offer peace terms until the game ends; nobody else learns of an offer unless it’s accepted.',
      'Without an answer in time, the war goes ahead as declared.',
    ]);
    expect(outlook.provisional).toEqual([
      'As the map stands now: 1 other war is still unresolved, and its result could move titles or missions first.',
      'Bo’s secret mission isn’t revealed, so it isn’t counted here.',
    ]);
  });

  it('holds up a claim the declaration could break', () => {
    const claim: ClaimView = {
      id: 1,
      userId: 'ann',
      missionKey: 'p1',
      status: 'pending',
      startedRound: 3,
      startedAt: '',
      eligibleRound: 5,
      eligibleAt: null,
      turnsHeld: false,
      blockedBy: [],
    };
    const model = modelFor('bo', view({ wars: [], victory: { claims: [claim] } }));
    const war = proposedWar(model, 'A', { launchId: 'B', stake: ['B'] });
    expect(warOutlook(model, war)!.heldUp.map((c) => c.missionKey)).toEqual(['p1']);
  });
});

describe('claims and points', () => {
  const claim: ClaimView = {
    id: 1,
    userId: 'ann',
    missionKey: 'p1',
    status: 'pending',
    startedRound: 3,
    startedAt: '',
    eligibleRound: 5,
    eligibleAt: null,
    turnsHeld: false,
    blockedBy: ['w1'],
  };

  it('say what a claim still waits for, and what in a war would break it', () => {
    const model = modelFor('ann', view({ victory: { claims: [claim] } }));
    const { steps, next } = claimSteps(model, claim, 0);
    expect(steps).toEqual([
      { done: false, text: 'Round 5 has to start: it’s round 4 now.' },
      { done: false, text: 'It waits for everyone’s turns to declare war in round 4.' },
      {
        done: false,
        text: `The war for ${name('A')} has to end without breaking it: it would break if ${name('A')} goes to Bo.`,
      },
    ]);
    expect(next).toBe(
      'It scores the moment the last of these is met, if the position still holds then. Until then it isn’t points: keep the position held.',
    );
  });

  it('tell points kept for good from title points and claims not yet scored', () => {
    const model = modelFor('ann', view({ victory: { claims: [claim] } }));
    expect(pointsBreakdown(model, 'ann')).toEqual({ missions: 5, titles: 1, claimed: 2 });
    expect(pointsBreakdown(model, 'bo')).toEqual({ missions: 9, titles: 0, claimed: 0 });
  });
});
