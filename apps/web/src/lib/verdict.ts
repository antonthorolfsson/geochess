import {
  afterGame,
  warTransfers,
  winnerOf,
  type Color,
  type GameSummary,
  type PlayerResult,
  type TerritoryId,
  type WarView,
} from '@empire/rules';
import type { CampaignModel } from './campaign';
import { countryName, endingText, playerName, reasonText } from './wars';

/** A finished game, as its board announces it: who won, how, and what it means for the war. */
export interface Verdict {
  /** How it went for the viewer, one of the two players; null for anyone watching. */
  mine: PlayerResult | null;
  /** The winner, or null for a draw. */
  winnerId: string | null;
  /** The side they played. */
  winnerColor: Color | null;
  /** Stamped over the board for the two players. */
  stamp: 'Victory' | 'Defeat' | 'Draw' | null;
  /** For anyone watching: "Bo wins", "Draw". */
  headline: string;
  /** How it ended: "Won by checkmate", "Lost on time" for the players, "By resignation" for anyone else. */
  how: string;
  /** What it means for the war: "Libya is yours", "Bo takes Libya", "Libya holds". */
  spoils: string | null;
  /** The whole of it in a sentence, for screen readers. */
  summary: string;
}

const STAMPS = { won: 'Victory', lost: 'Defeat', drawn: 'Draw' } as const;

/** Who won a game: in an Armageddon tiebreak, Black wins a draw. Null for a draw, undefined before the end. */
export function gameWinner(game: Pick<GameSummary, 'result' | 'armageddon'>): Color | null | undefined {
  if (!game.result) return undefined;
  return winnerOf(game.result) ?? (game.armageddon ? 'black' : null);
}

/** A finished game's verdict, from the viewer's side; null for a game with no result. */
export function verdictOf(model: CampaignModel, game: GameSummary, war: WarView | undefined): Verdict | null {
  if (game.status !== 'finished' || !game.result) return null;
  const me = model.me.userId;
  const winnerColor = gameWinner(game) ?? null;
  const winnerId = winnerColor === 'white' ? game.whiteId : winnerColor === 'black' ? game.blackId : null;
  const mine: PlayerResult | null =
    me !== game.whiteId && me !== game.blackId ? null : winnerId === null ? 'drawn' : winnerId === me ? 'won' : 'lost';
  const headline = winnerId ? `${playerName(model, winnerId)} wins` : 'Draw';
  const reason = game.reason ? reasonText(game.reason) : '';
  const how =
    winnerOf(game.result) === null && winnerColor
      ? `${endingText('drawn', game.reason)}: a draw goes to Black`
      : mine
        ? endingText(mine, game.reason)
        : reason.charAt(0).toUpperCase() + reason.slice(1);
  const spoils = war ? spoilsOf(model, game, war, winnerOf(game.result)) : null;
  const stamp = mine ? STAMPS[mine] : null;
  const opening = stamp
    ? `${stamp}. ${how}`
    : winnerOf(game.result) === null && winnerColor
      ? `${headline}. ${how}`
      : [headline, reason].filter(Boolean).join(' ');
  return {
    mine,
    winnerId,
    winnerColor,
    stamp,
    headline,
    how,
    spoils,
    summary: `${opening}.${spoils ? ` ${spoils}.` : ''}`,
  };
}

/** What a game's result does to its war, from the viewer's side. */
function spoilsOf(model: CampaignModel, game: GameSummary, war: WarView, winner: Color | null): string {
  const outcome = afterGame(model.campaign.rules, game.armageddon, winner);
  if (outcome === 'armageddon') return 'An Armageddon game decides it';
  if (outcome === 'held') return `${countryName(model, war.targetId)} holds`;
  const ids = warTransfers(war, outcome).map((t) => t.territoryId);
  const [winnerId, loserId] =
    outcome === 'attacker' ? [war.attackerId, war.defenderId] : [war.defenderId, war.attackerId];
  const list = countryList(model, ids);
  const me = model.me.userId;
  if (winnerId === me) return `${list} ${ids.length === 1 ? 'is' : 'are'} yours`;
  if (loserId === me) return `You lose ${list}`;
  return `${playerName(model, winnerId)} takes ${list}`;
}

/** "Libya", "Chad and Niger", "Chad, Niger and Mali", "Chad, Niger and 2 more". */
export function countryList(model: CampaignModel, ids: readonly TerritoryId[]): string {
  const names = ids.map((id) => countryName(model, id));
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}
