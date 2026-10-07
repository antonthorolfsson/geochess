import {
  ChessGame,
  DEFAULT_RULES,
  TARGET_REJECTION_MESSAGES,
  afterGame,
  attackerColor,
  checkTarget,
  hopDistances,
  indexDataset,
  missionRules,
  stakeFloor,
  valueOf,
  winnerOf,
  type Dataset,
} from '@empire/rules';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { SAMPLE_BATTLE, SAMPLE_EMPIRES } from './sample-campaign';
import {
  INITIAL_TUTORIAL,
  TUTORIAL_CLAIM_ROUND,
  TUTORIAL_DATASET,
  TUTORIAL_DEFENDER,
  TUTORIAL_MISSION,
  TUTORIAL_PLAYER,
  TUTORIAL_ROUND,
  TUTORIAL_TACTIC,
  TUTORIAL_TARGET,
  battleWon,
  canGoOn,
  judgeMove,
  missionProgress,
  movesText,
  outcomeTransfers,
  ownersAfter,
  restoreTutorial,
  startingStake,
  tacticGame,
  tacticSans,
  tutorialModel,
  tutorialReducer,
  type TutorialAction,
  type TutorialState,
} from './tutorial';

const require = createRequire(import.meta.url);
const idx = indexDataset(
  JSON.parse(
    readFileSync(require.resolve(`@empire/data/datasets/${TUTORIAL_DATASET}/territories.json`), 'utf8'),
  ) as Dataset,
);
const model = tutorialModel(idx);
const { board } = model;
const run = (actions: TutorialAction[], from: TutorialState = INITIAL_TUTORIAL) =>
  actions.reduce((state, action) => tutorialReducer(state, action, board), from);

/** Every way through to the battle, as a player would go. */
const TO_BATTLE: TutorialAction[] = [
  { type: 'start' },
  { type: 'select', id: 'ESP' },
  { type: 'next' },
  { type: 'select', id: TUTORIAL_TARGET },
  { type: 'next' },
  { type: 'declare' },
];

describe('the tutorial campaign', () => {
  it('is the sample campaign’s whole map, in Ada’s turn to declare with a war token', () => {
    expect(model.owners.size).toBe(idx.ids.length);
    expect(model.me.userId).toBe(TUTORIAL_PLAYER);
    expect(model.campaign.status).toBe('active');
    expect(model.campaign.round).toBe(TUTORIAL_ROUND);
    expect(model.tokens).toBeGreaterThanOrEqual(1);
    expect(model.turns?.mine).toBe(true);
    expect(model.turnRejection).toBeNull();
    expect(model.activeWars).toEqual([]);
    for (const e of SAMPLE_EMPIRES) expect(model.holdingsByUser.get(e.member.userId)).toEqual(e.countries);
  });

  it('lets Ada declare war on Italy, and says why other countries can’t be attacked', () => {
    expect(model.targets.has(TUTORIAL_TARGET)).toBe(true);
    expect(checkTarget(board, TUTORIAL_PLAYER, TUTORIAL_TARGET)).toBeNull();
    expect(board.holdings.get(TUTORIAL_TARGET)?.ownerId).toBe(TUTORIAL_DEFENDER);
    // Several countries are fair game, so choosing one means something.
    expect(model.targets.size).toBeGreaterThan(5);
    expect(checkTarget(board, TUTORIAL_PLAYER, 'FRA')).toBe('own-country');
    expect(checkTarget(board, TUTORIAL_PLAYER, 'BRA')).toBe('not-bordering');
    expect(TARGET_REJECTION_MESSAGES['not-bordering']).toMatch(/border/);
  });

  it('starts from the least stake the rules allow: France and Andorra, as the landing page shows it', () => {
    const draft = startingStake(board);
    expect(draft).toEqual({ launchId: 'FRA', stake: SAMPLE_BATTLE.stake.map((s) => s.id) });
    expect(valueOf(idx, draft.stake)).toBe(stakeFloor(DEFAULT_RULES, idx.byId.get(TUTORIAL_TARGET)!.value));
  });

  it('wins Italy, loses the stake, or holds on a draw, by the war rules', () => {
    const stake = startingStake(board).stake;
    expect(outcomeTransfers(stake, 'attacker')).toEqual([
      { territoryId: TUTORIAL_TARGET, from: TUTORIAL_DEFENDER, to: TUTORIAL_PLAYER },
    ]);
    expect(outcomeTransfers(stake, 'defender')).toEqual(
      stake.map((id) => ({ territoryId: id, from: TUTORIAL_PLAYER, to: TUTORIAL_DEFENDER })),
    );
    expect(outcomeTransfers(stake, 'held')).toEqual([]);
    // New campaigns' rules: the defender holds on a draw, and the attacker plays White.
    expect(afterGame(DEFAULT_RULES, false, null)).toBe('held');
    expect(attackerColor(false)).toBe('white');
  });

  it('deals a mission the generator could: five positions round Italy, spread out, three to hold', () => {
    const cfg = missionRules(DEFAULT_RULES.victory.version);
    const spec = TUTORIAL_MISSION.spec;
    if (spec.kind !== 'strategic_positions') throw new Error('Expected Strategic Positions');
    const { count, need, value, radius, spacing } = cfg.strategicPositions;
    expect(TUTORIAL_MISSION.points).toBe(cfg.points.public);
    expect(spec.territories).toHaveLength(count);
    expect(spec.need).toBe(need);
    expect(spec.needsConquest).toBe(cfg.positionsNeedConquest);
    const fromHub = hopDistances(idx, TUTORIAL_TARGET);
    expect(idx.neighbors(TUTORIAL_TARGET).length).toBeGreaterThanOrEqual(3);
    for (const id of spec.territories) {
      const t = idx.byId.get(id)!;
      expect(t.micro).toBe(false);
      expect(t.value).toBeGreaterThanOrEqual(value[0]);
      expect(t.value).toBeLessThanOrEqual(value[1]);
      expect(fromHub.get(id)).toBeLessThanOrEqual(radius);
      const apart = hopDistances(idx, id);
      for (const other of spec.territories) if (other !== id) expect(apart.get(other)).toBeGreaterThanOrEqual(spacing);
    }
    expect(new Set(spec.territories.map((id) => idx.byId.get(id)!.subregion)).size).toBeGreaterThanOrEqual(2);
  });

  it('completes the mission by taking Italy, and not by losing the stake', () => {
    const stake = startingStake(board).stake;
    const before = missionProgress(idx, model.owners);
    expect(before.complete).toBe(false);
    expect(before.parts.map((p) => [p.have, p.need])).toEqual([
      [2, 3],
      [0, 1],
    ]);
    const won = missionProgress(idx, ownersAfter(model.owners, outcomeTransfers(stake, 'attacker')));
    expect(won.complete).toBe(true);
    expect(won.evidence.territories).toContain(TUTORIAL_TARGET);
    const lost = missionProgress(idx, ownersAfter(model.owners, outcomeTransfers(stake, 'defender')));
    expect(lost.complete).toBe(false);
    expect(TUTORIAL_CLAIM_ROUND).toBe(TUTORIAL_ROUND + 2);
  });
});

describe('the tutorial’s chess tactic', () => {
  /** White's moves that mate at once. */
  const mates = (game: ChessGame) =>
    game.legalMoves().filter((m) => {
      const after = ChessGame.fromMoves([...game.moves, m], TUTORIAL_TACTIC.fen);
      return after.ending()?.reason === 'checkmate';
    });

  it('is a legal position with the attacker, White, to move', () => {
    const game = tacticGame([]);
    expect(game.turn).toBe(attackerColor(false));
    expect(game.ending()).toBeNull();
    expect(mates(game)).toEqual([]);
  });

  it('has one winning line: a mate in two, the reply forced', () => {
    const start = tacticGame([]);
    // Every first move after which every reply allows a mate.
    const keys = start.legalMoves().filter((m) => {
      const after = tacticGame([m]);
      return !after.ending() && after.legalMoves().every((r) => mates(tacticGame([m, r])).length > 0);
    });
    expect(keys).toEqual([TUTORIAL_TACTIC.line[0]]);
    expect(tacticGame([TUTORIAL_TACTIC.line[0]]).legalMoves()).toEqual([TUTORIAL_TACTIC.line[1]]);
    expect(mates(tacticGame(TUTORIAL_TACTIC.line.slice(0, 2)))).toEqual([TUTORIAL_TACTIC.line[2]]);
    const end = tacticGame(TUTORIAL_TACTIC.line).ending();
    expect(end?.reason).toBe('checkmate');
    expect(afterGame(DEFAULT_RULES, false, winnerOf(end!.result))).toBe('attacker');
    expect(TUTORIAL_TACTIC.hint.from + TUTORIAL_TACTIC.hint.to).toBe(TUTORIAL_TACTIC.line[0]);
  });

  it('writes the line as the game numbers it', () => {
    expect(tacticSans()).toEqual(['Rd8+', 'Rxd8', 'Rxd8#']);
    expect(movesText(tacticSans())).toBe('27. Rd8+ Rxd8 28. Rxd8#');
  });

  it('tells the winning move from other legal moves and from nonsense, typed or played', () => {
    expect(judgeMove([], 'd2d8')).toBe('right');
    expect(judgeMove([], 'Rd8+')).toBe('right');
    expect(judgeMove([], 'd2d7')).toBe('wrong');
    expect(judgeMove([], 'Nxe5')).toBe('wrong');
    expect(judgeMove([], 'e2e4')).toBe('illegal');
    expect(judgeMove([], 'hello')).toBe('illegal');
    expect(judgeMove(TUTORIAL_TACTIC.line.slice(0, 1), 'c8d8')).toBe('illegal');
    expect(judgeMove(TUTORIAL_TACTIC.line.slice(0, 2), 'Rxd8#')).toBe('right');
    expect(judgeMove([...TUTORIAL_TACTIC.line], 'a3a4')).toBe('illegal');
  });
});

describe('the tutorial’s steps', () => {
  it('goes on only once each step’s task is done', () => {
    let s = run([{ type: 'start' }]);
    expect(s.step).toBe('empire');
    expect(run([{ type: 'next' }], s).step).toBe('empire');
    // Another empire's country isn't yours to inspect.
    s = run([{ type: 'select', id: 'ITA' }], s);
    expect(s.inspected).toBe(false);
    s = run([{ type: 'select', id: 'DEU' }, { type: 'next' }], s);
    expect(s.step).toBe('target');
    expect(s.selected).toBeNull();
    // Another legal target, or one of your own countries, doesn't open the stake.
    expect(run([{ type: 'select', id: 'GRC' }, { type: 'next' }], s).step).toBe('target');
    s = run([{ type: 'select', id: TUTORIAL_TARGET }, { type: 'next' }], s);
    expect(s.step).toBe('stake');
    expect(s.stake).toEqual(startingStake(board));
    expect(canGoOn(s, board)).toBe(true);
  });

  it('won’t declare with a stake below the floor', () => {
    let s = run(TO_BATTLE.slice(0, -1));
    s = run([{ type: 'stake', draft: { launchId: 'FRA', stake: ['FRA'] } }, { type: 'declare' }], s);
    expect(s.step).toBe('stake');
    s = run([{ type: 'stake', draft: { launchId: 'FRA', stake: ['FRA', 'AND', 'ESP'] } }, { type: 'declare' }], s);
    expect(s.step).toBe('battle');
  });

  it('plays the battle only along the winning line, with the reply scripted', () => {
    let s = run(TO_BATTLE);
    expect(run([{ type: 'next' }], s).step).toBe('battle');
    expect(run([{ type: 'move', uci: 'd2d7' }], s).moves).toEqual([]);
    expect(run([{ type: 'reply' }], s).moves).toEqual([]);
    s = run([{ type: 'move', uci: 'd2d8' }, { type: 'move', uci: 'd1d8' }, { type: 'reply' }], s);
    expect(s.moves).toEqual(TUTORIAL_TACTIC.line.slice(0, 2));
    s = run([{ type: 'move', uci: 'd1d8' }], s);
    expect(battleWon(s.moves)).toBe(true);
    expect(s.skipped).toBe(false);
    expect(run([{ type: 'next' }, { type: 'next' }], s).step).toBe('finish');
  });

  it('skips the battle by playing the win', () => {
    const s = run([...TO_BATTLE, { type: 'skip' }]);
    expect(s.moves).toEqual(TUTORIAL_TACTIC.line);
    expect(s.skipped).toBe(true);
    expect(run([{ type: 'next' }], s).step).toBe('result');
  });

  it('goes back before the war is declared, not after, and starts over from anywhere', () => {
    const atStake = run(TO_BATTLE.slice(0, -1));
    expect(run([{ type: 'back' }], atStake)).toMatchObject({ step: 'target', selected: TUTORIAL_TARGET });
    expect(run([{ type: 'back' }, { type: 'back' }], atStake).step).toBe('empire');
    expect(run([{ type: 'back' }], run(TO_BATTLE)).step).toBe('battle');
    expect(run([{ type: 'reset' }], run([...TO_BATTLE, { type: 'skip' }]))).toEqual(INITIAL_TUTORIAL);
  });
});

describe('restoring the tutorial after a reload', () => {
  const store = (s: TutorialState) => JSON.stringify(s);

  it('picks up where the player was', () => {
    for (const s of [
      run([{ type: 'start' }]),
      run(TO_BATTLE.slice(0, 3)),
      run(TO_BATTLE.slice(0, -1)),
      run([...TO_BATTLE, { type: 'move', uci: 'd2d8' }]),
      run([...TO_BATTLE, { type: 'skip' }, { type: 'next' }]),
      run([...TO_BATTLE, { type: 'skip' }, { type: 'next' }, { type: 'next' }]),
    ]) {
      expect(restoreTutorial(store(s), board)).toEqual(s);
    }
  });

  it('starts afresh from nothing, nonsense, or a place the rules couldn’t have reached', () => {
    const won = run([...TO_BATTLE, { type: 'skip' }, { type: 'next' }]);
    for (const text of [
      null,
      '',
      'not json',
      '[]',
      '{"version":2}',
      store({ ...won, step: 'elsewhere' as TutorialState['step'] }),
      store({ ...won, moves: ['d2d7'] }),
      store({ ...won, moves: TUTORIAL_TACTIC.line.slice(0, 2) }),
      store({ ...won, stake: { launchId: 'FRA', stake: ['FRA'] } }),
      store({ ...won, stake: { launchId: 'ESP', stake: ['FRA', 'AND'] } }),
      store({ ...run([{ type: 'start' }]), step: 'target' }),
      store({ ...run(TO_BATTLE.slice(0, 3)), moves: ['d2d8'] }),
    ]) {
      expect(restoreTutorial(text, board)).toEqual(INITIAL_TUTORIAL);
    }
  });
});
