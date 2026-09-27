import { OpeningBook, type Opening, type OpeningList } from '@empire/rules';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Finished games whose names are remembered; the oldest are forgotten first. */
const REMEMBERED = 20_000;

function loadBook(): OpeningBook {
  const file = fileURLToPath(import.meta.resolve('@empire/data/openings/openings.json'));
  return new OpeningBook(JSON.parse(readFileSync(file, 'utf8')) as OpeningList);
}

/** Names games' openings. A finished game never changes, so its name is worked out once. */
export class OpeningNamer {
  /** Null until first needed; false if the table couldn't be read, so games go unnamed. */
  private book: OpeningBook | null | false;
  private readonly onError: (err: unknown) => void;
  private readonly finished = new Map<string, Opening | null>();

  /** `book`, or the table built by @empire/data, read the first time a game is named. */
  constructor({ book, onError = () => {} }: { book?: OpeningBook; onError?: (err: unknown) => void } = {}) {
    this.book = book ?? null;
    this.onError = onError;
  }

  name(game: { id: string; status: string; moves: readonly string[] }): Opening | null {
    const known = this.finished.get(game.id);
    if (known !== undefined) return known;
    if (this.book === null) {
      try {
        this.book = loadBook();
      } catch (err) {
        this.book = false;
        this.onError(err);
      }
    }
    if (!this.book) return null;
    const opening = this.book.classify(game.moves);
    if (game.status === 'finished') {
      if (this.finished.size >= REMEMBERED) this.finished.delete(this.finished.keys().next().value!);
      this.finished.set(game.id, opening);
    }
    return opening;
  }
}
