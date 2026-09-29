import type { Color, LiveClockSpec, TimeControl } from './chess';
import type { CampaignRules, Pace } from './config';
import type { TerritoryId } from './dataset';
import {
  ACCORD_MAX_ROUNDS,
  ACCORD_MIN_ROUNDS,
  accordBetween,
  renunciationAgainst,
  type Accord,
  type Renunciation,
} from './diplomacy';
import type { UserId } from './draft';
import { bordersAny, getTerritory, reachableWithin, type DatasetIndex } from './graph';

/** Who holds a country, and the round they got it in (0 for countries drafted at the start). */
export interface Holding {
  ownerId: UserId;
  acquiredRound: number;
  /** Fortified until this round starts: until then a war on it needs a raised stake. */
  fortifiedUntil?: number | null;
}

/** An unresolved war, as far as the rules are concerned. */
export interface ActiveWar {
  id: string;
  attackerId: UserId;
  defenderId: UserId;
  targetId: TerritoryId;
  /** The launching country first, then the countries added to it. */
  stake: readonly TerritoryId[];
  /** A country the defender has offered (a redirect, tribute or matched raise), while the attacker decides. */
  offered: TerritoryId | null;
  /** The defender's country a matched raise put into the war, once the attacker met it: won with the target. */
  added?: TerritoryId | null;
  /** Countries the attacker set aside to meet a raise, tied up until the defender's answer is settled. */
  reserves?: readonly TerritoryId[];
}

/**
 * The defender's counter-offer, which the attacker must answer:
 * - `raise`: stake at least `minValue`, or withdraw. A matched raise names the defender's `added`
 *   country, which winning takes along with the target.
 * - `redirect`: fight for `targetId` instead, or withdraw.
 * - `tribute`: take `territoryId` or `tokens` instead of fighting, or refuse and fight.
 *
 * `tokens` on a raise or redirect is what the counter cost the defender: the attacker gets it if
 * they fight on. On tribute it's the tokens offered, held back from the defender until the answer.
 */
export type WarCounter =
  | { kind: 'raise'; minValue: number; added?: TerritoryId; tokens?: number }
  | { kind: 'redirect'; targetId: TerritoryId; tokens?: number }
  | { kind: 'tribute'; territoryId: TerritoryId | null; tokens: number };

/** The country a counter-offer ties up while the attacker decides. */
export function offeredCountry(counter: WarCounter | null): TerritoryId | null {
  if (counter?.kind === 'redirect') return counter.targetId;
  if (counter?.kind === 'tribute') return counter.territoryId;
  if (counter?.kind === 'raise') return counter.added ?? null;
  return null;
}

/** The defender's country a matched raise put into the war (at stake once the attacker meets it). */
export const addedCountry = (counter: WarCounter | null): TerritoryId | null =>
  counter?.kind === 'raise' ? (counter.added ?? null) : null;

/** A stored war (a server row or a client view) as the rules see it. */
export function activeWar(war: {
  id: string;
  attackerId: UserId;
  defenderId: UserId;
  targetId: TerritoryId;
  stake: readonly TerritoryId[];
  status: string;
  counter: WarCounter | null;
  reserves?: readonly TerritoryId[];
}): ActiveWar {
  return {
    id: war.id,
    attackerId: war.attackerId,
    defenderId: war.defenderId,
    targetId: war.targetId,
    stake: war.stake,
    // An offered country is tied up only while the attacker decides.
    offered: war.status === 'countered' ? offeredCountry(war.counter) : null,
    // A met matched raise leaves the added country at stake until the war ends.
    added: war.status === 'ready' || war.status === 'playing' ? addedCountry(war.counter) : null,
    // Reserves wait for the defender's answer and the attacker's reply; after that they're free.
    reserves: war.status === 'declared' || war.status === 'countered' ? (war.reserves ?? []) : [],
  };
}

/** Two players who can't declare war on each other until `endsRound` starts. */
export interface Truce {
  players: readonly [UserId, UserId];
  endsRound: number;
}

/** Everything the war rules look at. */
export interface WarBoard {
  idx: DatasetIndex;
  rules: CampaignRules;
  /** The current campaign round. */
  round: number;
  holdings: ReadonlyMap<TerritoryId, Holding>;
  /** Unresolved wars. */
  wars: readonly ActiveWar[];
  /** Truces in force. */
  truces: readonly Truce[];
  /** Accords in force: neither partner may declare war on the other. */
  accords: readonly Accord[];
  /** Accords renounced this round: the breaker can't declare war on the former partner yet. */
  renunciations: readonly Renunciation[];
}

/**
 * How long the defender has to answer a declaration, and the attacker to answer a counter. Accord
 * proposals get the same window.
 */
export const RESPONSE_WINDOW_MS: Record<Pace, number> = {
  live: 5 * 60_000,
  correspondence: 24 * 60 * 60_000,
};

/** The answer window in words. */
export const RESPONSE_WINDOW_TEXT: Record<Pace, string> = {
  live: '5 minutes',
  correspondence: '24 hours',
};

/** `pct` percent of a whole number, rounded up, without floating-point surprises. */
const percentUp = (value: number, pct: number) => Math.floor((value * pct + 99) / 100);

/** The least a stake against a target of this value may be worth. */
export function stakeFloor(rules: CampaignRules, targetValue: number): number {
  return percentUp(targetValue, rules.war.stakeFloorPct);
}

/** The least a stake may be worth once the defender raises. */
export function raiseFloor(rules: CampaignRules, targetValue: number): number {
  return percentUp(targetValue, rules.war.raisePct);
}

export function valueOf(idx: DatasetIndex, ids: Iterable<TerritoryId>): number {
  let sum = 0;
  for (const id of ids) sum += idx.byId.get(id)?.value ?? 0;
  return sum;
}

/**
 * Countries tied up in unresolved wars (targets, stakes, pending offers, countries added by a
 * raise and reserves), with the war holding each.
 */
export function warLocks(wars: readonly ActiveWar[]): Map<TerritoryId, string> {
  const locks = new Map<TerritoryId, string>();
  for (const war of wars) {
    locks.set(war.targetId, war.id);
    for (const id of war.stake) locks.set(id, war.id);
    if (war.offered) locks.set(war.offered, war.id);
    if (war.added) locks.set(war.added, war.id);
    for (const id of war.reserves ?? []) locks.set(id, war.id);
  }
  return locks;
}

// ---------------------------------------------------------------------------------------------
// Fortifying

/** Rounds a fortification lasts: it holds until that many more rounds have started. */
export const FORTIFY_ROUNDS = 2;
/** War tokens it costs to fortify a country. */
export const FORTIFY_COST = 1;

/** The round at whose start a fortification made in `round` ends. */
export const fortifyEnds = (round: number) => round + FORTIFY_ROUNDS;

/** The round at whose start a country's fortification ends, or null if it isn't fortified now. */
export function fortifiedUntil(board: WarBoard, territoryId: TerritoryId): number | null {
  const until = board.holdings.get(territoryId)?.fortifiedUntil ?? null;
  return until !== null && board.round < until ? until : null;
}

/**
 * The least a stake against this target may be worth now: the stake floor, or what a raise to a
 * percentage demands while the target is fortified.
 */
export function declarationFloor(board: WarBoard, targetId: TerritoryId): number {
  const value = getTerritory(board.idx, targetId).value;
  const floor = stakeFloor(board.rules, value);
  return fortifiedUntil(board, targetId) === null ? floor : Math.max(floor, raiseFloor(board.rules, value));
}

export type FortifyRejection = 'off' | 'unknown-territory' | 'not-yours' | 'fortified';

export const FORTIFY_REJECTION_MESSAGES: Record<FortifyRejection, string> = {
  off: "Fortifying is not part of this campaign's rules.",
  'unknown-territory': 'That country is not on this map.',
  'not-yours': 'You can only fortify your own countries.',
  fortified: 'That country is already fortified for as long as fortifying now would last.',
};

/** Why `userId` can't fortify `territoryId` now, or null if they can (tokens aside). */
export function checkFortify(board: WarBoard, userId: UserId, territoryId: TerritoryId): FortifyRejection | null {
  if (!board.rules.war.fortify) return 'off';
  if (!board.idx.byId.has(territoryId)) return 'unknown-territory';
  if (board.holdings.get(territoryId)?.ownerId !== userId) return 'not-yours';
  const until = fortifiedUntil(board, territoryId);
  if (until !== null && until >= fortifyEnds(board.round)) return 'fortified';
  return null;
}

/** The round from which a country won in a war can be staked, or null if it can be staked now. */
export function stakeableFromRound(board: WarBoard, holding: Holding): number | null {
  if (holding.acquiredRound === 0) return null;
  const from = holding.acquiredRound + board.rules.war.lockRounds;
  return board.round < from ? from : null;
}

/** The truce between two players, if one is in force. */
export function truceBetween(board: WarBoard, a: UserId, b: UserId): Truce | undefined {
  return board.truces.find((t) => board.round < t.endsRound && t.players.includes(a) && t.players.includes(b));
}

/**
 * Countries a player could put into a stake now: theirs, not tied up in a war (other than
 * `exceptWarId`, whose own stake is being reworked) and not newly won.
 */
export function stakeableCountries(board: WarBoard, userId: UserId, exceptWarId?: string): Set<TerritoryId> {
  const locks = warLocks(board.wars);
  const out = new Set<TerritoryId>();
  for (const [id, holding] of board.holdings) {
    if (holding.ownerId !== userId) continue;
    const lock = locks.get(id);
    if (lock !== undefined && lock !== exceptWarId) continue;
    if (stakeableFromRound(board, holding) !== null) continue;
    out.add(id);
  }
  return out;
}

export type TargetRejection =
  | 'unknown-territory'
  | 'unclaimed'
  | 'own-country'
  | 'in-war'
  | 'truce'
  | 'accord'
  | 'renounced'
  | 'not-bordering'
  | 'no-launcher'
  | 'stake-too-small';

export const TARGET_REJECTION_MESSAGES: Record<TargetRejection, string> = {
  'unknown-territory': 'That country is not on this map.',
  unclaimed: 'Nobody holds that country.',
  'own-country': 'That country is already yours.',
  'in-war': 'That country is already caught up in a war.',
  truce: 'You have a truce with its owner.',
  accord: 'You have an accord with its owner.',
  renounced: 'You renounced your accord with its owner, so you must wait for the next round to attack them.',
  'not-bordering': 'It must border one of your countries, by land or sea lane.',
  'no-launcher': 'None of your countries bordering it can launch an attack: they are in other wars or newly won.',
  'stake-too-small': 'The countries bordering it cannot raise a big enough stake.',
};

/** Why `attackerId` can't declare war on `targetId`, or null if they can (tokens aside). */
export function checkTarget(board: WarBoard, attackerId: UserId, targetId: TerritoryId): TargetRejection | null {
  return targetCheck(board, attackerId, targetId, warLocks(board.wars), stakeableCountries(board, attackerId));
}

function targetCheck(
  board: WarBoard,
  attackerId: UserId,
  targetId: TerritoryId,
  locks: ReadonlyMap<TerritoryId, string>,
  stakeable: ReadonlySet<TerritoryId>,
): TargetRejection | null {
  const target = board.idx.byId.get(targetId);
  if (!target) return 'unknown-territory';
  const holding = board.holdings.get(targetId);
  if (!holding) return 'unclaimed';
  if (holding.ownerId === attackerId) return 'own-country';
  if (locks.has(targetId)) return 'in-war';
  if (truceBetween(board, attackerId, holding.ownerId)) return 'truce';
  if (accordBetween(board, attackerId, holding.ownerId)) return 'accord';
  if (renunciationAgainst(board, attackerId, holding.ownerId)) return 'renounced';
  const bordering = board.idx.neighbors(targetId).filter((id) => board.holdings.get(id)?.ownerId === attackerId);
  if (bordering.length === 0) return 'not-bordering';
  const launchable = bordering.filter((id) => stakeable.has(id));
  if (launchable.length === 0) return 'no-launcher';
  const floor = declarationFloor(board, targetId);
  if (!launchable.some((id) => valueOf(board.idx, reachableWithin(board.idx, id, stakeable)) >= floor)) {
    return 'stake-too-small';
  }
  return null;
}

/** Every country `attackerId` can declare war on right now (tokens aside). */
export function attackableTargets(board: WarBoard, attackerId: UserId): Set<TerritoryId> {
  const locks = warLocks(board.wars);
  const stakeable = stakeableCountries(board, attackerId);
  const out = new Set<TerritoryId>();
  for (const [id, holding] of board.holdings) {
    if (holding.ownerId !== attackerId) continue;
    for (const n of board.idx.neighbors(id)) {
      if (out.has(n)) continue;
      const owner = board.holdings.get(n)?.ownerId;
      if (owner === undefined || owner === attackerId) continue;
      if (targetCheck(board, attackerId, n, locks, stakeable) === null) out.add(n);
    }
  }
  return out;
}

/**
 * The attacker's countries bordering `targetId` that can launch an attack on it: ones a stake
 * worth `minValue` (by default what a declaration needs) can be built from.
 */
export function launchersFor(
  board: WarBoard,
  attackerId: UserId,
  targetId: TerritoryId,
  opts: { minValue?: number; exceptWarId?: string } = {},
): TerritoryId[] {
  const minValue = opts.minValue ?? declarationFloor(board, targetId);
  const stakeable = stakeableCountries(board, attackerId, opts.exceptWarId);
  return board.idx
    .neighbors(targetId)
    .filter((id) => stakeable.has(id) && valueOf(board.idx, reachableWithin(board.idx, id, stakeable)) >= minValue)
    .sort();
}

export type StakeRejection =
  | 'empty'
  | 'duplicate'
  | 'unknown-territory'
  | 'not-yours'
  | 'in-war'
  | 'newly-won'
  | 'launcher-missing'
  | 'launcher-not-bordering'
  | 'not-connected'
  | 'too-small';

export const STAKE_REJECTION_MESSAGES: Record<StakeRejection, string> = {
  empty: 'Choose the countries to stake.',
  duplicate: 'A country is listed twice in the stake.',
  'unknown-territory': 'The stake includes a country that is not on this map.',
  'not-yours': 'You can only stake your own countries.',
  'in-war': 'The stake includes a country already caught up in a war.',
  'newly-won': 'The stake includes a newly won country that cannot be staked yet.',
  'launcher-missing': 'The stake must include the country you attack from.',
  'launcher-not-bordering': 'You must attack from a country bordering the target.',
  'not-connected': 'Staked countries must be connected to the country you attack from.',
  'too-small': 'The stake is worth too little.',
};

/**
 * Why a stake is invalid, or null if it's fine. A stake is the launching country plus
 * connected countries of the attacker's, worth at least `minValue` (by default what a
 * declaration needs: the stake floor, or more against a fortified country).
 */
export function checkStake(
  board: WarBoard,
  attackerId: UserId,
  targetId: TerritoryId,
  launchId: TerritoryId,
  stake: readonly TerritoryId[],
  opts: { minValue?: number; exceptWarId?: string } = {},
): StakeRejection | null {
  if (stake.length === 0) return 'empty';
  const set = new Set(stake);
  if (set.size !== stake.length) return 'duplicate';
  const locks = warLocks(board.wars);
  for (const id of stake) {
    if (!board.idx.byId.has(id)) return 'unknown-territory';
    const holding = board.holdings.get(id);
    if (holding?.ownerId !== attackerId) return 'not-yours';
    const lock = locks.get(id);
    if (lock !== undefined && lock !== opts.exceptWarId) return 'in-war';
    if (stakeableFromRound(board, holding) !== null) return 'newly-won';
  }
  if (!set.has(launchId)) return 'launcher-missing';
  if (!board.idx.neighbors(targetId).includes(launchId)) return 'launcher-not-bordering';
  if (reachableWithin(board.idx, launchId, set).size !== set.size) return 'not-connected';
  const minValue = opts.minValue ?? declarationFloor(board, targetId);
  if (valueOf(board.idx, stake) < minValue) return 'too-small';
  return null;
}

export interface StakePlan {
  launchId: TerritoryId;
  /** The launching country first, then the rest in id order. */
  stake: TerritoryId[];
  value: number;
}

/**
 * The cheapest valid stake: from `launchId` if given, otherwise from whichever bordering country
 * needs the least. Cheapest means the lowest total value, then the fewest countries. Null when
 * no stake reaches `minValue` (by default what a declaration needs).
 */
export function suggestStake(
  board: WarBoard,
  attackerId: UserId,
  targetId: TerritoryId,
  opts: { launchId?: TerritoryId; minValue?: number; exceptWarId?: string } = {},
): StakePlan | null {
  const minValue = opts.minValue ?? declarationFloor(board, targetId);
  const stakeable = stakeableCountries(board, attackerId, opts.exceptWarId);
  const candidates = opts.launchId
    ? [opts.launchId]
    : board.idx
        .neighbors(targetId)
        .filter((id) => stakeable.has(id))
        .sort();
  let best: StakePlan | null = null;
  for (const launchId of candidates) {
    if (!stakeable.has(launchId) || !board.idx.neighbors(targetId).includes(launchId)) continue;
    const plan = cheapestStake(board.idx, launchId, stakeable, minValue);
    if (
      plan &&
      (!best || plan.value < best.value || (plan.value === best.value && plan.stake.length < best.stake.length))
    ) {
      best = plan;
    }
  }
  return best;
}

/** How many partial stakes the search looks at before settling for a greedy answer. */
const SEARCH_LIMIT = 5000;

/** Best-first search over connected sets containing `launchId`, cheapest first. */
function cheapestStake(
  idx: DatasetIndex,
  launchId: TerritoryId,
  allowed: ReadonlySet<TerritoryId>,
  minValue: number,
): StakePlan | null {
  const component = reachableWithin(idx, launchId, allowed);
  if (valueOf(idx, component) < minValue) return null;
  const value = (id: TerritoryId) => idx.byId.get(id)?.value ?? 0;
  const plan = (ids: readonly TerritoryId[], total: number): StakePlan => ({
    launchId,
    stake: [launchId, ...ids.filter((id) => id !== launchId).sort()],
    value: total,
  });

  interface Node {
    ids: TerritoryId[];
    value: number;
    key: string;
  }
  const before = (a: Node, b: Node) =>
    a.value !== b.value
      ? a.value < b.value
      : a.ids.length !== b.ids.length
        ? a.ids.length < b.ids.length
        : a.key < b.key;
  const heap = new Heap<Node>(before);
  const seen = new Set<string>();
  heap.push({ ids: [launchId], value: value(launchId), key: launchId });
  for (let expanded = 0; heap.size > 0 && expanded < SEARCH_LIMIT; expanded++) {
    const node = heap.pop()!;
    if (node.value >= minValue) return plan(node.ids, node.value);
    const inSet = new Set(node.ids);
    for (const id of node.ids) {
      for (const n of idx.neighbors(id)) {
        if (!component.has(n) || inSet.has(n)) continue;
        const ids = [...node.ids, n].sort();
        const key = ids.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        heap.push({ ids, value: node.value + value(n), key });
      }
    }
  }

  // Too many small countries to search exhaustively: grow greedily, biggest neighbor first.
  const ids = [launchId];
  let total = value(launchId);
  while (total < minValue) {
    const inSet = new Set(ids);
    let next: TerritoryId | null = null;
    for (const id of ids) {
      for (const n of idx.neighbors(id)) {
        if (component.has(n) && !inSet.has(n) && (next === null || value(n) > value(next))) next = n;
      }
    }
    if (next === null) return null;
    ids.push(next);
    total += value(next);
  }
  return plan(ids, total);
}

/** A small binary heap; `before(a, b)` is true when `a` comes out first. */
class Heap<T> {
  private readonly items: T[] = [];
  private readonly before: (a: T, b: T) => boolean;

  constructor(before: (a: T, b: T) => boolean) {
    this.before = before;
  }

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last !== undefined) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.before(items[l]!, items[m]!)) m = l;
        if (r < items.length && this.before(items[r]!, items[m]!)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m]!, items[i]!];
        i = m;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------------------------------------
// Reserves

/** Whether an attacker may set countries aside to meet a raise: when a raise asks for a bigger stake. */
export const reservesAllowed = (rules: CampaignRules) => rules.war.raise === 'matched' || rules.war.raise === 'token';

export type ReserveRejection =
  'no-raise' | 'duplicate' | 'unknown-territory' | 'not-yours' | 'in-stake' | 'in-war' | 'newly-won' | 'not-connected';

export const RESERVE_REJECTION_MESSAGES: Record<ReserveRejection, string> = {
  'no-raise': 'Reserves only meet a raise, and this campaign has none that asks for more stake.',
  duplicate: 'A country is listed twice in the reserves.',
  'unknown-territory': 'The reserves include a country that is not on this map.',
  'not-yours': 'You can only hold your own countries in reserve.',
  'in-stake': 'A country in the stake cannot also be in reserve.',
  'in-war': 'The reserves include a country already caught up in a war.',
  'newly-won': 'The reserves include a newly won country that cannot be staked yet.',
  'not-connected': 'Reserves must connect to the stake.',
};

/**
 * Why countries can't be held in reserve for this stake, or null if they can: the attacker's own,
 * free to stake, outside the stake, and joined to it (directly or through each other).
 */
export function checkReserves(
  board: WarBoard,
  attackerId: UserId,
  launchId: TerritoryId,
  stake: readonly TerritoryId[],
  reserves: readonly TerritoryId[],
  opts: { exceptWarId?: string } = {},
): ReserveRejection | null {
  if (reserves.length === 0) return null;
  if (!reservesAllowed(board.rules)) return 'no-raise';
  if (new Set(reserves).size !== reserves.length) return 'duplicate';
  const inStake = new Set(stake);
  const locks = warLocks(board.wars);
  for (const id of reserves) {
    if (!board.idx.byId.has(id)) return 'unknown-territory';
    const holding = board.holdings.get(id);
    if (holding?.ownerId !== attackerId) return 'not-yours';
    if (inStake.has(id)) return 'in-stake';
    const lock = locks.get(id);
    if (lock !== undefined && lock !== opts.exceptWarId) return 'in-war';
    if (stakeableFromRound(board, holding) !== null) return 'newly-won';
  }
  const all = new Set([...stake, ...reserves]);
  return reachableWithin(board.idx, launchId, all).size === all.size ? null : 'not-connected';
}

/**
 * The stake that meets a raise from the attacker's reserves: the stake as it is plus the reserves
 * worth least (then the fewest) that bring it to `minValue` in one piece. Null when they can't.
 */
export function stakeFromReserves(
  idx: DatasetIndex,
  stake: readonly TerritoryId[],
  reserves: readonly TerritoryId[],
  minValue: number,
): TerritoryId[] | null {
  const base = valueOf(idx, stake);
  if (base >= minValue) return [...stake];
  if (base + valueOf(idx, reserves) < minValue) return null;
  const pool = new Set(reserves);
  const value = (id: TerritoryId) => idx.byId.get(id)?.value ?? 0;
  interface Node {
    ids: TerritoryId[];
    value: number;
    key: string;
  }
  const before = (a: Node, b: Node) =>
    a.value !== b.value
      ? a.value < b.value
      : a.ids.length !== b.ids.length
        ? a.ids.length < b.ids.length
        : a.key < b.key;
  const heap = new Heap<Node>(before);
  const seen = new Set<string>();
  heap.push({ ids: [], value: base, key: '' });
  for (let expanded = 0; heap.size > 0 && expanded < SEARCH_LIMIT; expanded++) {
    const node = heap.pop()!;
    if (node.value >= minValue) return [...stake, ...node.ids];
    const inSet = new Set([...stake, ...node.ids]);
    for (const id of inSet) {
      for (const n of idx.neighbors(id)) {
        if (!pool.has(n) || inSet.has(n)) continue;
        const ids = [...node.ids, n].sort();
        const key = ids.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        heap.push({ ids, value: node.value + value(n), key });
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Defender responses

/**
 * War tokens a counter-offer costs the defender: a raise in the `token` style, a redirect when
 * redirects cost one. The attacker gets them if they fight on.
 */
export function counterCost(rules: CampaignRules, kind: 'raise' | 'redirect'): number {
  if (kind === 'raise') return rules.war.raise === 'token' ? 1 : 0;
  return rules.war.redirectToken ? 1 : 0;
}

/** The most the attacker could stake from this war's launching country: its stake, reserves and what else is free. */
function stakeReach(board: WarBoard, war: ActiveWar): number {
  const launchId = war.stake[0]!;
  return valueOf(board.idx, reachableWithin(board.idx, launchId, stakeableCountries(board, war.attackerId, war.id)));
}

/**
 * The least a country put in by a matched raise may be worth, as a percentage of the target's
 * value (rounded up). The attacker matches with whole countries and often has to add more than
 * the country is worth, so a small one would make raising a cheap win again.
 */
export const MATCHED_RAISE_MIN_PCT = 50;

/** The values a country put in by a matched raise may have against this target: at least half, at most all of it. */
export function matchedRaiseRange(targetValue: number): { min: number; max: number } {
  return { min: percentUp(targetValue, MATCHED_RAISE_MIN_PCT), max: targetValue };
}

/**
 * Countries the defender could put into the war with a matched raise: theirs, free to stake, worth
 * between half the target and all of it, and no more than the attacker could still add from the
 * launching country (so a raise can't force a withdrawal the attacker had no way to avoid).
 */
export function raiseOptions(board: WarBoard, war: ActiveWar): TerritoryId[] {
  if (board.rules.war.raise !== 'matched') return [];
  const range = matchedRaiseRange(getTerritory(board.idx, war.targetId).value);
  const cap = Math.min(range.max, stakeReach(board, war) - valueOf(board.idx, war.stake));
  const out: TerritoryId[] = [];
  for (const id of stakeableCountries(board, war.defenderId)) {
    const value = board.idx.byId.get(id)?.value ?? Infinity;
    if (id !== war.targetId && value >= range.min && value <= cap) out.push(id);
  }
  return out.sort();
}

/**
 * Whether the defender may raise (tokens aside): with a matched raise, while some country can be
 * put in; with a raise to a percentage, while the stake is worth less than it demands.
 */
export function canRaise(board: WarBoard, war: ActiveWar): boolean {
  switch (board.rules.war.raise) {
    case 'off':
      return false;
    case 'matched':
      return raiseOptions(board, war).length > 0;
    case 'token':
    case 'free':
      return valueOf(board.idx, war.stake) < raiseFloor(board.rules, getTerritory(board.idx, war.targetId).value);
  }
}

/**
 * What a raise asks the attacker's stake to reach: the stake plus the added country with a matched
 * raise, otherwise the target's raise floor.
 */
export function raiseDemand(
  board: Pick<WarBoard, 'idx' | 'rules'>,
  war: Pick<ActiveWar, 'targetId' | 'stake'>,
  added?: TerritoryId | null,
): number {
  if (board.rules.war.raise === 'matched') {
    return valueOf(board.idx, war.stake) + (added ? getTerritory(board.idx, added).value : 0);
  }
  return raiseFloor(board.rules, getTerritory(board.idx, war.targetId).value);
}

/**
 * Countries the defender may offer instead of the target: theirs, worth the same, bordering the
 * attacker's empire, and not caught up in a war; with nearby redirects, bordering the target too.
 */
export function redirectOptions(board: WarBoard, war: ActiveWar): TerritoryId[] {
  const value = getTerritory(board.idx, war.targetId).value;
  const locks = warLocks(board.wars);
  const nearby = board.rules.war.redirect === 'nearby' ? new Set(board.idx.neighbors(war.targetId)) : null;
  const attackers = new Set<TerritoryId>();
  for (const [id, h] of board.holdings) if (h.ownerId === war.attackerId) attackers.add(id);
  const out: TerritoryId[] = [];
  for (const [id, h] of board.holdings) {
    if (h.ownerId !== war.defenderId || id === war.targetId || locks.has(id)) continue;
    if (nearby && !nearby.has(id)) continue;
    if (board.idx.byId.get(id)?.value === value && bordersAny(board.idx, id, attackers)) out.push(id);
  }
  return out.sort();
}

/**
 * The country whose terrain and supply lines set a war's clock: the target, or the original one
 * after a redirect when redirects are nearby (so a redirect can't go looking for better ground).
 */
export function clockTarget(
  rules: CampaignRules,
  war: { targetId: TerritoryId; redirectedFrom: TerritoryId | null },
): TerritoryId {
  return rules.war.redirect === 'nearby' && war.redirectedFrom ? war.redirectedFrom : war.targetId;
}

/** The defender's countries worth less than the target and not caught up in a war: what tribute can be. */
export function tributeCountries(board: WarBoard, war: ActiveWar): TerritoryId[] {
  const value = getTerritory(board.idx, war.targetId).value;
  const locks = warLocks(board.wars);
  const out: TerritoryId[] = [];
  for (const [id, h] of board.holdings) {
    if (h.ownerId !== war.defenderId || locks.has(id)) continue;
    if ((board.idx.byId.get(id)?.value ?? Infinity) < value) out.push(id);
  }
  return out.sort();
}

/**
 * Countries the defender may offer as tribute: theirs, worth less than the target, not caught up
 * in a war. None when peace terms replace tribute.
 */
export function tributeOptions(board: WarBoard, war: ActiveWar): TerritoryId[] {
  return board.rules.war.peaceTerms ? [] : tributeCountries(board, war);
}

/** Whether the attacker can still call off a declaration: before the defender has answered. */
export const canRecall = (rules: CampaignRules, status: string) => rules.war.recall && status === 'declared';

// ---------------------------------------------------------------------------------------------
// The game

/** The attacker plays White; in an Armageddon tiebreak the colors swap. */
export const attackerColor = (armageddon: boolean): Color => (armageddon ? 'black' : 'white');

export const HOME_TURF_PCT = 10;
export const TERRAIN_PCT = 10;
export const SUPPLY_LINE_PCT = 5;
export const MODIFIER_CAP_PCT = 25;
/** In Armageddon, Black gets this share of White's time and wins a draw. */
export const ARMAGEDDON_BLACK_TIME = 0.8;

export interface ClockModifier {
  label: string;
  side: 'attacker' | 'defender';
  pct: number;
}

export interface ClockModifiers {
  parts: ClockModifier[];
  /** Extra time in percent after the cap: positive favors the defender, negative the attacker. */
  net: number;
}

/**
 * Extra clock time for a war on `targetId`: the defender's home turf and terrain against the
 * attacker's supply lines (each of their countries bordering the target), capped.
 */
export function clockModifiers(board: WarBoard, attackerId: UserId, targetId: TerritoryId): ClockModifiers {
  if (!board.rules.war.clockModifiers) return { parts: [], net: 0 };
  const target = getTerritory(board.idx, targetId);
  const parts: ClockModifier[] = [{ label: 'Home turf', side: 'defender', pct: HOME_TURF_PCT }];
  if (target.terrain.includes('mountains')) parts.push({ label: 'Mountains', side: 'defender', pct: TERRAIN_PCT });
  else if (target.terrain.includes('island')) parts.push({ label: 'Island', side: 'defender', pct: TERRAIN_PCT });
  const supply = board.idx.neighbors(targetId).filter((id) => board.holdings.get(id)?.ownerId === attackerId).length;
  if (supply > 0) {
    const label = supply === 1 ? 'Supply line' : `Supply lines (${supply})`;
    parts.push({ label, side: 'attacker', pct: SUPPLY_LINE_PCT * supply });
  }
  const raw = parts.reduce((sum, p) => sum + (p.side === 'defender' ? p.pct : -p.pct), 0);
  return { parts, net: Math.max(-MODIFIER_CAP_PCT, Math.min(MODIFIER_CAP_PCT, raw)) };
}

/** Each side's clock in a war game: the campaign's time control with the modifiers applied. */
export function warTimeControl(rules: CampaignRules, modifiers: ClockModifiers, armageddon = false): TimeControl {
  const attacker = attackerColor(armageddon);
  const factor = (color: Color) => {
    const side = color === attacker ? 'attacker' : 'defender';
    const favored = modifiers.net > 0 ? 'defender' : modifiers.net < 0 ? 'attacker' : null;
    const bonus = side === favored ? 1 + Math.abs(modifiers.net) / 100 : 1;
    return bonus * (armageddon && color === 'black' ? ARMAGEDDON_BLACK_TIME : 1);
  };
  if (rules.war.pace === 'live') {
    const [minutes, increment] = rules.war.liveClock.split('+').map(Number) as [number, number];
    const spec = (color: Color): LiveClockSpec => ({
      initialMs: Math.round(minutes * 60_000 * factor(color)),
      incrementMs: Math.round(increment * 1000 * factor(color)),
    });
    return { kind: 'live', white: spec('white'), black: spec('black') };
  }
  const perMove = rules.war.hoursPerMove * 3_600_000;
  return {
    kind: 'correspondence',
    white: { perMoveMs: Math.round(perMove * factor('white')) },
    black: { perMoveMs: Math.round(perMove * factor('black')) },
  };
}

// ---------------------------------------------------------------------------------------------
// Resolution

/**
 * - `attacker`: the attacker won and takes the target (and a country a matched raise added).
 * - `defender`: the defender won and takes the stake.
 * - `held`: a draw; nothing changes hands.
 * - `tribute`: the attacker accepted the defender's tribute instead of fighting.
 * - `settled`: the two agreed peace terms; the terms changed hands, and it counts as neither a win
 *   nor a loss.
 * - `withdrawn`: the attacker backed down (called the declaration off, or refused a counter, or
 *   ran out of time to answer one).
 * - `cancelled`: the campaign ended before the war was settled; nothing changed hands, and it
 *   counts as neither a win nor a loss.
 */
export type WarOutcome = 'attacker' | 'defender' | 'held' | 'tribute' | 'settled' | 'withdrawn' | 'cancelled';

/** What a finished game means for its war, including whether a drawn first game goes to Armageddon. */
export function afterGame(
  rules: CampaignRules,
  armageddon: boolean,
  winner: Color | null,
): 'attacker' | 'defender' | 'held' | 'armageddon' {
  const attacker = attackerColor(armageddon);
  if (winner === null) {
    if (armageddon) return attacker === 'black' ? 'attacker' : 'defender';
    return rules.war.draws === 'armageddon' ? 'armageddon' : 'held';
  }
  return winner === attacker ? 'attacker' : 'defender';
}

export interface Transfer {
  territoryId: TerritoryId;
  from: UserId;
  to: UserId;
}

/**
 * The countries that change hands when a fought war ends: the target (and a country a met matched
 * raise put in, from `added` or the war's counter) to a winning attacker, the stake to a winning
 * defender.
 */
export function warTransfers(
  war: Pick<ActiveWar, 'attackerId' | 'defenderId' | 'targetId' | 'stake'> & {
    added?: TerritoryId | null;
    counter?: WarCounter | null;
  },
  outcome: WarOutcome,
): Transfer[] {
  if (outcome === 'attacker') {
    const added = war.added ?? addedCountry(war.counter ?? null);
    return [war.targetId, ...(added ? [added] : [])].map((id) => ({
      territoryId: id,
      from: war.defenderId,
      to: war.attackerId,
    }));
  }
  if (outcome === 'defender')
    return war.stake.map((id) => ({ territoryId: id, from: war.attackerId, to: war.defenderId }));
  return [];
}

// ---------------------------------------------------------------------------------------------
// Peace terms

/**
 * Terms to end a war without finishing it, which either player may offer until its game is over.
 * The attacker can hand over staked countries; the defender the target (and a country a raise put
 * in), or instead one country worth less than the target, like tribute. Tokens can go either way,
 * and an accord can come with the peace. Nothing at all is a white peace.
 */
export interface PeaceTerms {
  /** Countries the defender hands to the attacker. */
  toAttacker: TerritoryId[];
  /** Staked countries the attacker hands to the defender. */
  toDefender: TerritoryId[];
  /** War tokens the defender pays the attacker. */
  tokensToAttacker: number;
  /** War tokens the attacker pays the defender. */
  tokensToDefender: number;
  /** An accord signed with the peace, for this many rounds; null for none. */
  accordRounds: number | null;
}

/** The most tokens peace terms can move. */
export const PEACE_MAX_TOKENS = 10;

export const WHITE_PEACE: PeaceTerms = {
  toAttacker: [],
  toDefender: [],
  tokensToAttacker: 0,
  tokensToDefender: 0,
  accordRounds: null,
};

/** Terms that hand nothing over (an accord may still come with them). */
export const isWhitePeace = (terms: PeaceTerms) =>
  terms.toAttacker.length === 0 &&
  terms.toDefender.length === 0 &&
  terms.tokensToAttacker === 0 &&
  terms.tokensToDefender === 0;

export type PeaceRejection =
  | 'off'
  | 'duplicate'
  | 'bad-country'
  | 'bad-tribute'
  | 'tokens-both-ways'
  | 'bad-tokens'
  | 'short-of-tokens'
  | 'bad-accord';

export const PEACE_REJECTION_MESSAGES: Record<PeaceRejection, string> = {
  off: "Peace terms are not part of this campaign's rules.",
  duplicate: 'A country is listed twice in the terms.',
  'bad-country':
    'The attacker can hand over staked countries, and the defender the target, a country a raise added, or one country worth less than the target.',
  'bad-tribute':
    'A country worth less than the target goes on its own, instead of the target: not alongside other countries.',
  'tokens-both-ways': 'Tokens can go one way only.',
  'bad-tokens': `Terms can move between 0 and ${PEACE_MAX_TOKENS} war tokens.`,
  'short-of-tokens': 'Whoever pays the tokens must have them.',
  'bad-accord': `An accord lasts ${ACCORD_MIN_ROUNDS} to ${ACCORD_MAX_ROUNDS} rounds.`,
};

/** What each side may hand over in peace terms for this war. */
export function peaceCountries(
  board: WarBoard,
  war: ActiveWar,
): { fromAttacker: TerritoryId[]; fromDefender: TerritoryId[]; tribute: TerritoryId[] } {
  const holds = (id: TerritoryId, ownerId: UserId) => board.holdings.get(id)?.ownerId === ownerId;
  const fromDefender = [war.targetId, ...(war.added ? [war.added] : [])].filter((id) => holds(id, war.defenderId));
  return {
    fromAttacker: war.stake.filter((id) => holds(id, war.attackerId)),
    fromDefender,
    tribute: tributeCountries(board, war).filter((id) => !fromDefender.includes(id)),
  };
}

/**
 * Why these terms can't end this war now, or null if they can. `tokens` are what each side holds:
 * whoever pays must have them.
 */
export function peaceIssue(
  board: WarBoard,
  war: ActiveWar,
  terms: PeaceTerms,
  tokens: { attacker: number; defender: number },
): PeaceRejection | null {
  if (!board.rules.war.peaceTerms) return 'off';
  const all = [...terms.toAttacker, ...terms.toDefender];
  if (new Set(all).size !== all.length) return 'duplicate';
  const allowed = peaceCountries(board, war);
  if (!terms.toDefender.every((id) => allowed.fromAttacker.includes(id))) return 'bad-country';
  const tribute = terms.toAttacker.filter((id) => !allowed.fromDefender.includes(id));
  if (tribute.some((id) => !allowed.tribute.includes(id))) return 'bad-country';
  if (tribute.length > 0 && terms.toAttacker.length > 1) return 'bad-tribute';
  for (const n of [terms.tokensToAttacker, terms.tokensToDefender]) {
    if (!Number.isInteger(n) || n < 0 || n > PEACE_MAX_TOKENS) return 'bad-tokens';
  }
  if (terms.tokensToAttacker > 0 && terms.tokensToDefender > 0) return 'tokens-both-ways';
  if (terms.tokensToAttacker > tokens.defender || terms.tokensToDefender > tokens.attacker) return 'short-of-tokens';
  const rounds = terms.accordRounds;
  if (rounds !== null && (!Number.isInteger(rounds) || rounds < ACCORD_MIN_ROUNDS || rounds > ACCORD_MAX_ROUNDS)) {
    return 'bad-accord';
  }
  return null;
}

/** "A", "A and B", "A, B and C". */
const listOf = (items: readonly string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * Peace terms in words, with the players and countries named by the caller (a player may be
 * "you"): "Libya goes to Ann; 2 war tokens go to Bo; with an accord for 3 rounds", or "A white
 * peace: nothing changes hands".
 */
export function peaceTermsText(
  terms: PeaceTerms,
  names: { attacker: string; defender: string; country(id: TerritoryId): string },
): string {
  const parts: string[] = [];
  const countries = (ids: readonly TerritoryId[], to: string) =>
    `${listOf(ids.map(names.country))} ${ids.length === 1 ? 'goes' : 'go'} to ${to}`;
  const tokens = (n: number, to: string) => `${n} war ${n === 1 ? 'token goes' : 'tokens go'} to ${to}`;
  if (terms.toAttacker.length > 0) parts.push(countries(terms.toAttacker, names.attacker));
  if (terms.toDefender.length > 0) parts.push(countries(terms.toDefender, names.defender));
  if (terms.tokensToAttacker > 0) parts.push(tokens(terms.tokensToAttacker, names.attacker));
  if (terms.tokensToDefender > 0) parts.push(tokens(terms.tokensToDefender, names.defender));
  const rounds = terms.accordRounds;
  const accord = rounds ? `an accord for ${rounds} ${rounds === 1 ? 'round' : 'rounds'}` : null;
  if (parts.length === 0) return accord ? `A white peace, with ${accord}` : 'A white peace: nothing changes hands';
  return accord ? `${parts.join('; ')}; with ${accord}` : parts.join('; ');
}

/** The countries peace terms hand over. */
export function peaceTransfers(war: Pick<ActiveWar, 'attackerId' | 'defenderId'>, terms: PeaceTerms): Transfer[] {
  return [
    ...terms.toAttacker.map((id) => ({ territoryId: id, from: war.defenderId, to: war.attackerId })),
    ...terms.toDefender.map((id) => ({ territoryId: id, from: war.attackerId, to: war.defenderId })),
  ];
}

/** A player's tokens when a new round starts: the allowance is added up to the cap; tokens above it are kept. */
export function refillTokens(rules: CampaignRules, tokens: number): number {
  return Math.max(tokens, Math.min(rules.war.tokenCap, tokens + rules.war.tokensPerRound));
}

export interface ResolvedWar {
  attackerId: UserId;
  defenderId: UserId;
  outcome: WarOutcome;
  resolvedRound: number;
}

/**
 * The truces in force in `round`: one per pair whose war was fought out, or ended by tribute or
 * peace terms, recently.
 */
export function activeTruces(rules: CampaignRules, round: number, resolved: readonly ResolvedWar[]): Truce[] {
  const byPair = new Map<string, Truce>();
  for (const war of resolved) {
    if (war.outcome === 'withdrawn' || war.outcome === 'cancelled') continue;
    const endsRound = war.resolvedRound + rules.war.truceRounds;
    if (round >= endsRound) continue;
    const players = [war.attackerId, war.defenderId].sort() as [UserId, UserId];
    const key = players.join('\n');
    const previous = byPair.get(key);
    if (!previous || previous.endsRound < endsRound) byPair.set(key, { players, endsRound });
  }
  return [...byPair.values()];
}
