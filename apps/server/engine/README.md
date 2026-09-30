# Stockfish for the bots

The chess engine bot players use: Stockfish 19's lite, single-threaded WebAssembly build from
[Stockfish.js](https://github.com/nmrugg/stockfish.js) (Chess.com), exactly as published on npm in
`stockfish@19.0.0` (`bin/`). The game server runs it as a child process speaking UCI
(`src/bots/engine.ts`); `src/bots/chess.ts` sets what each bot level asks of it.

| File                            |      Bytes | Integrity (npm)                                         |
| ------------------------------- | ---------: | ------------------------------------------------------- |
| `stockfish-19-lite-single.js`   |     21,415 | `sha256-0zRBJKsGf7C5Dud4c7uOn79fwBvFJf5xSw+UJYHoieY=` |
| `stockfish-19-lite-single.wasm` |  1,787,571 | `sha256-V6wtcjEqujRnYOPxc/aHqMIRII6XqHJoQ29/DhC7U4c=` |
| `Copying.txt`                   |     35,821 | `sha256-Czg9WmPaZE9ijZnDOXbqZIftiaqlnwsyV5kt6sEXHms=` |

`package.json` marks this folder CommonJS: the loader is a CommonJS script, and the server package
is ESM.

**License:** GPL-3.0 (`Copying.txt`), compatible with the project's AGPL-3.0-or-later. The source is
[Stockfish](https://github.com/official-stockfish/Stockfish) and
[Stockfish.js v19.0.0](https://github.com/nmrugg/stockfish.js/tree/v19.0.0); the lite network is
`nn-61e7af4bb97d` by sscg13.

**Updating:** download the new version's lite single-threaded `.js` and `.wasm` from
`https://unpkg.com/stockfish@<version>/bin/`, check them against the integrity listed at
`https://unpkg.com/stockfish@<version>/bin/?meta`, change `STOCKFISH_FILE` in `src/bots/engine.ts`,
and run the ladder (`pnpm --filter @empire/server bot-ladder`) to see whether the levels' ratings in
`BOT_LEVELS` still hold.
