import { describe, expect, it } from 'vitest';
import { ChessGame } from './chess';
import { OpeningBook, openingFamily, type OpeningList } from './openings';

/** The position after a line in SAN, as the openings build stores it. */
function position(line: string): string {
  const game = new ChessGame();
  for (const san of line.split(' ')) expect(game.playSan(san), san).not.toBeNull();
  return game.positionKey;
}

const list = (maxPly: number, openings: [string, string, string][]): OpeningList => ({
  source: 'test',
  license: 'CC0-1.0',
  maxPly,
  openings: openings.map(([eco, name, line]) => [eco, name, position(line)]),
});

const book = new OpeningBook(
  list(5, [
    ['C20', "King's Pawn Game", 'e4 e5'],
    ['C40', "King's Knight Opening", 'e4 e5 Nf3'],
    ['C44', "King's Knight Opening: Normal Variation", 'e4 e5 Nf3 Nc6'],
    ['C50', 'Italian Game', 'e4 e5 Nf3 Nc6 Bc4'],
    ['B20', 'Sicilian Defense', 'e4 c5'],
  ]),
);
const uci = (text: string) => text.split(' ');

describe('opening names', () => {
  it('name a game by the last named position it reached', () => {
    expect(book.classify(uci('e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3'))).toEqual({ eco: 'C50', name: 'Italian Game' });
    expect(book.classify(uci('e2e4 c7c5 g1f3'))).toEqual({ eco: 'B20', name: 'Sicilian Defense' });
  });

  it('recognise transpositions', () => {
    expect(book.classify(uci('g1f3 b8c6 e2e4 e7e5'))?.name).toBe("King's Knight Opening: Normal Variation");
  });

  it('look no deeper than the longest named line', () => {
    const shallow = new OpeningBook(list(2, [['C50', 'Italian Game', 'e4 e5 Nf3 Nc6 Bc4']]));
    expect(shallow.classify(uci('e2e4 e7e5 g1f3 b8c6 f1c4'))).toBeNull();
  });

  it('leave games without a named position unnamed', () => {
    expect(book.classify([])).toBeNull();
    expect(book.classify(uci('a2a3 e7e5'))).toBeNull();
    expect(book.classify(uci('e2e4 e7e5 e2e4'))?.name).toBe("King's Pawn Game");
  });

  it('keep the first name when two lines reach one position', () => {
    const twice = new OpeningBook(
      list(4, [
        ['C44', 'First', 'e4 e5 Nf3 Nc6'],
        ['C44', 'Second', 'Nf3 Nc6 e4 e5'],
      ]),
    );
    expect(twice.size).toBe(1);
    expect(twice.classify(uci('e2e4 e7e5 g1f3 b8c6'))?.name).toBe('First');
  });

  it('group names into families', () => {
    expect(openingFamily('Sicilian Defense: Najdorf Variation, English Attack')).toBe('Sicilian Defense');
    expect(openingFamily('Italian Game')).toBe('Italian Game');
  });

  it('play SAN moves as UCI, castling as the king’s move', () => {
    const game = new ChessGame();
    for (const san of 'e4 e5 Nf3 Nc6 Bc4 Nf6'.split(' ')) game.playSan(san);
    expect(game.playSan('O-O')).toBe('e1g1');
    expect(game.playSan('Qh8')).toBeNull();
    expect(game.sans.at(-1)).toBe('O-O');
  });
});
