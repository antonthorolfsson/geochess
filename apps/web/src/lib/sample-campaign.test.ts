import {
  ChessGame,
  DEFAULT_RULES,
  EMPIRE_COLORS,
  checkStake,
  checkTarget,
  indexDataset,
  stakeFloor,
  valueOf,
  type Dataset,
  type WarBoard,
} from '@empire/rules';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_BATTLE,
  SAMPLE_DATASET,
  SAMPLE_EMPIRES,
  SAMPLE_GAME,
  SAMPLE_ROUND,
  SAMPLE_WARS,
  sampleEmpire,
  sampleOwners,
} from './sample-campaign';

// The dataset the sample was played on: versions never change, so neither does the sample's map.
const require = createRequire(import.meta.url);
const idx = indexDataset(
  JSON.parse(
    readFileSync(require.resolve(`@empire/data/datasets/${SAMPLE_DATASET}/territories.json`), 'utf8'),
  ) as Dataset,
);

const ownerOf = new Map(SAMPLE_EMPIRES.flatMap((e) => e.countries.map((id) => [id, e.member.userId] as const)));

const board: WarBoard = {
  idx,
  rules: DEFAULT_RULES,
  round: SAMPLE_ROUND,
  holdings: new Map([...ownerOf].map(([id, ownerId]) => [id, { ownerId, acquiredRound: 0 }])),
  wars: [],
  truces: [],
  accords: [],
  renunciations: [],
};

describe('the landing page’s sample campaign', () => {
  it('holds every country on its map, each once', () => {
    const all = SAMPLE_EMPIRES.flatMap((e) => e.countries);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...idx.ids].sort());
    expect(sampleOwners().size).toBe(idx.ids.length);
  });

  it('gives its empires different colors', () => {
    const colors = SAMPLE_EMPIRES.map((e) => e.member.color);
    expect(new Set(colors).size).toBe(colors.length);
    for (const color of colors) expect(EMPIRE_COLORS[color]).toBeDefined();
  });

  it('draws each war from the attacker’s country to a bordering one of the defender’s', () => {
    for (const war of SAMPLE_WARS) {
      expect(ownerOf.get(war.launchId)).toBe(war.attackerId);
      expect(ownerOf.get(war.targetId)).toBe(war.defenderId);
      expect(idx.neighbors(war.targetId)).toContain(war.launchId);
    }
  });

  it('follows a war the current rules allow, as the example describes it', () => {
    const { attackerId, defenderId, target, stake } = SAMPLE_BATTLE;
    const ids = stake.map((s) => s.id);
    const launchId = stake[0].id;
    expect(SAMPLE_WARS.find((w) => w.id === SAMPLE_BATTLE.warId)).toMatchObject({
      attackerId,
      defenderId,
      launchId,
      targetId: target.id,
      threat: false,
    });
    expect(checkTarget(board, attackerId, target.id)).toBeNull();
    expect(checkStake(board, attackerId, target.id, launchId, ids)).toBeNull();
    // The example says the stake is exactly the least allowed.
    expect(valueOf(idx, ids)).toBe(stakeFloor(DEFAULT_RULES, target.value));
    for (const { id, name, value } of [target, ...stake]) {
      expect(idx.byId.get(id)).toMatchObject({ name, value });
    }
    for (const id of SAMPLE_BATTLE.frame) expect(idx.byId.has(id)).toBe(true);
    expect(sampleEmpire(attackerId).member.bot).toBeNull();
  });

  it('plays a legal game to the position it shows, with the attacker as White to move', () => {
    const game = ChessGame.fromMoves(SAMPLE_GAME.moves);
    expect(game.ply).toBe(SAMPLE_GAME.moves.length);
    expect(game.fen).toBe(SAMPLE_GAME.fen);
    expect(game.turn).toBe('white');
    expect(SAMPLE_GAME.moves.at(-1)).toBe(SAMPLE_GAME.lastMove.join(''));
    expect(SAMPLE_GAME.lastSan).toBe(`${game.ply / 2}… ${game.sans.at(-1)}`);
  });
});
