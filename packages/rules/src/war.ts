import type { Color, LiveClockSpec, TimeControl } from './chess';
import type { CampaignRules, Pace } from './config';
import type { TerritoryId } from './dataset';
import { accordBetween, renunciationAgainst, type Accord, type Renunciation } from './diplomacy';
import type { UserId } from './draft';
import { bordersAny, getTerritory, reachableWithin, type DatasetIndex } from './graph';

/** Who holds a country, and the round they got it in (0 for countries drafted at the start). */
export interface Holding {
  ownerId: UserId;
  acquiredRound: number;
}

/** An unresolved war, as far as the rules are concerned. */
export interface ActiveWar {
  id: string;
  attackerId: UserId;
  defenderId: UserId;
  targetId: TerritoryId;
  /** The launching country first, then the countries added to it. */
  stake: readonly TerritoryId[];
  /** A redirect target or tribute country the defender has offered, while the attacker decides. */
  offered: TerritoryId | null;
}

/**
 * The defender's counter-offer, which the attacker must answer:
 * - `raise`: stake at least `minValue`, or withdraw.
 * - `redirect`: fight for `targetId` instead, or withdraw.
 * - `tribute`: take `territoryId` or `tokens` instead of fighting, or refuse and fight.
 */
export type WarCounter =
  | { kind: 'raise'; minValue: number }
  | { kind: 'redirect'; targetId: TerritoryId }
  | { kind: 'tribute'; territoryId: TerritoryId | null; tokens: number };

/** The country a counter-offer ties up while the attacker decides. */
export function offeredCountry(counter: WarCounter | null): TerritoryId | null {
  if (counter?.kind === 'redirect') return counter.targetId;
  if (counter?.kind === 'tribute') return counter.territoryId;
  return null;
}

/** A stored war (a server row or a client view) as the rules see it. */
export function activeWar(war: {
  id: string;
  attackerId: UserId;
  defenderId: UserId;
  targetId: TerritoryId;
  stake: readonly TerritoryId[];
  status: string;
  counter: WarCounter | null;
}): ActiveWar {
  return {
    id: war.id,
    attackerId: war.attackerId,
    defenderId: war.defenderId,
    targetId: war.targetId,
    stake: war.stake,
    // An offered country is tied up only while the attacker decides.
    offered: war.status === 'countered' ? offeredCountry(war.counter) : null,
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

/** Countries tied up in unresolved wars (targets, stakes and pending offers), with the war holding each. */
export function warLocks(wars: readonly ActiveWar[]): Map<TerritoryId, string> {
  const locks = new Map<TerritoryId, string>();
  for (const war of wars) {
    locks.set(war.targetId, war.id);
    for (const id of war.stake) locks.set(id, war.id);
    if (war.offered) locks.set(war.offered, war.id);
  }
  return locks;
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
  const floor = stakeFloor(board.rules, target.value);
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
 * worth `minValue` (by default the stake floor) can be built from.
 */
export function launchersFor(
  board: WarBoard,
  attackerId: UserId,
  targetId: TerritoryId,
  opts: { minValue?: number; exceptWarId?: string } = {},
): TerritoryId[] {
  const target = getTerritory(board.idx, targetId);
  const minValue = opts.minValue ?? stakeFloor(board.rules, target.value);
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
 * connected countries of the attacker's, worth at least `minValue` (by default the stake floor).
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
  const minValue = opts.minValue ?? stakeFloor(board.rules, getTerritory(board.idx, targetId).value);
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
 * no stake reaches `minValue` (by default the stake floor).
 */
export function suggestStake(
  board: WarBoard,
  attackerId: UserId,
  targetId: TerritoryId,
  opts: { launchId?: TerritoryId; minValue?: number; exceptWarId?: string } = {},
): StakePlan | null {
  const target = getTerritory(board.idx, targetId);
  const minValue = opts.minValue ?? stakeFloor(board.rules, target.value);
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
// Defender responses

/** Whether the defender may raise: only while the stake is worth less than a raise demands. */
export function canRaise(board: WarBoard, war: ActiveWar): boolean {
  const target = getTerritory(board.idx, war.targetId);
  return valueOf(board.idx, war.stake) < raiseFloor(board.rules, target.value);
}

/**
 * Countries the defender may offer instead of the target: theirs, worth the same, bordering the
 * attacker's empire, and not caught up in a war.
 */
export function redirectOptions(board: WarBoard, war: ActiveWar): TerritoryId[] {
  const value = getTerritory(board.idx, war.targetId).value;
  const locks = warLocks(board.wars);
  const attackers = new Set<TerritoryId>();
  for (const [id, h] of board.holdings) if (h.ownerId === war.attackerId) attackers.add(id);
  const out: TerritoryId[] = [];
  for (const [id, h] of board.holdings) {
    if (h.ownerId !== war.defenderId || id === war.targetId || locks.has(id)) continue;
    if (board.idx.byId.get(id)?.value === value && bordersAny(board.idx, id, attackers)) out.push(id);
  }
  return out.sort();
}

/** Countries the defender may offer as tribute: theirs, worth less than the target, not caught up in a war. */
export function tributeOptions(board: WarBoard, war: ActiveWar): TerritoryId[] {
  const value = getTerritory(board.idx, war.targetId).value;
  const locks = warLocks(board.wars);
  const out: TerritoryId[] = [];
  for (const [id, h] of board.holdings) {
    if (h.ownerId !== war.defenderId || locks.has(id)) continue;
    if ((board.idx.byId.get(id)?.value ?? Infinity) < value) out.push(id);
  }
  return out.sort();
}

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
 * - `attacker`: the attacker won and takes the target.
 * - `defender`: the defender won and takes the stake.
 * - `held`: a draw; nothing changes hands.
 * - `tribute`: the attacker accepted the defender's tribute instead of fighting.
 * - `withdrawn`: the attacker backed down (or ran out of time to answer a counter).
 * - `cancelled`: the campaign ended before the war was settled; nothing changed hands, and it
 *   counts as neither a win nor a loss.
 */
export type WarOutcome = 'attacker' | 'defender' | 'held' | 'tribute' | 'withdrawn' | 'cancelled';

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

/** The countries that change hands when a fought war ends. */
export function warTransfers(
  war: Pick<ActiveWar, 'attackerId' | 'defenderId' | 'targetId' | 'stake'>,
  outcome: WarOutcome,
): Transfer[] {
  if (outcome === 'attacker') return [{ territoryId: war.targetId, from: war.defenderId, to: war.attackerId }];
  if (outcome === 'defender')
    return war.stake.map((id) => ({ territoryId: id, from: war.attackerId, to: war.defenderId }));
  return [];
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

/** The truces in force in `round`: one per pair whose war was fought out or settled by tribute recently. */
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
