import { ChessGame, OpeningBook, type OpeningList } from '@empire/rules';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'openings', 'openings.json');
const list = JSON.parse(readFileSync(file, 'utf8')) as OpeningList;
const book = new OpeningBook(list);

/** A line in SAN as the UCI moves a game stores. */
function moves(line: string): string[] {
  const game = new ChessGame();
  for (const san of line.split(' ')) expect(game.playSan(san), san).not.toBeNull();
  return game.moves;
}

describe('openings table', () => {
  it('comes from the Lichess openings list, which is public domain', () => {
    expect(list.source).toBe('https://github.com/lichess-org/chess-openings');
    expect(list.license).toBe('CC0-1.0');
    expect(list.openings.length).toBeGreaterThan(3000);
    expect(book.size).toBe(list.openings.length);
    for (const [eco, name] of list.openings) {
      expect(eco).toMatch(/^[A-E]\d\d$/);
      expect(name.trim()).toBe(name);
    }
  });

  it('names every first move', () => {
    for (const [from, tos] of new ChessGame().dests()) {
      for (const to of tos) expect(book.classify([from + to]), from + to).not.toBeNull();
    }
  });

  it('names well-known lines, however they were reached', () => {
    expect(book.classify(moves('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'))).toEqual({
      eco: 'B90',
      name: 'Sicilian Defense: Najdorf Variation',
    });
    expect(book.classify(moves('e4 e5 Nf3 Nc6 Bb5'))?.name).toBe('Ruy Lopez');
    expect(book.classify(moves('Nf3 Nf6 c4 e6 Nc3 d5 d4'))?.name).toBe(
      "Queen's Gambit Declined: Three Knights Variation",
    );
  });
});
