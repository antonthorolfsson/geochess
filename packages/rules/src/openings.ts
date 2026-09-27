/**
 * Opening names for games, from the Lichess openings list (CC0), which @empire/data builds into a
 * table of named positions. Games are matched by position, so transpositions get their name too.
 */
import { ChessGame } from './chess';

export interface Opening {
  /** Encyclopaedia of Chess Openings code, e.g. "B90". */
  eco: string;
  /** e.g. "Sicilian Defense: Najdorf Variation". */
  name: string;
}

/** The openings table as @empire/data writes it. */
export interface OpeningList {
  source: string;
  license: string;
  /** The longest named line, in plies: games are searched no deeper. */
  maxPly: number;
  /** One entry per named position: ECO code, name and `ChessGame.positionKey`. */
  openings: [eco: string, name: string, position: string][];
}

export class OpeningBook {
  readonly maxPly: number;
  private readonly byPosition = new Map<string, Opening>();

  constructor(list: OpeningList) {
    this.maxPly = list.maxPly;
    for (const [eco, name, position] of list.openings) {
      if (!this.byPosition.has(position)) this.byPosition.set(position, { eco, name });
    }
  }

  get size(): number {
    return this.byPosition.size;
  }

  /** The opening a game (moves in UCI) reached: the last named position among its first moves. */
  classify(moves: readonly string[]): Opening | null {
    const game = new ChessGame();
    let found: Opening | null = null;
    for (const uci of moves.slice(0, this.maxPly)) {
      if (game.play(uci) === null) break;
      found = this.byPosition.get(game.positionKey) ?? found;
    }
    return found;
  }
}

/** The family an opening belongs to: its name up to the colon, e.g. "Sicilian Defense". */
export function openingFamily(name: string): string {
  return name.split(':')[0]!.trim();
}
