/**
 * Builds the opening names table from the Lichess openings list (CC0): every named line is played
 * out and stored by its final position, so games can be named however they reached it. Usage:
 * `pnpm --filter @empire/data openings [--refresh]`.
 */
import { ChessGame, type OpeningList } from '@empire/rules';
import path from 'node:path';
import { cachedText } from './lib/cache';
import { stableGeneratedAt, writeText } from './lib/output';
import { OPENINGS_DIR } from './lib/paths';

const SOURCE = 'https://github.com/lichess-org/chess-openings';
const FILES = ['a', 'b', 'c', 'd', 'e'];
const url = (file: string) => `https://raw.githubusercontent.com/lichess-org/chess-openings/master/${file}.tsv`;

type Built = OpeningList & { generatedAt: string };

/** One named line: `eco`, `name` and its moves in SAN, from a row of the source list. */
function parseRows(tsv: string, file: string): { eco: string; name: string; sans: string[] }[] {
  const [header, ...lines] = tsv.split('\n');
  if (header?.trim() !== 'eco\tname\tpgn') throw new Error(`${file}: unexpected header ${JSON.stringify(header)}`);
  return lines
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      const [eco, name, pgn] = line.split('\t');
      if (!eco || !name || !pgn) throw new Error(`${file}:${i + 2}: expected eco, name and pgn`);
      // "1. e4 e5 2. Nf3" -> ["e4", "e5", "Nf3"]
      const sans = pgn
        .trim()
        .split(/\s+/)
        .map((token) => token.replace(/^\d+\.+/, ''))
        .filter(Boolean);
      return { eco, name, sans };
    });
}

async function main(): Promise<void> {
  const refresh = process.argv.includes('--refresh');
  const openings: OpeningList['openings'] = [];
  const seen = new Map<string, string>();
  let maxPly = 0;
  let duplicates = 0;
  for (const file of FILES) {
    const rows = parseRows(await cachedText(url(file), `openings-${file}.tsv`, { refresh }), `${file}.tsv`);
    for (const { eco, name, sans } of rows) {
      const game = new ChessGame();
      for (const san of sans) {
        if (game.playSan(san) === null) throw new Error(`${file}.tsv: ${name}: illegal move ${san}`);
      }
      const position = game.positionKey;
      // Two lines reaching one position keep the first name, as Lichess does.
      if (seen.has(position)) {
        duplicates++;
        continue;
      }
      seen.set(position, name);
      openings.push([eco, name, position]);
      maxPly = Math.max(maxPly, sans.length);
    }
  }

  const target = path.join(OPENINGS_DIR, 'openings.json');
  const built = stableGeneratedAt<Built>(target, {
    source: SOURCE,
    license: 'CC0-1.0',
    generatedAt: new Date().toISOString(),
    maxPly,
    openings,
  });
  // One opening per line keeps the file readable and its diffs small.
  const { openings: list, ...head } = built;
  const fields = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const rows = list.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');
  writeText(target, `{\n${fields.join('\n')}\n  "openings": [\n${rows}\n  ]\n}`);
  console.log(
    `• ${openings.length} named positions, lines up to ${maxPly} plies` +
      (duplicates ? ` (${duplicates} lines reach an earlier line's position)` : ''),
  );
  console.log(`• Wrote ${path.relative(process.cwd(), target)}`);
}

main().catch((err: unknown) => {
  console.error(`\nOpenings build failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
