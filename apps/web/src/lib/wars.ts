import {
  peaceTermsText,
  winnerOf,
  type GameEndReason,
  type GameResult,
  type GameSummary,
  type PeaceTerms,
  type PlayerResult,
  type TimeControl,
  type WarView,
} from '@empire/rules';
import type { CampaignModel } from './campaign';

export const countryName = (model: CampaignModel, id: string) => model.idx.byId.get(id)?.name ?? id;
export const playerName = (model: CampaignModel, userId: string) =>
  model.membersById.get(userId)?.name ?? 'A former player';

const REASONS: Record<GameEndReason, string> = {
  checkmate: 'by checkmate',
  resignation: 'by resignation',
  timeout: 'on time',
  stalemate: 'by stalemate',
  'insufficient-material': 'by insufficient material',
  'threefold-repetition': 'by threefold repetition',
  'fifty-moves': 'by the fifty-move rule',
  agreement: 'by agreement',
  'timeout-vs-insufficient-material': 'on time against a lone king',
  'over-the-board': 'over the board',
};

/** How a game ended: "by checkmate", "on time". */
export const reasonText = (reason: GameEndReason) => REASONS[reason];

/** How a game ended, for one player: "Won by checkmate", "Drawn by agreement", "Lost on time". */
export function endingText(result: PlayerResult, reason: GameEndReason | null): string {
  const how = reason ? ` ${REASONS[reason]}` : '';
  return `${{ won: 'Won', drawn: 'Drawn', lost: 'Lost' }[result]}${how}`;
}

/** "White wins by checkmate", "Draw by agreement". */
export function resultText(result: GameResult, reason: GameEndReason | null): string {
  const winner = winnerOf(result);
  const how = reason ? ` ${REASONS[reason]}` : '';
  return winner ? `${winner === 'white' ? 'White' : 'Black'} wins${how}` : `Draw${how}`;
}

/**
 * Why the viewer must wait to declare war or fortify, in a line, where the campaign takes turns:
 * "Bo's turn to declare. You're next." Null when they needn't wait.
 */
export function turnWaitText(model: CampaignModel): string | null {
  const { turns, turnRejection } = model;
  if (!turns || !turnRejection) return null;
  if (turnRejection === 'turns-over') return 'Declaring is over for this round. The next round brings new turns.';
  if (turns.passed.has(model.me.userId)) return "You passed: you're done declaring for this round.";
  const who = turns.current ? `${turns.current.name}'s turn to declare.` : '';
  const wait = turns.before === 1 ? "You're next." : turns.before === null ? '' : `${turns.before} turns before yours.`;
  return `${who} ${wait}`.trim();
}

/** Where a war stands, in a line, and any peace terms waiting for the viewer's answer. */
export function warStatusText(model: CampaignModel, war: WarView): string {
  const offer = war.peace.find((o) => o.status === 'proposed' && o.recipientId === model.me.userId);
  const status = warStanding(model, war);
  return offer ? `${status}; ${playerName(model, offer.proposerId)} offers peace` : status;
}

function warStanding(model: CampaignModel, war: WarView): string {
  const me = model.me.userId;
  const attacker = playerName(model, war.attackerId);
  const defender = war.defenderId === me ? 'your' : `${playerName(model, war.defenderId)}'s`;
  switch (war.status) {
    case 'declared':
      return war.defenderId === me
        ? 'Waiting for your answer'
        : `Waiting for ${playerName(model, war.defenderId)} to answer`;
    case 'countered':
      return war.attackerId === me
        ? `Waiting for your answer to ${defender} ${war.counter?.kind ?? 'offer'}`
        : `Waiting for ${attacker} to answer ${defender} ${war.counter?.kind ?? 'offer'}`;
    case 'ready':
      // Live games wait for everyone to finish declaring, where the campaign takes turns.
      return model.campaign.rules.war.pace === 'live' && model.turns?.current
        ? 'Accepted. The game starts once declaring is over'
        : 'Accepted. The game starts when both players are free';
    case 'playing':
      return war.games.at(-1)?.armageddon ? 'Armageddon tiebreak underway' : 'The game is on';
    case 'resolved':
      return outcomeText(model, war);
  }
}

/** How a war ended, in a line. */
export function outcomeText(model: CampaignModel, war: WarView): string {
  const attacker = playerName(model, war.attackerId);
  const defender = playerName(model, war.defenderId);
  const target = countryName(model, war.targetId);
  switch (war.outcome) {
    case 'attacker':
      return `${attacker} took ${target}`;
    case 'defender':
      return `${defender} held ${target} and took the stake`;
    case 'held':
      return `${target} held: a draw`;
    case 'tribute':
      return `${defender} paid tribute`;
    case 'settled':
      return `${attacker} and ${defender} made peace`;
    case 'withdrawn':
      return `${attacker} called off the attack`;
    case 'cancelled':
      return 'Cancelled: the campaign ended first';
    case null:
      return '';
  }
}

/** The defender's counter-offer, described. */
export function counterText(model: CampaignModel, war: WarView): string {
  const mine = war.defenderId === model.me.userId;
  const defender = mine ? 'You' : playerName(model, war.defenderId);
  const s = mine ? '' : 's';
  const counter = war.counter;
  if (!counter) return '';
  const paid = counter.kind !== 'tribute' && counter.tokens ? ` (paying ${tokensText(counter.tokens)})` : '';
  switch (counter.kind) {
    case 'raise': {
      if (counter.added) {
        const t = model.idx.byId.get(counter.added);
        return (
          `${defender} put${s} ${t?.name ?? counter.added} (${t?.value ?? '?'}) into the war: the stake must reach ` +
          `${counter.minValue}, and winning takes it too.`
        );
      }
      return `${defender} demand${s} a stake worth at least ${counter.minValue}${paid}.`;
    }
    case 'redirect': {
      const t = model.idx.byId.get(counter.targetId);
      return `${defender} offer${s} ${t?.name ?? counter.targetId} (${t?.value ?? '?'}) as the target instead${paid}.`;
    }
    case 'tribute': {
      if (counter.territoryId) {
        const t = model.idx.byId.get(counter.territoryId);
        return `${defender} offer${s} ${t?.name ?? counter.territoryId} (${t?.value ?? '?'}) as tribute.`;
      }
      return `${defender} offer${s} ${counter.tokens} war ${counter.tokens === 1 ? 'token' : 'tokens'} as tribute.`;
    }
  }
}

/** "1 war token", "3 war tokens". */
export const tokensText = (n: number) => `${n} war ${n === 1 ? 'token' : 'tokens'}`;

/** Peace terms in words from the viewer's side: "Libya goes to you; 2 war tokens go to Bo". */
export function termsText(model: CampaignModel, war: Pick<WarView, 'attackerId' | 'defenderId'>, terms: PeaceTerms) {
  const name = (userId: string) => (userId === model.me.userId ? 'you' : playerName(model, userId));
  return peaceTermsText(terms, {
    attacker: name(war.attackerId),
    defender: name(war.defenderId),
    country: (id) => countryName(model, id),
  });
}

/**
 * The defender's country a matched raise put at stake alongside the target: once the attacker met
 * the raise, for as long as the war was fought over.
 */
export function stakedByRaise(war: WarView): string | null {
  if (war.counter?.kind !== 'raise' || !war.counter.added) return null;
  const fought = war.outcome === 'attacker' || war.outcome === 'defender' || war.outcome === 'held';
  return war.status === 'ready' || war.status === 'playing' || fought ? war.counter.added : null;
}

/** A countdown to a deadline: "23h 12m", "4m 10s", "12s". */
export function timeLeft(ms: number): string {
  if (ms <= 0) return 'no time';
  const s = Math.ceil(ms / 1000);
  // Days only past two of them: "36h 10m" reads better than "1d 12h" for a day's deadline.
  const d = s >= 2 * 86_400 ? Math.floor(s / 86_400) : 0;
  const h = Math.floor((s - d * 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** A chess clock: "4:59", then tenths under ten seconds ("9.4"). */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) return (Math.floor(clamped / 100) / 10).toFixed(1);
  const total = Math.floor(clamped / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "5+3", "1 day per move", "25.2 hours per move". */
export function timeControlText(tc: TimeControl, color: 'white' | 'black'): string {
  if (tc.kind === 'live') {
    const { initialMs, incrementMs } = tc[color];
    const minutes = Math.round((initialMs / 60_000) * 100) / 100;
    const increment = Math.round((incrementMs / 1000) * 100) / 100;
    return `${minutes}+${increment}`;
  }
  const hours = Math.round((tc[color].perMoveMs / 3_600_000) * 10) / 10;
  return hours === 24 ? '1 day per move' : `${hours} hours per move`;
}

/** The game a war is on now, or last played. */
export const currentGame = (war: WarView): GameSummary | undefined => war.games.at(-1);
