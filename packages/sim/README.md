# @empire/sim: the balance simulator

Plays whole Geo Chess campaigns headlessly, with bots, on the real map and the real rules, to find
missions that are too easy or too hard and anything else out of balance. The findings are in
[docs/balance-report.md](../../docs/balance-report.md).

Every rule comes from `@empire/rules`: the draft, targets and stakes, answers, clock modifiers,
resolution, truces and locks, accords and reputation, mission generation, dealing, evaluation,
claim blockers and the finish line. What the simulator writes itself is the server's orchestration
(`src/engine/`), with rounds as its clock: the lobby, draft and selection, round starts, the war
lifecycle and `settleVictory`. `apps/server/test/sim-parity.test.ts` replays simulated campaigns
through the real server and checks both agree on every award, reveal, winner and the final map.

## Running

```bash
pnpm sim --scenario baseline --players 2-8 --paces live,correspondence --seeds 400
pnpm sim:report baseline                 # tables to stdout and out/baseline/report.md
pnpm sim:report whatif baseline --compare baseline            # variants against the baseline, seed for seed
pnpm sim:report hot --compare hot-publics --missions          # … and mission by mission
pnpm --filter @empire/sim trace --scenario baseline --players 4 --seed 7   # one campaign, told round by round
```

Runs write one JSON line per campaign to `packages/sim/out/<name>/shard-*.jsonl` (git-ignored) and
pick up where they stopped if interrupted. `--workers` sets the number of child processes (default:
cores − 2); `--out` names the directory.

Campaigns play what a new campaign plays: the current mission rules version, a last round of 25 and
the revised war answers (a matched raise, nearby redirects that cost a token, fortifying, calling a
declaration off, and peace terms in place of tribute). `--mission-rules 2` plays an earlier version
(the balance report's first runs were version 2), and `--last-round 30` or `--last-round none`
another season length (`trace` takes both too). The report's runs also played the original answers:
add `whatif:original-answers` (see [Adding a what-if](#adding-a-what-if)) to compare with them.

## What a campaign does

1. Public missions: the default set, a random draw, or given kinds, generated as in the lobby.
2. A full-map snake draft in a random seat order, then accords may be signed (round 0).
3. Baselines, secret options dealt with each player's own seed, and a choice.
4. Rounds: tokens, `round.started`, accords paid and kept, missions settled; then diplomacy and
   `waves` rounds of declarations, answers, replies and the games that are due. A war stays open
   0, 1, 2… rounds past its declaration with the chances in `latency` (live: always 0;
   correspondence: 20/50/30%), holding up claims it could break.
5. The campaign ends at 7 points (`normal`), or when the host moves on from the last round, on points
   then value (as the server's `endSeason`), or runs to the round cap without ending (`horizon`, to
   measure missions apart from game length). A normal campaign with no last round that reaches the
   cap has stalled.

Games are decided by an Elo model (`src/engine/chess.ts`): White's edge, the clock modifiers as
extra time, a draw rate, and how decisive games end (checkmate, timeout, resignation).

## Bots

`src/bots/standard.ts` values everything in country value, a victory point being worth `vpValue`.
They draft toward public targets, choose the secret that shows the least effort, declare the war
with the best expected value (country value, mission progress, missions completed or broken,
rivals' visible claims broken or handed over, allowing for a raise, with reserves set aside to meet
a token raise), answer with the best of accept, raise (putting in the country whose bigger war is
best for them, for a matched raise), redirect and tribute (or, with peace terms, a cheaper country
or tokens offered for peace and an accord, answering as they otherwise would if it's turned down),
fortify a country a complete or claimed mission leans on when they have a token to spare, and sign
accords with neighbours they don't want to fight, breaking them for a much better target or for
Backstab. They never call a declaration off unless a test sets `recallRate`. Rivals only ever see public missions,
pending claims and revealed secrets. `greedy` bots play on value alone.

The knobs are in `src/bots/knobs.ts`; the scenarios in `src/scenarios.ts` vary them one at a time.
The `secrets` scenario doesn't let players choose: each is assigned a different secret kind that
fits them (as the dealer judges fit), so every kind is measured on equal terms.

## Adding a what-if

A variant (`src/variants.ts`) changes the missions without touching the game: patch specs after
they're generated or dealt (a public patch can also pick new targets), keep kinds out of play, add
a condition on completion, change the points or the host's war settings, or set another last round.
The variants in the catalog before "Tuning mission rules version 3" were written against version 2:
run them with `--mission-rules 2 --last-round none` to compare them as the report did. Add it to `src/variants-catalog.ts`, then run it with
the same seeds as the scenario it's compared with:

```bash
pnpm sim --scenario baseline,whatif:<name> --players 2-8 --seeds 300 --out whatif-<name>
pnpm sim:report whatif-<name> --compare baseline
```

Generation parameters (how targets are chosen and options dealt) are read from the catalog by
version and can't be varied here.
