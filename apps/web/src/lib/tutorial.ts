import {
  ChessGame,
  DEFAULT_RULES,
  EMPTY_HISTORY,
  checkStake,
  claimEligibleRound,
  evaluateMission,
  missionRules,
  suggestStake,
  warTransfers,
  type CampaignView,
  type DatasetIndex,
  type Evaluation,
  type MissionView,
  type SessionUser,
  type TerritoryId,
  type Transfer,
  type WarBoard,
} from '@empire/rules';
import { buildModel, type CampaignModel } from './campaign';
import { SAMPLE_BATTLE, SAMPLE_DATASET, SAMPLE_EMPIRES, SAMPLE_ROUND } from './sample-campaign';

/**
 * The guest tutorial (`/tutorial`): the landing page's sample campaign, played from the moment
 * before Ada declares war on Italy, with the visitor as Ada. Everything here is sample data and
 * stays in the browser: the campaign is a `CampaignView` built locally and read through the same
 * `buildModel()` the campaign screen uses, so targets, stakes, outcomes, mission progress and chess
 * moves all come from the rules package. `tutorial.test.ts` checks the scenario against the rules.
 */
export const TUTORIAL_DATASET = SAMPLE_DATASET;

export const TUTORIAL_ROUND = SAMPLE_ROUND;

/** The visitor plays Ada's empire, Cleo defends Italy. */
export const TUTORIAL_PLAYER = SAMPLE_BATTLE.attackerId;
export const TUTORIAL_DEFENDER = SAMPLE_BATTLE.defenderId;
export const TUTORIAL_TARGET: TerritoryId = SAMPLE_BATTLE.target.id;

/** Who the campaign model is built for: nobody signs in, and nothing is sent anywhere. */
const TUTORIAL_USER: SessionUser = {
  id: TUTORIAL_PLAYER,
  name: 'Ada',
  email: null,
  lichessUsername: null,
  hasPassword: false,
};

/**
 * A public mission as the generator deals them under the current mission rules: five positions
 * worth 3 to 15, within four steps of a hub (Italy), at least two steps apart, over more than one
 * subregion, three to hold at once with one of them won since the draft. Ada holds Germany and
 * Spain; Italy would be the third, and the conquest.
 */
export const TUTORIAL_MISSION: Pick<MissionView, 'key' | 'scope' | 'points' | 'spec'> = {
  key: 'p1',
  scope: 'public',
  points: missionRules(DEFAULT_RULES.victory.version).points.public,
  spec: {
    kind: 'strategic_positions',
    territories: ['DEU', 'EGY', 'ESP', 'ITA', 'TUR'],
    need: missionRules(DEFAULT_RULES.victory.version).strategicPositions.need,
    needsConquest: true,
  },
};

/** The round a claim staked now would score in, at the earliest. */
export const TUTORIAL_CLAIM_ROUND = claimEligibleRound(TUTORIAL_ROUND);

/**
 * The campaign as the visitor sees it: the sample's map in round 6, new campaigns' rules, Ada's
 * turn to declare with one war token, and no war underway yet.
 */
export function tutorialCampaign(): CampaignView {
  const order = SAMPLE_EMPIRES.map((e) => e.member.userId);
  return {
    id: 'tutorial',
    name: 'Tutorial',
    status: 'active',
    round: TUTORIAL_ROUND,
    hostId: TUTORIAL_PLAYER,
    rules: DEFAULT_RULES,
    datasetVersion: TUTORIAL_DATASET,
    inviteCode: '',
    createdAt: '',
    deleteAt: null,
    members: SAMPLE_EMPIRES.map((e) => ({ ...e.member, tokens: 1 })),
    holdings: Object.fromEntries(SAMPLE_EMPIRES.flatMap((e) => e.countries.map((id) => [id, e.member.userId]))),
    draft: null,
    myDraftList: [],
    myAutodraftFallback: 'best',
    events: [],
    wars: [],
    truces: [],
    acquired: {},
    fortified: {},
    accords: [],
    turns: { order, current: TUTORIAL_PLAYER, deadline: null, passed: [] },
    victory: null,
    mySecret: null,
  };
}

/** The campaign screen's model of the tutorial campaign. */
export function tutorialModel(idx: DatasetIndex): CampaignModel {
  return buildModel(tutorialCampaign(), TUTORIAL_USER, idx)!;
}

// ---------------------------------------------------------------------------------------------
// Outcomes

/** How the battle could end: the attacker wins, the defender wins, or a draw and the defender holds. */
export type TutorialOutcome = 'attacker' | 'defender' | 'held';

/** What changes hands if the war on Italy ends this way, by the war rules. */
export function outcomeTransfers(stake: readonly TerritoryId[], outcome: TutorialOutcome): Transfer[] {
  return warTransfers(
    { attackerId: TUTORIAL_PLAYER, defenderId: TUTORIAL_DEFENDER, targetId: TUTORIAL_TARGET, stake: [...stake] },
    outcome,
  );
}

/** Who holds each country once these countries have changed hands. */
export function ownersAfter(
  owners: ReadonlyMap<TerritoryId, string>,
  transfers: readonly Transfer[],
): Map<TerritoryId, string> {
  const out = new Map(owners);
  for (const t of transfers) out.set(t.territoryId, t.to);
  return out;
}

/** Each country's empire color, as the map takes it. */
export function colorsOf(model: CampaignModel, owners: ReadonlyMap<TerritoryId, string>): Map<TerritoryId, number> {
  const out = new Map<TerritoryId, number>();
  for (const [id, userId] of owners) {
    const color = model.membersById.get(userId)?.color;
    if (color !== undefined) out.set(id, color);
  }
  return out;
}

/**
 * Where Ada stands on the mission with this map. The tutorial has no history to read, so the
 * baseline (who held what when the draft ended) is the prepared map itself: nothing Ada holds was
 * won since the draft, which is what the mission's conquest asks for.
 */
export function missionProgress(idx: DatasetIndex, owners: ReadonlyMap<TerritoryId, string>): Evaluation {
  return evaluateMission(
    {
      idx,
      players: SAMPLE_EMPIRES.map((e) => e.member.userId),
      owners,
      baseline: new Map(SAMPLE_EMPIRES.map((e) => [e.member.userId, new Set(e.countries)])),
      history: EMPTY_HISTORY,
    },
    TUTORIAL_PLAYER,
    TUTORIAL_MISSION.spec,
  );
}

// ---------------------------------------------------------------------------------------------
// The battle

/**
 * The war game, later on: Ada plays White, the attacker. Cleo's queen has broken in and attacks the
 * rook on d2, but Cleo's king has no way off the back rank. White mates in two, and only one way:
 * 27. Rd8+, Cleo's one legal reply 27… Rxd8, and 28. Rxd8#. `tutorial.test.ts` proves all three.
 */
export const TUTORIAL_TACTIC = {
  fen: '2r3k1/1b3ppp/p7/4p3/4P3/Pq2BN1P/1P1R1PP1/3R2K1 w - - 0 27',
  line: ['d2d8', 'c8d8', 'd1d8'],
  /** The piece to move first and where it goes, for the hint. */
  hint: { from: 'd2', to: 'd8' },
} as const;

/** The battle so far, from the tactic's position. */
export const tacticGame = (moves: readonly string[]) => ChessGame.fromMoves(moves, TUTORIAL_TACTIC.fen);

/** The winning line in SAN: Rd8+, Rxd8, Rxd8#. */
export const tacticSans = (): string[] => tacticGame(TUTORIAL_TACTIC.line).sans;

/** "27. Rd8+ Rxd8 28. Rxd8#": moves played from the tactic's position, numbered as the game counts them. */
export function movesText(sans: readonly string[]): string {
  const first = Number(TUTORIAL_TACTIC.fen.split(' ')[5]);
  const out: string[] = [];
  sans.forEach((san, i) => out.push(i % 2 === 0 ? `${first + i / 2}. ${san}` : san));
  return out.join(' ');
}

export const battleWon = (moves: readonly string[]) => moves.length === TUTORIAL_TACTIC.line.length;

/** What a move the player tries does: the next move of the win, or a legal move that isn't, or no move at all. */
export type MoveVerdict = 'right' | 'wrong' | 'illegal';

export function judgeMove(moves: readonly string[], uci: string): MoveVerdict {
  const game = tacticGame(moves);
  if (battleWon(moves) || game.turn !== 'white') return 'illegal';
  const played = game.parseInput(uci);
  if (!played) return 'illegal';
  return played === TUTORIAL_TACTIC.line[moves.length] ? 'right' : 'wrong';
}

// ---------------------------------------------------------------------------------------------
// Steps and state

export const TUTORIAL_STEPS = ['intro', 'empire', 'target', 'stake', 'battle', 'result', 'finish'] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/** The numbered steps, as the progress strip shows them. */
export const NUMBERED_STEPS: readonly { step: TutorialStep; label: string }[] = [
  { step: 'empire', label: 'Your empire' },
  { step: 'target', label: 'A target' },
  { step: 'stake', label: 'The stake' },
  { step: 'battle', label: 'The battle' },
  { step: 'result', label: 'What changed' },
];

export interface StakeDraft {
  launchId: TerritoryId;
  /** The launching country first. */
  stake: TerritoryId[];
}

export interface TutorialState {
  version: 1;
  step: TutorialStep;
  /** The country picked on the map or from a list. */
  selected: TerritoryId | null;
  /** The player has looked at one of their own countries: the first step's task. */
  inspected: boolean;
  /** The stake as built; set when the stake step first opens. */
  stake: StakeDraft | null;
  /** Moves played in the battle, from the tactic's position. */
  moves: string[];
  /** The winning line was played for the player. */
  skipped: boolean;
}

export const INITIAL_TUTORIAL: TutorialState = {
  version: 1,
  step: 'intro',
  selected: null,
  inspected: false,
  stake: null,
  moves: [],
  skipped: false,
};

export type TutorialAction =
  | { type: 'start' }
  | { type: 'select'; id: TerritoryId | null }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'stake'; draft: StakeDraft }
  | { type: 'declare' }
  | { type: 'move'; uci: string }
  | { type: 'reply' }
  | { type: 'skip' }
  | { type: 'reset' };

const stakeIsValid = (board: WarBoard, draft: StakeDraft | null): draft is StakeDraft =>
  draft !== null &&
  draft.stake[0] === draft.launchId &&
  checkStake(board, TUTORIAL_PLAYER, TUTORIAL_TARGET, draft.launchId, draft.stake) === null;

/** The cheapest legal stake against Italy, as the stake builder starts from. */
export function startingStake(board: WarBoard): StakeDraft {
  const plan = suggestStake(board, TUTORIAL_PLAYER, TUTORIAL_TARGET)!;
  return { launchId: plan.launchId, stake: plan.stake };
}

/** Whether the step's task is done, so the player can go on. */
export function canGoOn(state: TutorialState, board: WarBoard): boolean {
  switch (state.step) {
    case 'intro':
      return true;
    case 'empire':
      return state.inspected;
    case 'target':
      return state.selected === TUTORIAL_TARGET;
    case 'stake':
      return stakeIsValid(board, state.stake);
    case 'battle':
      return battleWon(state.moves);
    case 'result':
      return true;
    case 'finish':
      return false;
  }
}

const stepAfter = (step: TutorialStep): TutorialStep =>
  TUTORIAL_STEPS[Math.min(TUTORIAL_STEPS.indexOf(step) + 1, TUTORIAL_STEPS.length - 1)]!;

/**
 * The tutorial's moves, checked by the rules: a step's task must be done to go on (choosing Italy,
 * a legal stake, the battle won), and a battle move must be the next of the winning line.
 */
export function tutorialReducer(state: TutorialState, action: TutorialAction, board: WarBoard): TutorialState {
  switch (action.type) {
    case 'reset':
      return INITIAL_TUTORIAL;
    case 'start':
      return state.step === 'intro' ? { ...state, step: 'empire' } : state;
    case 'select': {
      if (state.step !== 'empire' && state.step !== 'target') return state;
      const mine = action.id !== null && board.holdings.get(action.id)?.ownerId === TUTORIAL_PLAYER;
      return { ...state, selected: action.id, inspected: state.inspected || (state.step === 'empire' && mine) };
    }
    case 'next': {
      if (state.step === 'stake' || !canGoOn(state, board)) return state;
      const step = stepAfter(state.step);
      if (step === 'stake') return { ...state, step, stake: state.stake ?? startingStake(board) };
      // The map starts the next step afresh, except the target chosen.
      return { ...state, step, selected: step === 'target' ? null : state.selected };
    }
    case 'back':
      if (state.step === 'target') return { ...state, step: 'empire', selected: null };
      if (state.step === 'stake') return { ...state, step: 'target', selected: TUTORIAL_TARGET };
      return state;
    case 'stake':
      return state.step === 'stake' ? { ...state, stake: action.draft } : state;
    case 'declare':
      return state.step === 'stake' && stakeIsValid(board, state.stake) ? { ...state, step: 'battle' } : state;
    case 'move':
      if (state.step !== 'battle' || judgeMove(state.moves, action.uci) !== 'right') return state;
      return { ...state, moves: [...state.moves, TUTORIAL_TACTIC.line[state.moves.length]!] };
    case 'reply': {
      const next = TUTORIAL_TACTIC.line[state.moves.length];
      if (state.step !== 'battle' || next === undefined || state.moves.length % 2 === 0) return state;
      return { ...state, moves: [...state.moves, next] };
    }
    case 'skip':
      return state.step === 'battle' ? { ...state, moves: [...TUTORIAL_TACTIC.line], skipped: true } : state;
  }
}

// ---------------------------------------------------------------------------------------------
// Keeping the place across a reload

/** Where the tutorial keeps its place: this tab's session storage, nowhere else. */
export const TUTORIAL_STORAGE_KEY = 'geochess.tutorial';

/**
 * A stored tutorial, if it's one the rules could have reached; anything else (an older shape, a
 * stake that's no longer legal, moves off the winning line) starts the tutorial afresh.
 */
export function restoreTutorial(text: string | null, board: WarBoard): TutorialState {
  if (!text) return INITIAL_TUTORIAL;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return INITIAL_TUTORIAL;
  }
  if (typeof raw !== 'object' || raw === null) return INITIAL_TUTORIAL;
  const s = raw as Partial<Record<keyof TutorialState, unknown>>;
  if (s.version !== 1 || !TUTORIAL_STEPS.includes(s.step as TutorialStep)) return INITIAL_TUTORIAL;
  const step = s.step as TutorialStep;
  const selected = typeof s.selected === 'string' && board.idx.byId.has(s.selected) ? s.selected : null;
  const stake = isDraft(s.stake) ? s.stake : null;
  const moves = Array.isArray(s.moves) ? s.moves : [];
  const onLine = moves.length <= TUTORIAL_TACTIC.line.length && moves.every((m, i) => m === TUTORIAL_TACTIC.line[i]);
  const state: TutorialState = {
    version: 1,
    step,
    selected,
    inspected: s.inspected === true,
    stake,
    moves: onLine ? (moves as string[]) : [],
    skipped: s.skipped === true,
  };
  const at = TUTORIAL_STEPS.indexOf(step);
  const reached =
    onLine &&
    (at < TUTORIAL_STEPS.indexOf('target') || state.inspected) &&
    (at < TUTORIAL_STEPS.indexOf('stake') || stakeIsValid(board, stake)) &&
    (at > TUTORIAL_STEPS.indexOf('battle') ? battleWon(state.moves) : step === 'battle' || moves.length === 0);
  return reached ? state : INITIAL_TUTORIAL;
}

function isDraft(value: unknown): value is StakeDraft {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return typeof d.launchId === 'string' && Array.isArray(d.stake) && d.stake.every((id) => typeof id === 'string');
}
