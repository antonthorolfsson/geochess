import {
  winnerOf,
  type GameEndReason,
  type GameResult,
  type GameSummary,
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
};

/** "White wins by checkmate", "Draw by agreement". */
export function resultText(result: GameResult, reason: GameEndReason | null): string {
  const winner = winnerOf(result);
  const how = reason ? ` ${REASONS[reason]}` : '';
  return winner ? `${winner === 'white' ? 'White' : 'Black'} wins${how}` : `Draw${how}`;
}

/** Where a war stands, in a line. */
export function warStatusText(model: CampaignModel, war: WarView): string {
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
      return 'Accepted. The game starts when both players are free';
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
    case 'withdrawn':
      return `${attacker} called off the attack`;
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
  switch (counter.kind) {
    case 'raise':
      return `${defender} demand${s} a stake worth at least ${counter.minValue}.`;
    case 'redirect': {
      const t = model.idx.byId.get(counter.targetId);
      return `${defender} offer${s} ${t?.name ?? counter.targetId} (${t?.value ?? '?'}) as the target instead.`;
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
