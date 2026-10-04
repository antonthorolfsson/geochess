# Balance report: simulated campaigns, 2–8 players

_29 September 2026 · mission rules version 2 · dataset `2026.1` · 44,284 simulated campaigns.
Written from campaigns played by bots on the real rules. Read
[How the campaigns were simulated](#how-the-campaigns-were-simulated) and
[Limitations](#limitations) before leaning on any single number._

_Update, the same day: the recommendations below, all but the slower war tokens, are now mission
rules version 3 and a season length. What the same bots make of them is in
[Version 3, as built](#version-3-as-built); the rest of the report describes version 2. The war
answers it found wanting (finding 6) are revised too: see
[War answers, revised](#war-answers-revised)._

## The short version

1. **Campaigns end far too soon.**
   - The median win comes in round 6 to 8 live and round 8 or 9 by correspondence, against a target
     of 15 to 25.
   - More than a third of live campaigns are over by round 5. Fewer than one in eight ends inside
     the target window.
   - Small tables have the opposite problem: a quarter of 2-player and a sixth of 3-player
     campaigns have no winner by round 40.
2. **Two public missions are close to free.**
   - **Campaign Veteran** counts wins as the defender, and everyone is attacked. Three players in
     four score it, by round 4; 96–100% of winners have it.
   - **Kingslayer** judges "the leader" on map value while nobody has points, so the rest of the
     table only has to beat the biggest empire once. 90–98% of players score it, by round 3.
   - **Great Expanse, Two Fronts, Lightning Campaign and Great Powers** are not far behind. A
     single giant is enough for Great Expanse.
3. **The secret you hold decides whether you can win.**
   - **Battle secrets are strong.** Nemesis, Checkmate Artist, Backstab (from 3 players) and
     Protected Expansion roughly double their holder's chance of winning.
   - **Most region and route secrets are almost never done.** 18 of the 30 kinds are completed 1–8%
     of the time, and holding one cuts your chances to a fifth.
   - **Players take the battle secret.** Three hands in four offer one, players take it two times in
     three (it shows the least effort), and 85–90% of winners hold one.
4. **At 2–3 players the draft hands out points.**
   - Strategic Positions is complete at the draft in every 2-player campaign.
   - Great Connection, Regional Power, Mare Nostrum and Continental Bridge mostly score from drafted
     positions too.
   - In a fifth of 2-player campaigns someone has 4 points from the draft by round 3.
5. **Some missions are dead at bigger tables.**
   - Great Connection and Mare Nostrum: 1–3% of players at 5 or more.
   - Consolidation: 2%.
   - Seven Wonders and Across the Seas: rare and late.
   - Random missions therefore make campaigns a lottery: no winner in 3% of campaigns dealt no hard
     mission, but in 47% of those dealt three.
6. **Wars are fought for missions, not land.**
   - A defender can raise for free, so an attack gains the attacker roughly nothing in country value.
     Raises answer 34–43% of declarations.
   - Tribute is almost never worth offering. Redirects answer 45% of declarations at 2 players.
   - Players are almost never eliminated.
7. **What's fair:**
   - draft seats (every seat wins its share, within noise);
   - the attacker/defender split (50% / 42% of games);
   - shared wins (0–4%);
   - the chess settings: mates, draws, White's edge and clock modifiers change little.

   Chess skill, as intended, matters a lot: a player 300 Elo stronger wins half of all 4-player
   campaigns.

## What to change

Changes 1–7, 11 and 12 were tried in the simulator only, on the same seeds as the scenario they
change; nothing in the game has changed. "Players scoring" is the share of all players who score
the mission. The packages are described in [What-ifs](#8-what-ifs-fixes-tried-in-the-simulator).

| #   | Change                                                                                                                                                                                             | Why                                                                               | In the simulator                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Campaign Veteran:** count only wars won as the attacker, 4 to 6 of them, against 3 opponents                                                                                                     | Defensive wins make it free                                                       | Attack wins only: players scoring falls from 63–76% to 49–65%. 6 wins (3 attacking, 3 opponents): about 60% of players, from round 6–7 instead of 4                           |
| 2   | **Kingslayer:** judge the leader on points only, and require trailing by at least 4                                                                                                                | Before anyone scores, the "leader" is just the biggest empire                     | Players scoring falls to 38% (2 players), 72% (4) and 81% (6–8); from round 6–7 instead of 3                                                                                  |
| 3   | **Great Expanse** 20 million km², **One Billion** 2 billion people, **Great Powers** all three won after the draft                                                                                 | One giant completes them                                                          | Great Expanse falls to 28–34% of players, One Billion to 15–20%, Great Powers to 22–41%; all scored rounds 10–15                                                              |
| 4   | **Across the Seas:** two attacks, not three                                                                                                                                                        | Rare and late (10–16% of players, round 16)                                       | 24–47% of players, round 11–12                                                                                                                                                |
| 5   | **Positions need a conquest:** Strategic Positions, Great Connection, Regional Power, Mare Nostrum and Continental Bridge count only with at least one country of the position won since the draft | The draft hands them out at 2–3 players                                           | Strategic Positions at 2 players falls from 53% to 6% of players; Great Connection from 25% to 1%. Needs 11 alongside, or small tables stall more                             |
| 6   | **Iron Wall:** deal it only from 4 players                                                                                                                                                         | A lone rival can deny it by not attacking                                         | Stalls at 2 players 24% → 16%; at 3 players 12% → 7%                                                                                                                          |
| 7   | **Battle secrets:** Checkmate Artist 3 mates, Nemesis 4 countries, Backstab 2 countries in the round after the break, Iron Wall 3 wins                                                             | 1.8–2.3× their holder's fair chance                                               | Completions fall 5–7 points: helps, but not enough alone. Pricing secrets by effort (battle 2 points, others 4) overshoots: battle holders fall to 0.5–0.75×                  |
| 8   | **Region and route secrets need redesign** (not validated)                                                                                                                                         | Only 12% of holders ever complete one, even those the dealer rates at 2 conquests | One country fewer adds only a few points. They need fewer targets, or a deal calibrated on completion rates (the simulator can measure them) rather than on counted conquests |
| 9   | **Great Connection and Mare Nostrum only up to 4 players** (not validated)                                                                                                                         | Dead at 5 or more, whatever the numbers                                           | Closer endpoints and a smaller Mediterranean left them at 3–5%                                                                                                                |
| 10  | **Random missions: at most one hard mission per draw** (not validated)                                                                                                                             | Stalls rise from 3% to 75% with the number drawn                                  | –                                                                                                                                                                             |
| 11  | **A season length:** the host sets a last round (the plan's "fixed-length season"); first to 7 wins, or the most points then                                                                       | 14–27% of small-table campaigns never end                                         | No campaign left without a winner. With the strong package and a round-25 limit, 26–64% of campaigns end in rounds 15–25                                                      |
| 12  | **For 15–25 rounds, fewer wars per round:** e.g. a war token every other round (a new host option)                                                                                                 | With a token every round, the race is decided by round 6                          | With the mild package, wins come around round 9–14 instead of 7–11                                                                                                            |
| –   | **Don't raise the points to win**                                                                                                                                                                  | –                                                                                 | At 8 or 9 points, 39–60% of campaigns never finish: the extra points have to come from missions that are nearly dead                                                          |

The first seven are numbers a mission rules version 3 can carry. Numbers 8–10 change how targets
are generated or options dealt. Numbers 11 and 12 are new host settings.

## How the campaigns were simulated

**What was played.** Whole campaigns, from the lobby to the win:

- a full-map snake draft, in a random seat order;
- secret options dealt with each player's own seed, and a choice;
- rounds of diplomacy and war;
- the finish at 7 points.

Every rule comes from `@empire/rules`, as the server uses it: legal picks; targets, stakes and
answers; clock modifiers; resolution, truces and locks; accords and reputation; mission
generation, dealing and evaluation; claim blockers.

The simulator (`packages/sim`) re-implements only the server's orchestration: round starts, the war
lifecycle and `settleVictory`. Rounds are its clock, and the host is assumed to wait out the holding
time, so a claim from round R scores when round R+2 starts. It is checked against the real server:
`apps/server/test/sim-parity.test.ts` replays eight simulated campaigns (2–6 players, default and
random missions, contiguous and free drafts) through the API. They agree on every award (player,
mission, round), every reveal, the winners and the whole final map.

**Paces.**

- **Live:** every war is fought out in the round it's declared.
- **Correspondence:** a war stays open 0, 1 or 2 rounds past its declaration (20%, 50%, 30%). While
  open it locks its countries and holds up any claim it could break.

**Chess.**

- Ratings are equal unless stated. White is worth 20 Elo.
- Each 1% of extra clock time (from the clock modifiers) is worth 1.5 Elo.
- 8% of games are drawn; a draw holds.
- Of decisive games, 30% end in mate, 20% on time and the rest by resignation.

The attacker wins 49–51% of games, the defender 41–43%.

**The players are bots.** Each decision is a one-step expected value in country value, with a
victory point worth 4 value (10 in one sensitivity run). Using public information only, they:

- **Draft** toward the public missions' targets.
- **Choose** the secret option that shows the least effort. This is the number of conquests or
  wins the game displays.
- **Declare** the war worth most. That counts country value and progress toward their missions. It
  counts missions the war would complete or break, and rivals' visible claims it would break or
  hand over. It allows for a raise, which a defender with a visible mission at stake always makes.
- **Answer** with the best of accept, raise, redirect and tribute.
- **Make accords.** They sign accords with neighbours they'd rather not fight. They break one for a
  much better target, or for Backstab, and never sign again with someone who betrayed them.

Pending claims and revealed secrets are public, and the bots use them to block. They never see an
unrevealed secret.

**Runs.**

| Run             | What                                                                                                                                                                            | Campaigns |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Baseline        | Default public missions (Expansion, Strategic Positions, Great Connection, Campaign Veteran), contiguous draft, both paces, 2–8 players, 400 seeds each                         | 5,600     |
| Secrets         | Each player assigned a different secret mission that fits them (as the dealer judges fit), to measure every kind on equal terms; live, 2–8 players                              | 3,600     |
| Free drafts     | Free draft, public missions drawn at random; live, 2–8 players                                                                                                                  | 1,400     |
| Public missions | Public missions drawn at random, played on to round 25 whoever reaches 7 (to measure each mission apart from game length); both paces                                           | 4,200     |
| Sensitivity     | One bot or chess assumption changed at a time; 4 players (150 each), some at 2 and 8 (100 each)                                                                                 | 6,350     |
| What-ifs        | Rule changes tried on the same seeds as the scenario they change: the default missions, random missions, the four quickest and four rarest public missions, and secrets by kind | 23,134    |

Proportions come with 95% Wilson intervals where they matter. With 400 campaigns per cell, a
campaign-level rate is good to about ±5 points.

## Results

### 1. Campaigns end far too soon, or at 2–3 players sometimes never

With the default missions, the median campaign is won in round 6 to 8 live and round 8 or 9 by
correspondence. The target is 15 to 25. More than a third of live campaigns are over by round 5,
and fewer than one in eight ends inside the target window. The two paces are shown as live /
correspondence:

| Players | Median win round | Won by round 5 | Won in rounds 15–25 | No winner by round 40 |
| ------- | ---------------- | -------------- | ------------------- | --------------------- |
| 2       | 8 / 9            | 37% / 28%      | 7% / 9%             | 27% / 24%             |
| 3       | 8 / 9            | 37% / 21%      | 9% / 12%            | 18% / 14%             |
| 4       | 6 / 9            | 39% / 25%      | 7% / 11%            | 10% / 7%              |
| 5       | 7 / 8            | 36% / 21%      | 7% / 11%            | 8% / 3%               |
| 6       | 6 / 8            | 39% / 21%      | 7% / 12%            | 4% / 2%               |
| 7       | 6 / 8            | 48% / 23%      | 4% / 9%             | 1% / 2%               |
| 8       | 6 / 8            | 47% / 21%      | 6% / 8%             | 1% / 1%               |

Small tables also stall. A quarter of 2-player campaigns and a sixth of 3-player ones have no
winner by round 40. The stuck player typically sits on 6 points (Campaign Veteran, Strategic
Positions and Expansion) with a secret that can't be done. Two things cause it:

- **The secret gets denied.** Iron Wall is the usual one: once it's revealed, the only rival simply
  stops attacking.
- **The fourth public is out of reach.** Great Connection, usually.

### 2. How winners score

Almost every winner makes 7 as two public missions plus the secret. More than half of those points
are records that score the moment they're done (Campaign Veteran, and the battle secrets), not
positions that have to survive a response window:

| Players | 2 public + secret | 3 public + secret | 4 public, no secret | Points from records (scored at once) | Winners holding a battle secret | Winners who scored Campaign Veteran |
| ------- | ----------------- | ----------------- | ------------------- | ------------------------------------ | ------------------------------- | ----------------------------------- |
| 2       | 72%               | 18%               | 9%                  | 48%                                  | 85%                             | 96%                                 |
| 3       | 86%               | 12%               | 1%                  | 55%                                  | 89%                             | 97%                                 |
| 4       | 90%               | 9%                | 1%                  | 57%                                  | 88%                             | 99%                                 |
| 5       | 93%               | 7%                | 0%                  | 57%                                  | 87%                             | 99%                                 |
| 6       | 96%               | 4%                | 0%                  | 57%                                  | 86%                             | 100%                                |
| 7       | 97%               | 3%                | 0%                  | 57%                                  | 88%                             | 100%                                |
| 8       | 97%               | 3%                | 0%                  | 57%                                  | 88%                             | 100%                                |

### 3. Public missions

Played on to round 25 whoever reaches 7, with the public missions drawn at random. The table gives
the share of players scoring each mission, how soon, and how much of it the draft hands out at
small tables:

| Public mission       | 2 players | 3–4 players | 5–6 players | 7–8 players | Median round scored | From the draft (2–3 players) |
| -------------------- | --------- | ----------- | ----------- | ----------- | ------------------- | ---------------------------- |
| Campaign Veteran     | 96%       | 93%         | 97%         | 98%         | 5                   | 0%                           |
| Kingslayer           | 90%       | 97%         | 98%         | 95%         | 3                   | 0%                           |
| Two Fronts           | 57%       | 71%         | 74%         | 68%         | 9                   | 0%                           |
| Lightning Campaign   | 57%       | 65%         | 71%         | 76%         | 11                  | 0%                           |
| Great Expanse        | 63%       | 70%         | 64%         | 55%         | 8                   | 0%                           |
| Continental Bridge   | 90%       | 63%         | 32%         | 16%         | 3                   | 84%                          |
| Expansion            | 53%       | 50%         | 47%         | 45%         | 8                   | 0%                           |
| Great Powers         | 57%       | 51%         | 42%         | 33%         | 10                  | 0%                           |
| One Billion          | 33%       | 36%         | 31%         | 29%         | 8                   | 0%                           |
| Regional Power       | 52%       | 30%         | 17%         | 12%         | 3                   | 86%                          |
| Strategic Positions  | 56%       | 29%         | 16%         | 10%         | 3                   | 82%                          |
| Across the Seas      | 10%       | 15%         | 16%         | 16%         | 16                  | 0%                           |
| Seven Wonders        | 18%       | 15%         | 10%         | 7%          | 14                  | 0%                           |
| Mare Nostrum         | 33%       | 13%         | 3%          | 1%          | 3                   | 91%                          |
| The Great Connection | 23%       | 6%          | 2%          | 1%          | 3                   | 84%                          |

(Consolidation, free drafts only, is scored by 2% of players at 3 or more.)

**Random draws make campaigns a lottery.** "Random missions" draws four kinds uniformly, so a
campaign can get four quick missions or four that are rarely done. In free-draft campaigns with
random missions, the share that never finish depends on how many hard missions were drawn. Hard
here means Great Connection, Mare Nostrum, Consolidation, Regional Power, Across the Seas,
Strategic Positions or Seven Wonders:

| Hard missions drawn   | 0   | 1   | 2   | 3   | 4   |
| --------------------- | --- | --- | --- | --- | --- |
| No winner by round 40 | 3%  | 7%  | 15% | 47% | 75% |

- **Nearly free.**
  - **Campaign Veteran** counts wins as the defender. Every player is attacked about once a round,
    so three wins against two opponents come by round 4 or 5 for almost everyone.
  - **Kingslayer** judges the leader by points and then by map value. Before anyone has points,
    "the leader" is simply the biggest empire, so the rest of the table only has to beat it once.
    The median is round 3.
- **Easy.**
  - **Two Fronts** and **Lightning Campaign**: two to three players in four score them.
  - **Great Expanse** is done by any one of Australia, Brazil, Canada, China, Russia or the United
    States.
  - **Expansion** and **Great Powers** are close behind.
- **Handed out by the draft at small tables.** Most of their awards at 2–3 players come straight
  from drafted positions:
  - Continental Bridge (90% of 2-player players);
  - Regional Power;
  - Strategic Positions: complete at the draft in every 2-player campaign and 88% of 3-player
    ones;
  - Mare Nostrum;
  - Great Connection.

  About a fifth of 2-player campaigns have someone on 4 points from the draft by round 3.

- **Dead at bigger tables.**
  - **Great Connection** and **Mare Nostrum**: 1–3% of players at 5 or more.
  - **Seven Wonders** and **Across the Seas**: 7–16%, and late (round 14–16).
  - **Consolidation**.

### 4. Secret missions

**Each kind on equal terms.** In these runs every player was assigned a different secret that fits
them. Four kinds roughly double their holder's chance of winning; most region and route secrets
are almost never done:

| Secret mission       | Holders | Completed | Median round | Holder wins, × fair share (95% CI) |
| -------------------- | ------- | --------- | ------------ | ---------------------------------- |
| Nemesis              | 674     | 80%       | 7            | 2.32 (2.16–2.47)                   |
| Checkmate Artist     | 598     | 80%       | 7            | 2.22 (2.06–2.38)                   |
| Backstab             | 603     | 73%       | 4            | 1.82 (1.66–1.98)                   |
| Protected Expansion  | 392     | 40%       | 12           | 1.77 (1.51–2.05)                   |
| Half of Humanity     | 178     | 15%       | 14           | 1.04 (0.73–1.45)                   |
| Iron Wall            | 601     | 28%       | 4            | 0.84 (0.72–0.98)                   |
| Two-Theater Power    | 666     | 12%       | 14           | 0.63 (0.52–0.75)                   |
| Island Empire        | 362     | 13%       | 14           | 0.61 (0.45–0.82)                   |
| Baltic League        | 567     | 11%       | 11           | 0.52 (0.42–0.65)                   |
| Caspian              | 540     | 12%       | 15           | 0.51 (0.40–0.64)                   |
| Buffer Zone          | 319     | 11%       | 14           | 0.50 (0.35–0.70)                   |
| Central Asian Union  | 594     | 11%       | 13           | 0.46 (0.36–0.58)                   |
| Pacific Passage      | 460     | 8%        | 12           | 0.37 (0.27–0.50)                   |
| Silk Road            | 507     | 7%        | 21           | 0.36 (0.26–0.48)                   |
| Mekong               | 542     | 8%        | 14           | 0.35 (0.26–0.46)                   |
| Andean Spine         | 295     | 8%        | 11           | 0.32 (0.21–0.48)                   |
| Black Sea            | 591     | 5%        | 16           | 0.25 (0.18–0.35)                   |
| Nordic               | 529     | 6%        | 15           | 0.25 (0.17–0.34)                   |
| Northern Passage     | 575     | 3%        | 9            | 0.24 (0.17–0.33)                   |
| Unification          | 431     | 4%        | 19           | 0.23 (0.16–0.34)                   |
| Gulf Hegemon         | 540     | 5%        | 15           | 0.21 (0.15–0.31)                   |
| Hidden Triangle      | 633     | 4%        | 16           | 0.21 (0.15–0.29)                   |
| Mediterranean Arc    | 498     | 3%        | 23           | 0.20 (0.14–0.30)                   |
| Caribbean Chain      | 561     | 2%        | 8            | 0.19 (0.13–0.28)                   |
| Mountain Kingdom     | 666     | 4%        | 17           | 0.19 (0.13–0.26)                   |
| Horn of Africa       | 572     | 4%        | 24           | 0.17 (0.12–0.26)                   |
| Strait Keeper        | 610     | 1%        | 30           | 0.14 (0.09–0.21)                   |
| Encirclement         | 637     | 2%        | 22           | 0.13 (0.08–0.19)                   |
| Cape to Cairo        | 537     | 2%        | 20           | 0.09 (0.05–0.16)                   |
| Pan-American Highway | 322     | 2%        | 8            | 0.09 (0.04–0.20)                   |

**Why battle secrets are so strong.** The battle secrets ask for a few wins, and nobody can
take a win back:

- Checkmate Artist needs two wins by mate.
- Iron Wall needs two wins as the defender.
- Nemesis needs three countries taken from one rival.
- Backstab needs a single country from a partner you betrayed.

A region or route secret asks for several _particular_ countries held at the same time. Those
countries belong to neighbours who fight back, win them back, and see the reveal coming (it comes
one step before completion).

The bottleneck is getting there at all. Only 12% of region and route secret holders ever complete
the position, and 69% of those then hold it long enough to score. Even the options the dealer rates
at 2 conquests are completed only 10% of the time. The dealer counts conquests as if each one were
certain and would stay won.

- **Backstab** is weak only at 2 players (26% completed), where the only possible partner is also
  the only rival.
- **Iron Wall** is deniable: rivals stop attacking once it's revealed.

**As players actually choose.** In the baseline, three hands in four include a battle secret and
players take it two times in three, since it shows the least effort:

| Players | Hands with a battle secret | Players choosing one | Battle secrets completed | Other secrets completed |
| ------- | -------------------------- | -------------------- | ------------------------ | ----------------------- |
| 2       | 73%                        | 66%                  | 55%                      | 12%                     |
| 3       | 76%                        | 69%                  | 59%                      | 10%                     |
| 4       | 76%                        | 66%                  | 55%                      | 10%                     |
| 5       | 74%                        | 65%                  | 52%                      | 10%                     |
| 6       | 74%                        | 65%                  | 49%                      | 10%                     |
| 7       | 76%                        | 69%                  | 46%                      | 9%                      |
| 8       | 75%                        | 67%                  | 44%                      | 8%                      |

### 5. The draft

Seats are fair, and the draft rarely decides the winner outright. Past the positions above, the top
drafter's edge is modest (46% of wins against a fair 33% at 3 players; nothing much at 5 or more).
Leading after round 5 is worth more, between 1.3 and 2.9 times a fair share:

| Players | Share of wins by seat (lowest–highest) | Fair share | Top drafter wins | Leader after round 5 wins |
| ------- | -------------------------------------- | ---------- | ---------------- | ------------------------- |
| 2       | 49%–51%                                | 50%        | 53%              | 65%                       |
| 3       | 32%–34%                                | 33%        | 46%              | 54%                       |
| 4       | 22%–29%                                | 25%        | 30%              | 48%                       |
| 5       | 18%–22%                                | 20%        | 21%              | 44%                       |
| 6       | 15%–18%                                | 17%        | 20%              | 39%                       |
| 7       | 13%–16%                                | 14%        | 20%              | 38%                       |
| 8       | 11%–15%                                | 13%        | 13%              | 37%                       |

### 6. Wars, raises and accords

| Players | Declarations per player per round | Raised | Redirected | Tribute offered | Withdrawn | Games won by attacker / defender | Net value to the attacker per declaration | Accords signed per campaign | Accords broken per campaign |
| ------- | --------------------------------- | ------ | ---------- | --------------- | --------- | -------------------------------- | ----------------------------------------- | --------------------------- | --------------------------- |
| 2       | 0.70                              | 34%    | 45%        | 1%              | 22%       | 51% / 41%                        | 0.37                                      | 0.2                         | 0.2                         |
| 3       | 0.79                              | 37%    | 33%        | 2%              | 15%       | 50% / 42%                        | 0.24                                      | 4.0                         | 0.9                         |
| 4       | 0.77                              | 39%    | 26%        | 2%              | 13%       | 50% / 42%                        | 0.09                                      | 8.0                         | 1.3                         |
| 5       | 0.82                              | 40%    | 22%        | 3%              | 12%       | 49% / 42%                        | 0.07                                      | 10.3                        | 1.8                         |
| 6       | 0.83                              | 40%    | 19%        | 3%              | 11%       | 49% / 43%                        | -0.01                                     | 11.9                        | 2.2                         |
| 7       | 0.83                              | 43%    | 16%        | 3%              | 7%        | 49% / 43%                        | -0.07                                     | 11.5                        | 2.6                         |
| 8       | 0.82                              | 42%    | 14%        | 3%              | 8%        | 49% / 42%                        | -0.03                                     | 13.5                        | 2.8                         |

- **Wars are fought for missions, not land.**
  - On country value alone an attack is worth about nothing to the attacker, because the defender
    can raise for free. A defender raises two declarations in five, and the attacker then has to
    stake 125% or back off.
  - Eliminations almost never happen: 11 players out of 207,802 in all 44,284 campaigns, though an
    empire can shrink to a single country.
- **Redirects are common at small tables.** 45% of declarations at 2 players are redirected: a
  defender almost always has another country of the same value next to the attacker. At 8 players
  it's 14%.
- **Tribute is almost never worth it.** Offering a country worth less than the target costs about
  what the war would, so it's offered for 1–3% of declarations.
- **Accords.** About 8 are signed per campaign at 4 players and 13 at 8; one to three are broken.

### 7. How much the bots' habits matter

Each arm changes one assumption, on the same seeds as the baseline (4 players, live, 150
campaigns). The arms:

- **Secret choice** (`choice-rank1`, `choice-random`): players take the dealer's best fit (what the
  game assigns when time runs out), or pick at random.
- **Draft** (`draft-greedy`, `draft-heavy`): drafting on value alone, or hard for mission targets.
- **Raising** (`raise-never`, `raise-always`).
- **Blocking** (`no-blocking`, `high-blocking`): how much players break each other's claims and
  gang up on the leader.
- **Accords** (`no-accords`, `treacherous`).
- **Aggression** (`aggressive`, `cautious`).
- **Chess** (`mate-15`, `mate-45`, `mate-denial`, `draw-4`, `draw-12`, `white-0`, `white-35`,
  `time-0`, `time-3`): the share of wins by mate (and rivals resigning rather than be mated by a
  revealed Checkmate Artist), draws, White's edge, and the value of clock time.
- **Ratings** (`elo-150`, `elo-300`, `elo-star`): spread with sd 150 or 300, or one player 300
  stronger.
- **Waves** (`waves-1`, `waves-3`): declaration waves per round.
- **Mission value** (`vp-10`): a point worth 10 value instead of 4.
- **Greedy** (`greedy`): bots that ignore missions altogether.

| Arm           | Campaigns | Median win round | No winner by round 40 | Players scoring Campaign Veteran | Battle secrets completed | Other secrets completed | Winners holding a battle secret | Declarations per player-round |
| ------------- | --------- | ---------------- | --------------------- | -------------------------------- | ------------------------ | ----------------------- | ------------------------------- | ----------------------------- |
| choice-rank1  | 150       | 7 → 23           | 11% → 37%             | 72% → 90%                        | 52% → 75%                | 10% → 14%               | 86% → 38%                       | 0.76 → 0.92                   |
| choice-random | 150       | 7 → 14           | 11% → 29%             | 72% → 84%                        | 52% → 72%                | 10% → 9%                | 86% → 63%                       | 0.76 → 0.89                   |
| treacherous   | 150       | 7 → 7            | 11% → 9%              | 72% → 72%                        | 52% → 50%                | 10% → 10%               | 86% → 88%                       | 0.76 → 0.81                   |
| white-0       | 150       | 7 → 8            | 11% → 13%             | 72% → 69%                        | 52% → 52%                | 10% → 12%               | 86% → 85%                       | 0.76 → 0.73                   |
| draft-greedy  | 150       | 7 → 7            | 11% → 11%             | 72% → 71%                        | 52% → 49%                | 10% → 8%                | 86% → 90%                       | 0.76 → 0.82                   |
| aggressive    | 150       | 7 → 7            | 11% → 3%              | 72% → 69%                        | 52% → 53%                | 10% → 13%               | 86% → 87%                       | 0.76 → 0.91                   |
| white-35      | 150       | 7 → 6            | 11% → 5%              | 72% → 69%                        | 52% → 51%                | 10% → 14%               | 86% → 85%                       | 0.76 → 0.82                   |
| draft-heavy   | 150       | 7 → 7            | 11% → 6%              | 72% → 74%                        | 52% → 56%                | 10% → 11%               | 86% → 89%                       | 0.76 → 0.85                   |
| raise-never   | 150       | 7 → 6            | 11% → 11%             | 72% → 69%                        | 52% → 52%                | 10% → 13%               | 86% → 85%                       | 0.76 → 0.82                   |
| raise-always  | 150       | 7 → 7            | 11% → 12%             | 72% → 71%                        | 52% → 54%                | 10% → 13%               | 86% → 83%                       | 0.76 → 0.67                   |
| mate-45       | 150       | 7 → 7            | 11% → 11%             | 72% → 69%                        | 52% → 52%                | 10% → 10%               | 86% → 85%                       | 0.76 → 0.75                   |
| elo-150       | 150       | 7 → 8            | 11% → 8%              | 72% → 61%                        | 52% → 48%                | 10% → 19%               | 86% → 76%                       | 0.76 → 0.73                   |
| no-blocking   | 150       | 7 → 5            | 11% → 1%              | 72% → 65%                        | 52% → 55%                | 10% → 7%                | 86% → 89%                       | 0.76 → 0.85                   |
| high-blocking | 150       | 7 → 8            | 11% → 14%             | 72% → 65%                        | 52% → 46%                | 10% → 10%               | 86% → 89%                       | 0.76 → 0.68                   |
| no-accords    | 150       | 7 → 9            | 11% → 19%             | 72% → 81%                        | 52% → 39%                | 10% → 5%                | 86% → 92%                       | 0.76 → 0.84                   |
| elo-300       | 150       | 7 → 7            | 11% → 11%             | 72% → 53%                        | 52% → 40%                | 10% → 15%               | 86% → 77%                       | 0.76 → 0.65                   |
| waves-1       | 150       | 7 → 7            | 11% → 8%              | 72% → 67%                        | 52% → 51%                | 10% → 13%               | 86% → 86%                       | 0.76 → 0.74                   |
| mate-15       | 150       | 7 → 8            | 11% → 11%             | 72% → 73%                        | 52% → 48%                | 10% → 10%               | 86% → 84%                       | 0.76 → 0.76                   |
| time-3        | 150       | 7 → 6            | 11% → 6%              | 72% → 68%                        | 52% → 53%                | 10% → 10%               | 86% → 89%                       | 0.76 → 0.87                   |
| greedy        | 150       | 7 → ∞            | 11% → 56%             | 72% → 95%                        | 52% → 77%                | 10% → 5%                | 86% → 53%                       | 0.76 → 0.97                   |
| draw-4        | 150       | 7 → 7            | 11% → 11%             | 72% → 72%                        | 52% → 54%                | 10% → 10%               | 86% → 88%                       | 0.76 → 0.78                   |
| elo-star      | 150       | 7 → 7            | 11% → 9%              | 72% → 71%                        | 52% → 53%                | 10% → 12%               | 86% → 86%                       | 0.76 → 0.84                   |
| waves-3       | 150       | 7 → 8            | 11% → 12%             | 72% → 73%                        | 52% → 53%                | 10% → 14%               | 86% → 87%                       | 0.76 → 0.79                   |
| draw-12       | 150       | 7 → 7            | 11% → 11%             | 72% → 75%                        | 52% → 51%                | 10% → 8%                | 86% → 91%                       | 0.76 → 0.79                   |
| armageddon    | 150       | 7 → 6            | 11% → 8%              | 72% → 70%                        | 52% → 55%                | 10% → 9%                | 86% → 89%                       | 0.76 → 0.74                   |
| cautious      | 150       | 7 → 7            | 11% → 13%             | 72% → 67%                        | 52% → 50%                | 10% → 11%               | 86% → 86%                       | 0.76 → 0.65                   |
| time-0        | 150       | 7 → 7            | 11% → 13%             | 72% → 68%                        | 52% → 48%                | 10% → 13%               | 86% → 82%                       | 0.76 → 0.69                   |
| vp-10         | 150       | 7 → 7            | 11% → 11%             | 72% → 76%                        | 52% → 55%                | 10% → 10%               | 86% → 92%                       | 0.76 → 0.82                   |
| mate-denial   | 150       | 7 → 8            | 11% → 10%             | 72% → 73%                        | 52% → 49%                | 10% → 10%               | 86% → 86%                       | 0.76 → 0.78                   |

The findings survive every arm.

- **Game length.** The median win stays at round 5–9.
- **Campaign Veteran** is scored by 53–90% of players.
- **Secrets.** Battle secrets are completed 3–8 times as often as the rest.

Two things move the picture a lot.

- **Which secret players take.**
  - If they take the dealer's best fit, usually a region or route: the median win moves to round
    23, and 37% of campaigns stall.
  - If they pick at random: round 14, and 29% stall.

  The secret choice, more than anything else, sets how long a campaign lasts and whether it ends.

- **Players who ignore missions** (`greedy`) rarely finish: 42–56% stall.

At 2 players:

- **Stalls come from denial.** They vanish when nobody blocks (26% → 3%).
- **Accords matter.** Without them, stalls rise to 40%, because Backstab can't be done.

Chess itself matters little in aggregate. The share of mates, draws, White's edge and clock time
change none of the findings.

Ratings, of course, decide a lot:

| Scenario | Players | Campaigns | Win rate by rating, strongest first       | Fair share |
| -------- | ------- | --------- | ----------------------------------------- | ---------- |
| elo-150  | 4       | 150       | 38% · 33% · 13% · 7%                      | 25%        |
| elo-300  | 2       | 100       | 63% · 11%                                 | 50%        |
| elo-300  | 4       | 150       | 44% · 29% · 14% · 2%                      | 25%        |
| elo-300  | 8       | 100       | 25% · 28% · 16% · 22% · 4% · 2% · 1% · 0% | 13%        |
| elo-star | 4       | 150       | 51% · 11% · 13% · 15%                     | 25%        |

A player 300 points stronger wins half of all 4-player campaigns. That is what the rating handicaps
planned for Phase 6 are for.

### 8. What-ifs: fixes tried in the simulator

Each variant was played on the same seeds as the baseline (live, 150 campaigns per player count), so
the differences come from the change, not the dice. None of this touches the game; `packages/sim`
applies the change in the simulation only. The variants:

- **veteran-4:** Campaign Veteran needs 4 wins, 2 as attacker.
- **veteran-attacks:** only wins as attacker count.
- **won-position:** Strategic Positions, Great Connection, Regional Power, Mare Nostrum and
  Continental Bridge need at least one country of the position won since the draft.
- **battle-harder:** Checkmate Artist needs 3 mates and Nemesis 4 countries, and Backstab's strike
  must come in the round after the break.
- **iron-wall-4p:** Iron Wall is dealt only with 4 or more players.
- **region-easier:** named regions need one country fewer, Strait Keeper two straits, and Island
  Empire one island fewer.
- **connection-scaled:** Great Connection's endpoints move closer at bigger tables.
- **combined:** veteran-4, won-position, battle-harder and iron-wall-4p together.
- **to-win-8 / to-win-9 / combined-8:** 8 or 9 points to win.

Players: 2 / 3 / 4 / 6 / 8; live; 150 paired campaigns per cell.

| Variant           | Won by reaching 7            | Median round of those wins | Ended in rounds 15–25      | No winner by round 40       | Decided at the round-25 limit |
| ----------------- | ---------------------------- | -------------------------- | -------------------------- | --------------------------- | ----------------------------- |
| baseline          | 76% / 88% / 89% / 95% / 100% | 6 / 6 / 6 / 6 / 6          | 7% / 5% / 7% / 3% / 7%     | 24% / 12% / 11% / 5% / 0%   | –                             |
| veteran-4         | 79% / 87% / 92% / 96% / 100% | 6 / 7 / 6 / 7 / 6          | 7% / 4% / 7% / 7% / 3%     | 21% / 13% / 8% / 4% / 0%    | –                             |
| veteran-attacks   | 79% / 87% / 93% / 99% / 99%  | 7 / 7 / 7 / 7 / 6          | 7% / 10% / 9% / 8% / 3%    | 21% / 13% / 7% / 1% / 1%    | –                             |
| won-position      | 61% / 83% / 87% / 95% / 99%  | 8 / 8 / 8 / 6 / 6          | 7% / 11% / 8% / 6% / 6%    | 39% / 17% / 13% / 5% / 1%   | –                             |
| battle-harder     | 78% / 89% / 89% / 97% / 99%  | 7 / 7 / 7 / 6 / 7          | 8% / 10% / 11% / 11% / 3%  | 22% / 11% / 11% / 3% / 1%   | –                             |
| iron-wall-4p      | 84% / 93% / 89% / 95% / 100% | 6 / 6 / 6 / 6 / 6          | 7% / 5% / 7% / 3% / 7%     | 16% / 7% / 11% / 5% / 0%    | –                             |
| region-easier     | 76% / 89% / 88% / 96% / 99%  | 6 / 6 / 7 / 6 / 6          | 5% / 7% / 9% / 5% / 7%     | 24% / 11% / 12% / 4% / 1%   | –                             |
| connection-scaled | 76% / 88% / 89% / 99% / 99%  | 6 / 6 / 6 / 6 / 6          | 7% / 5% / 7% / 5% / 5%     | 24% / 12% / 11% / 1% / 1%   | –                             |
| to-win-9          | 54% / 57% / 56% / 46% / 43%  | 10 / 12 / 11 / 14 / 16     | 7% / 14% / 13% / 13% / 13% | 46% / 43% / 44% / 54% / 57% | –                             |
| combined          | 73% / 90% / 92% / 95% / 99%  | 11 / 9 / 8 / 8 / 7         | 17% / 14% / 12% / 13% / 5% | 27% / 10% / 8% / 5% / 1%    | –                             |
| combined-8        | 18% / 30% / 31% / 34% / 41%  | 18 / 20 / 17 / 20 / 19     | 7% / 10% / 12% / 9% / 14%  | 82% / 70% / 69% / 66% / 59% | –                             |
| to-win-8          | 61% / 52% / 55% / 45% / 40%  | 9 / 11 / 11 / 15 / 14      | 9% / 11% / 11% / 16% / 11% | 39% / 48% / 45% / 55% / 60% | –                             |

What this shows:

- **No single number fixes the pace.** Each change moves the median win by a round or two at most,
  and all four together only move it from round 6 to rounds 7–11. There are too many cheap routes
  to 7: taking one away leaves the others.
- **Raising the points to win is the wrong lever.** Needing 8 or 9 points means scoring a third or
  fourth public mission, or three plus the secret. With several missions nearly dead, that breaks
  down: half of all campaigns never finish.
- **Iron Wall only from 4 players cuts small-table stalls a third** (24% → 16% at 2 players, 12% → 7%
  at 3) and costs nothing else.
- **Won positions stop the draft handing out points.** Strategic Positions at 2 players falls from
  53% of players to 6%, and Great Connection from 25% to 1%. On its own it makes small tables stall
  more (39% at 2 players), because those missions become hard to finish at all.

**Packages.** The single fixes don't add up to the target, so several were tried together.

- **v3:** the mild package.
  - Campaign Veteran needs 4 wins, 2 as the attacker, and positions need a won country.
  - The battle secrets are harder (`battle-harder`), and Iron Wall is dealt only from 4 players.
  - Named regions are easier (`region-easier`).
  - Great Connection is closer at 5 or more players. Mare Nostrum needs 9 countries (2 per shore),
    Regional Power half the region's value, and Across the Seas 2 attacks.
  - Kingslayer counts only against a player 2 or more points ahead.
  - Great Expanse needs 12 million km², One Billion 1.5 billion people, and Great Powers all three
    won.
- **v3s:** the strong package, which roughly doubles every quick mission:
  - Campaign Veteran needs 6 wins: 3 as the attacker, against 3 opponents.
  - Expansion needs +25. Two Fronts needs 3 countries per continent. Lightning Campaign needs 3
    wars.
  - Checkmate Artist needs 3 mates, Nemesis 4 countries and Iron Wall 3 wins. Backstab needs 2
    countries in the round after the break.
  - It keeps the rest of v3.
- **`-slow`:** a war token every other round.
- **`-25`:** the campaign ends after round 25, and the most points win (then map value). This is
  the "fixed-length season" the plan already names.

Against the default missions:

Players: 2 / 3 / 4 / 6 / 8; live; 150 paired campaigns per cell.

| Variant        | Won by reaching 7            | Median round of those wins | Ended in rounds 15–25       | No winner by round 40     | Decided at the round-25 limit |
| -------------- | ---------------------------- | -------------------------- | --------------------------- | ------------------------- | ----------------------------- |
| baseline       | 76% / 88% / 89% / 95% / 100% | 6 / 6 / 6 / 6 / 6          | 7% / 5% / 7% / 3% / 7%      | 24% / 12% / 11% / 5% / 0% | –                             |
| v3             | 78% / 93% / 89% / 96% / 100% | 11 / 9 / 8 / 7 / 7         | 17% / 12% / 13% / 10% / 7%  | 22% / 7% / 11% / 4% / 0%  | –                             |
| v3s            | 60% / 81% / 78% / 93% / 96%  | 13 / 12 / 12 / 10 / 10     | 17% / 24% / 19% / 17% / 18% | 40% / 19% / 22% / 7% / 4% | –                             |
| v3s-25         | 53% / 74% / 65% / 85% / 92%  | 11 / 11 / 10 / 9 / 9       | 64% / 50% / 54% / 31% / 26% | 0% / 0% / 0% / 0% / 0%    | 47% / 26% / 35% / 15% / 8%    |
| v3-25          | 70% / 86% / 83% / 93% / 99%  | 10 / 9 / 8 / 7 / 7         | 47% / 26% / 29% / 17% / 7%  | 0% / 0% / 0% / 0% / 0%    | 30% / 14% / 17% / 7% / 1%     |
| tokens-every-2 | 69% / 77% / 83% / 93% / 98%  | 9 / 9 / 9 / 9 / 7          | 11% / 13% / 14% / 12% / 7%  | 31% / 23% / 17% / 7% / 2% | –                             |
| v3-slow        | 63% / 83% / 83% / 93% / 98%  | 14 / 13 / 13 / 11 / 9      | 23% / 26% / 27% / 23% / 19% | 37% / 17% / 17% / 7% / 2% | –                             |
| v3-slow-25     | 55% / 73% / 76% / 87% / 94%  | 13 / 11 / 11 / 11 / 9      | 68% / 53% / 51% / 35% / 25% | 0% / 0% / 0% / 0% / 0%    | 45% / 27% / 24% / 13% / 6%    |

Against public missions drawn at random:

Players: 2 / 3 / 4 / 6 / 8; live; 150 paired campaigns per cell.

| Variant       | Won by reaching 7           | Median round of those wins | Ended in rounds 15–25       | No winner by round 40       | Decided at the round-25 limit |
| ------------- | --------------------------- | -------------------------- | --------------------------- | --------------------------- | ----------------------------- |
| random        | 74% / 92% / 88% / 95% / 90% | 7 / 7 / 8 / 7 / 7          | 11% / 5% / 11% / 15% / 15%  | 26% / 8% / 12% / 5% / 10%   | –                             |
| v3-random     | 67% / 81% / 87% / 92% / 90% | 12 / 10 / 10 / 10 / 10     | 17% / 14% / 19% / 21% / 19% | 33% / 19% / 13% / 8% / 10%  | –                             |
| v3s-25-random | 51% / 65% / 61% / 72% / 73% | 12 / 12 / 11 / 11 / 11     | 65% / 58% / 61% / 51% / 51% | 0% / 0% / 0% / 0% / 0%      | 49% / 35% / 39% / 28% / 27%   |
| v3s-random    | 59% / 73% / 74% / 87% / 89% | 12 / 13 / 13 / 13 / 13     | 17% / 23% / 22% / 23% / 25% | 41% / 27% / 26% / 13% / 11% | –                             |

What this shows:

- **Balancing the missions slows the race, but not to 15–25.**
  - Among campaigns won by reaching 7, the mild package moves the median from round 6 to 7–11.
    The strong one moves it to 10–13, or 12–13 with random missions.
  - Every threshold added also makes some campaigns unfinishable at small tables. The strong
    package leaves 40% of 2-player campaigns without a winner.
- **Fewer wars per round lengthens a campaign in rounds, but not in proportion.** A token every
  other round takes the baseline's median win from round 6 to 7–9. The mild package with it
  reaches 9–14.
- **A round limit ends the stalls, and puts most campaigns in the window.**
  - With the strong package, or the mild one and a slower tempo, 25–68% of campaigns end in rounds
    15–25, depending on table size. No campaign is left without a winner.
  - At 2 players about half are then decided at the limit, on points.
- **Pricing secrets by effort overshoots.** With battle secrets worth 2 points and every other
  secret 4:
  - Battle secret holders fall from 1.8–2.5 times a fair chance of winning to 0.5–0.75.
  - Protected Expansion becomes the strongest (2.4).
  - Region and route secrets barely change, since they're still rarely completed.
  - 57% of 2- and 3-player campaigns then never finish.

**Public mission fixes.** These were tried on the missions they affect: the four quickest (Kingslayer,
Great Expanse, One Billion, Great Powers) and four of the rarely scored, each set played to round
25 on the same seeds. The share of players scoring each mission:

| Mission          | Change tried                                           | 2 players | 4 players | 6–8 players |
| ---------------- | ------------------------------------------------------ | --------- | --------- | ----------- |
| Kingslayer       | The leader is judged on points, 2 or more ahead of you | 96% → 65% | 98% → 91% | 96% → 93%   |
| Kingslayer       | On points, 4 or more ahead of you                      | 96% → 38% | 98% → 72% | 96% → 81%   |
| Great Expanse    | 12 million km²                                         | 68% → 53% | 70% → 60% | 60% → 48%   |
| Great Expanse    | At least 3 countries won                               | 68% → 66% | 70% → 67% | 60% → 57%   |
| Great Expanse    | 20 million km²                                         | 68% → 32% | 70% → 34% | 60% → 28%   |
| One Billion      | 1.5 billion people                                     | 37% → 37% | 44% → 37% | 33% → 29%   |
| One Billion      | 2 billion people                                       | 37% → 20% | 44% → 17% | 33% → 15%   |
| Great Powers     | All three won since the draft                          | 65% → 39% | 54% → 31% | 40% → 22%   |
| Across the Seas  | Two attacks across sea lanes, not three                | 5% → 24%  | 13% → 44% | 17% → 47%   |
| Great Connection | Endpoints 4–7 apart at 5–6 players, 3–5 at 7–8         | 20% → 19% | 5% → 5%   | 1% → 3%     |
| Mare Nostrum     | 9 countries, 2 per shore                               | 30% → 38% | 9% → 12%  | 1% → 5%     |
| Regional Power   | Half the region's value                                | 50% → 54% | 24% → 32% | 14% → 17%   |

- **Great Powers and Across the Seas respond well.**
- **Kingslayer needs a real deficit to mean anything.** Even at 4 points behind, three players in
  four score it at 4 or more players: the whole table gangs up on whoever leads.
- **Great Expanse and One Billion need much bigger numbers.** At 12 million km² or 1.5 billion
  people a single giant still covers most of the ground, and asking for three won countries does
  nothing: by mid-game everyone has three.
  - At 20 million km², Great Expanse falls to about a third of players, around round 11.
  - At 2 billion people, One Billion falls to 15–20%, around round 14.
- **Great Connection and Mare Nostrum stay dead at big tables** whatever their numbers: a chain or
  set strung across several empires is broken before it can be held.

## Version 3, as built

_Added 29 September 2026. Mission rules version 3 carries the recommendations above, all but the
slower war tokens (12). Where the report left a choice open, the user chose. The same bots played
it on the same map, as new campaigns play it: version 3, with a last round of 25 unless stated.
5,110 campaigns for the results below, and 5,600 more for the tuning._

### What was built, and where it differs from the recommendations

| #   | Recommendation                                          | Version 3                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Campaign Veteran: attack wins only, 4 to 6, 3 opponents | Four wars won as the attacker, against three different opponents (or all there are). Wins as the defender count for nothing, opponents included                                                                                                                                                             |
| 2   | Kingslayer on points, 4 behind                          | The war must be declared on the leader on points while they're four or more ahead. The what-if counted anyone four ahead                                                                                                                                                                                    |
| 3   | Giants                                                  | As recommended: Great Expanse 20 million km², One Billion 2 billion people (shown as "Two Billion"), Great Powers all three won                                                                                                                                                                             |
| 4   | Across the Seas                                         | As recommended: two attacks                                                                                                                                                                                                                                                                                 |
| 5   | Positions need a conquest                               | As recommended. For The Great Connection, the chain itself must pass through a country won since the draft; for Continental Bridge, the block must hold one                                                                                                                                                 |
| 6   | Iron Wall from 4 players                                | As recommended                                                                                                                                                                                                                                                                                              |
| 7   | Battle secrets                                          | Checkmate Artist 3 mates, Nemesis 4 countries, Iron Wall 3 wins, as recommended. **Backstab: two countries within the next two rounds**, not the round after the break (see below)                                                                                                                          |
| 8   | Region and route secrets                                | The user chose fewer targets, tuned in the simulator: named seas and regions need half their countries (at least two), Mountain Kingdom and Hidden Triangle two of three, Strait Keeper one strait, Island Empire three islands; the ones counted by targets are **revealed only once complete**. See below |
| 9   | Great Connection and Mare Nostrum up to 4 players       | As recommended; the draft can't start with them at 5 or more. **Great Powers replaces The Great Connection in the default set** (the user's call)                                                                                                                                                           |
| 10  | At most one hard mission per random draw                | As recommended. The public missions marked Long campaign are those scored by a fifth of players or fewer below (Continental Bridge at 5 or more players); five secrets are marked too (see below)                                                                                                           |
| 11  | A season length                                         | A host setting, on for new campaigns at round 25 (15, 20, 30 or none). After the last round the most points win, then the most valuable empire (since 2026-10-02: the largest population, then land area, then GDP); claims still waiting don't count                                                       |
| 12  | Slower war tokens                                       | Not built, at the user's request                                                                                                                                                                                                                                                                            |

**Tuning the secrets.** Three rounds of the `secrets` scenario (every player assigned a kind
that fits them, 3, 5 and 7 players, 200 seeds) settled 7 and 8:

- **Backstab.** Two countries in the round after the break was completed 5% of the time, and its
  holder won 0.4 of a fair share. Two countries within the next two rounds: about a third, and
  1.0–1.2.
- **Named seas and regions.** With one country fewer (the report's first idea) they were
  completed 9% of the time. Two changes did more, each lifting that to 12–13% and both together
  to about 20%, with a fair share of wins:
  - half the countries, which gives a choice of which to take;
  - no reveal one short: rivals saw the last step coming and took it back. Revealed only when
    complete, 60–95% of those completed go on to score.

- **Routes and rings.** Hidden Triangle (two of three, closer targets) and Strait Keeper (one
  strait) reach 13–20%. The chains (Silk Road, Cape to Cairo, Pan-American Highway), Encirclement
  and Unification stay at 0–6% whatever the numbers: a chain or a ring can't be made shorter.
  - Dealing only nearby routes and regions, and rings of three for Encirclement, were tried and
    dropped. Completion didn't move, and they looked cheap, so players chose them and rarely
    finished them.
  - The five are now marked Long campaign, so players see what they're choosing.

### Results

**Pace.** Live / correspondence, 2–8 players, 100 campaigns per cell (version 2's baseline
figures, from [the first table](#1-campaigns-end-far-too-soon-or-at-23-players-sometimes-never),
in brackets):

| Players | Median win round | Won by round 5       | Won in rounds 15–25  | Won on points after round 25 |
| ------- | ---------------- | -------------------- | -------------------- | ---------------------------- |
| 2       | 16 / 20 (8 / 9)  | 4% / 0% (37% / 28%)  | 55% / 61% (7% / 9%)  | 27% / 37%                    |
| 3       | 11 / 15 (8 / 9)  | 4% / 0% (37% / 21%)  | 32% / 54% (9% / 12%) | 15% / 29%                    |
| 4       | 13 / 17 (6 / 9)  | 4% / 2% (39% / 25%)  | 42% / 63% (7% / 11%) | 17% / 26%                    |
| 5       | 11 / 15 (7 / 8)  | 1% / 1% (36% / 21%)  | 32% / 53% (7% / 11%) | 14% / 27%                    |
| 6       | 9 / 13 (6 / 8)   | 6% / 1% (39% / 21%)  | 24% / 40% (7% / 12%) | 7% / 11%                     |
| 7       | 10 / 13 (6 / 8)  | 10% / 2% (48% / 23%) | 24% / 44% (4% / 9%)  | 4% / 11%                     |
| 8       | 9 / 12 (6 / 8)   | 7% / 1% (47% / 21%)  | 19% / 33% (6% / 8%)  | 6% / 8%                      |

- Hardly anything is won by round 5 any more, and every campaign ends by round 25.
- At 2–5 players a third to a half of live campaigns, and 53–63% of correspondence ones, end in
  rounds 15–25.
- **Live campaigns at 6–8 players are still decided around round 9–10.** The slower war tokens were
  the lever for that; without them, a bigger table simply fights more wars per round.

**Without a last round** (the host's "No last round"; live, 100 campaigns per player count;
version 2 in brackets):

| Players | Median win round | Won in rounds 15–25 | No winner by round 40 |
| ------- | ---------------- | ------------------- | --------------------- |
| 2       | 13 (8)           | 28% (7%)            | 14% (27%)             |
| 3       | 10 (8)           | 17% (9%)            | 10% (18%)             |
| 4       | 12 (6)           | 25% (7%)            | 10% (10%)             |
| 5       | 10 (7)           | 18% (7%)            | 6% (8%)               |
| 6       | 9 (6)            | 17% (7%)            | 2% (4%)               |
| 7       | 10 (6)           | 20% (4%)            | 1% (1%)               |
| 8       | 9 (6)            | 13% (6%)            | 2% (1%)               |

The missions alone add three or four rounds and halve the stalls at 2–3 players; the last round
does the rest.

**Public missions** (drawn at random, played to round 25, 80 seeds per player count; share of
players scoring each):

| Public mission            | 2 players | 3–4 players | 5–6 players | 7–8 players | Median round scored | Version 2 (%)     |
| ------------------------- | --------- | ----------- | ----------- | ----------- | ------------------- | ----------------- |
| Campaign Veteran          | 100%      | 71%         | 88%         | 89%         | 9                   | 96 / 93 / 97 / 98 |
| Two Fronts                | 48%       | 74%         | 71%         | 70%         | 9                   | 57 / 71 / 74 / 68 |
| Lightning Campaign        | 54%       | 63%         | 64%         | 70%         | 10                  | 57 / 65 / 71 / 76 |
| Kingslayer                | 37%       | 49%         | 72%         | 66%         | 10                  | 90 / 97 / 98 / 95 |
| Expansion                 | 58%       | 53%         | 51%         | 54%         | 7                   | 53 / 50 / 47 / 45 |
| Across the Seas           | 21%       | 46%         | 47%         | 56%         | 11                  | 10 / 15 / 16 / 16 |
| Continental Bridge        | 86%       | 61%         | 36%         | 18%         | 5                   | 90 / 63 / 32 / 16 |
| Great Expanse             | 33%       | 32%         | 31%         | 25%         | 12                  | 63 / 70 / 64 / 55 |
| Great Powers              | 46%       | 39%         | 23%         | 21%         | 13                  | 57 / 51 / 42 / 33 |
| Two Billion (One Billion) | 14%       | 19%         | 16%         | 13%         | 13                  | 33 / 36 / 31 / 29 |
| Seven Wonders             | 18%       | 18%         | 15%         | 10%         | 14                  | 18 / 15 / 10 / 7  |
| Regional Power            | 13%       | 14%         | 9%          | 8%          | 9                   | 52 / 30 / 17 / 12 |
| Strategic Positions       | 9%        | 18%         | 9%          | 6%          | 8                   | 56 / 29 / 16 / 10 |
| The Great Connection      | 14%       | 5%          | –           | –           | 9                   | 23 / 6 / 2 / 1    |
| Mare Nostrum              | 14%       | 3%          | –           | –           | 17                  | 33 / 13 / 3 / 1   |

- Campaign Veteran is still the most scored, but from round 9 instead of 4. In campaigns played to
  a win (the baseline above), 55% of players score it at 3 or more (63–76% in version 2).
- Positions no longer come from the draft: no mission scored from drafted positions in any run.
- Kingslayer now needs a real deficit: 37% of players score it at 2 players, 49–72% at more.
- Continental Bridge is still quick at 2–3 players, where a won country anywhere in the drafted
  block is enough.

**Secret missions** (each player assigned a kind that fits them, 2–8 players, 150 seeds):

| Family    | Holders | Completed | Holder wins, × fair share (95% CI) |
| --------- | ------- | --------- | ---------------------------------- |
| Battle    | 760     | 45%       | 1.50 (1.34–1.67)                   |
| Expansion | 427     | 16%       | 0.94 (0.77–1.15)                   |
| Region    | 2617    | 18%       | 1.01 (0.93–1.09)                   |
| Route     | 1446    | 7%        | 0.77 (0.68–0.86)                   |

| Secret mission       | Family    | Holders | Completed | Holder wins, × fair share (95% CI) | Version 2: completed, × fair share |
| -------------------- | --------- | ------- | --------- | ---------------------------------- | ---------------------------------- |
| Nemesis              | battle    | 177     | 53%       | 1.88 (1.54–2.24)                   | 80%, 2.32                          |
| Checkmate Artist     | battle    | 200     | 60%       | 1.79 (1.48–2.11)                   | 80%, 2.22                          |
| Iron Wall            | battle    | 148     | 28%       | 1.39 (1.02–1.84)                   | 28%, 0.84                          |
| Pacific Passage      | region    | 128     | 20%       | 1.27 (0.92–1.69)                   | 8%, 0.37                           |
| Mekong               | region    | 204     | 20%       | 1.22 (0.97–1.52)                   | 8%, 0.35                           |
| Half of Humanity     | expansion | 48      | 8%        | 1.16 (0.60–2.06)                   | 15%, 1.04                          |
| Protected Expansion  | expansion | 145     | 29%       | 1.16 (0.82–1.59)                   | 40%, 1.77                          |
| Caspian              | region    | 165     | 24%       | 1.13 (0.84–1.48)                   | 12%, 0.51                          |
| Black Sea            | region    | 180     | 21%       | 1.13 (0.84–1.47)                   | 5%, 0.25                           |
| Horn of Africa       | region    | 196     | 28%       | 1.11 (0.86–1.42)                   | 4%, 0.17                           |
| Mediterranean Arc    | region    | 170     | 22%       | 1.09 (0.81–1.43)                   | 3%, 0.20                           |
| Strait Keeper        | route     | 230     | 13%       | 1.08 (0.85–1.36)                   | 1%, 0.14                           |
| Buffer Zone          | region    | 108     | 13%       | 1.04 (0.68–1.53)                   | 11%, 0.50                          |
| Northern Passage     | region    | 177     | 12%       | 1.03 (0.76–1.36)                   | 3%, 0.24                           |
| Backstab             | battle    | 235     | 36%       | 1.03 (0.80–1.30)                   | 73%, 1.82                          |
| Nordic               | region    | 134     | 18%       | 0.99 (0.70–1.38)                   | 6%, 0.25                           |
| Baltic League        | region    | 158     | 18%       | 0.98 (0.71–1.32)                   | 11%, 0.52                          |
| Hidden Triangle      | route     | 275     | 20%       | 0.98 (0.78–1.21)                   | 4%, 0.21                           |
| Central Asian Union  | region    | 221     | 22%       | 0.95 (0.73–1.23)                   | 11%, 0.46                          |
| Island Empire        | region    | 142     | 14%       | 0.90 (0.60–1.31)                   | 13%, 0.61                          |
| Mountain Kingdom     | region    | 189     | 17%       | 0.86 (0.63–1.15)                   | 4%, 0.19                           |
| Caribbean Chain      | region    | 164     | 9%        | 0.82 (0.58–1.14)                   | 2%, 0.19                           |
| Two-Theater Power    | expansion | 234     | 10%       | 0.81 (0.60–1.06)                   | 12%, 0.63                          |
| Gulf Hegemon         | region    | 193     | 9%        | 0.77 (0.55–1.05)                   | 5%, 0.21                           |
| Cape to Cairo        | route     | 238     | 0%        | 0.75 (0.56–1.00)                   | 2%, 0.09                           |
| Andean Spine         | region    | 88      | 3%        | 0.73 (0.43–1.20)                   | 8%, 0.32                           |
| Silk Road            | route     | 163     | 6%        | 0.60 (0.39–0.91)                   | 7%, 0.36                           |
| Encirclement         | route     | 229     | 1%        | 0.60 (0.42–0.83)                   | 2%, 0.13                           |
| Unification          | route     | 167     | 1%        | 0.55 (0.35–0.84)                   | 4%, 0.23                           |
| Pan-American Highway | route     | 144     | 3%        | 0.49 (0.29–0.81)                   | 2%, 0.09                           |

- Battle secrets went from 1.8–2.3 times a fair share to 1.5, and winners holding one from 83–89%
  to 30–46%.
- Region secrets went from about half a fair share to a fair one.
- **Still uneven:** Nemesis and Checkmate Artist remain the strongest single kinds (1.8–1.9), and
  the chains and rings (Pan-American Highway, Unification, Encirclement, Silk Road, Cape to Cairo)
  are almost never done. Retiring or redesigning those five, and one more step on the two battle
  secrets, are the obvious next moves; the playtest should say whether humans agree with the bots.

**Random public missions** (live, 100 campaigns per player count). A draw now takes at most one
mission marked Long campaign; 92% of draws take exactly one:

| Players | Median win round | Won in rounds 15–25 | Won on points after round 25 | No winner by round 40, without a last round (version 2) |
| ------- | ---------------- | ------------------- | ---------------------------- | ------------------------------------------------------- |
| 2       | 18               | 59%                 | 43%                          | 24% (26%)                                               |
| 3       | 13               | 46%                 | 20%                          | 14% (8%)                                                |
| 4       | 14               | 46%                 | 28%                          | 11% (12%)                                               |
| 5       | 12               | 36%                 | 13%                          | 7% (–)                                                  |
| 6       | 11               | 34%                 | 11%                          | 4% (5%)                                                 |
| 7       | 10               | 32%                 | 8%                           | 3% (–)                                                  |
| 8       | 12               | 37%                 | 6%                           | 2% (10%)                                                |

Limiting the draw doesn't end the stalls at small tables by itself: without a last round a random
draw still leaves 14–24% of 2- and 3-player campaigns without a winner. The last round does.

## War answers, revised

_Added 29 September 2026. The report found that a defender gains by raising whatever happens (the
attacker withdraws, or fights for a bigger stake), that the free raise crowds out tribute, and that
nothing lets either side out of a war. New campaigns now play revised answers, all host settings:
a matched raise (the defender puts in a country worth 50–100% of the target, which the attacker
must match), redirects only next to the target that cost a token and keep the first target's
clock, reserves that meet a raise at once, fortifying for a token, calling a declaration off, and
peace terms in place of tribute. Campaigns stored before keep the original answers._

The same bots on the same seeds: live, mission rules version 3 with a last round of 25, 200
campaigns per cell, players 2 / 4 / 6.

| War answers                    | Raised        | Redirected    | Tribute or peace | Withdrawn    | Net value to the attacker per declaration | Median win round | Won on points |
| ------------------------------ | ------------- | ------------- | ---------------- | ------------ | ----------------------------------------- | ---------------- | ------------- |
| Original (free raise, tribute) | 39 / 40 / 42% | 39 / 24 / 16% | 1 / 3 / 4%       | 13 / 10 / 8% | 0.16 / 0.12 / 0.07                        | 11 / 12 / 10     | 24 / 17 / 9%  |
| Revised (matched raise)        | 22 / 22 / 25% | 0 / 0 / 0%    | 1 / 1 / 1%       | 3 / 3 / 4%   | 1.17 / 0.84 / 0.67                        | 11 / 11 / 9      | 25 / 19 / 6%  |
| Revised, raise for a token     | 9 / 8 / 7%    | 0 / 0 / 0%    | 1 / 1 / 2%       | 0 / 0 / 0%   | 0.87 / 0.65 / 0.61                        | 12 / 12 / 10     | 29 / 23 / 14% |
| Revised, no raise, 100% floor  | 0 / 0 / 0%    | 1 / 0 / 0%    | 1 / 2 / 2%       | 0 / 0 / 0%   | 0.77 / 0.50 / 0.45                        | 11 / 11 / 9      | 29 / 14 / 7%  |

- **Attacking pays again.** Land per declaration rises five- to tenfold, and far fewer declarations
  are wasted on a withdrawal.
- **A matched raise is a bet, not a veto.** It still answers about a quarter of declarations, mostly
  with a country near the 50% floor: the attacker matches with whole countries and overshoots by
  about 1.4 on average, which leaves the defender a small edge. With no floor the bots put in
  countries worth 1 and raised 38% of declarations (in a check across every table size); the
  floor is the lever if the playtest finds raising still too attractive.
- **Redirects nearly vanish.** Few countries worth the same as the target also border it and the
  attacker; with a token on top, the bots all but stop redirecting. Letting redirects reach anywhere
  (a host setting) brings them back.
- **Pace doesn't move**, and nobody is eliminated in any setting: the missions set the length of a
  campaign. The bots hardly ever fortify (at most once in ten campaigns), and settle about one war
  in a hundred by peace terms, as tribute-like offers with a two-round accord.

To rerun: `pnpm sim --scenario baseline,whatif:original-answers --players 2-8 --paces live --seeds 200`
(also `whatif:raise-token` and `whatif:raise-off`).

## Declaring in turns

_Added 30 September 2026. Players could declare whenever they liked, so whoever acted first when a
round began took the best targets and tied up the countries around them: scripted players declared
before anyone else had looked. New campaigns now take turns (`rules.war.turns`): one declaration
or fortification a turn, round the table in an order that moves on a seat each round, until
everyone has passed; campaigns stored before keep declaring freely. The simulator plays turns as
its baseline now; `whatif:no-turns` is the old way._

The same bots on the same seeds: mission rules version 3 with a last round of 25, 100 campaigns
per cell, players 2 / 4 / 6 / 8.

| Pace, declaring                   | Declarations per player-round | Raised             | Attacker wins the game | Median win round  | Won on points      |
| --------------------------------- | ----------------------------- | ------------------ | ---------------------- | ----------------- | ------------------ |
| Live, in turns                    | 0.96 / 0.95 / 0.92 / 0.92     | 22 / 22 / 24 / 26% | 50 / 50 / 50 / 49%     | 13 / 14 / 10 / 9  | 22 / 24 / 9 / 3%   |
| Live, whenever you like           | 0.96 / 0.93 / 0.93 / 0.92     | 22 / 22 / 25 / 26% | 51 / 51 / 50 / 50%     | 12 / 13 / 9 / 9   | 27 / 14 / 3 / 2%   |
| Correspondence, in turns          | 0.98 / 0.95 / 0.95 / 0.93     | 24 / 23 / 24 / 25% | 50 / 50 / 50 / 49%     | 24 / 16 / 12 / 12 | 45 / 27 / 14 / 8%  |
| Correspondence, whenever you like | 0.98 / 0.95 / 0.95 / 0.94     | 22 / 22 / 24 / 25% | 50 / 50 / 49 / 49%     | 20 / 16 / 14 / 13 | 40 / 20 / 20 / 10% |

- **The game is the same game.** The bots declare as often, raise as often and win as often; the
  median round a campaign is won in and the share ended on points move by a round or a few points
  either way, within what 100 campaigns can tell apart.
- **What turns fix, the simulator can't show.** Its bots never race: declaring whenever they like,
  they go in a random order each round, which is fair on average. At a real table the quickest
  player goes first every round. Turns make the order a rotation, so each seat goes first equally
  often.
- **A round takes longer to declare.** Turns are serial: at 24 hours a turn in correspondence, a
  table that dawdles can spend days declaring. The host can pass a turn for someone who is away,
  and silence passes it when the time runs out.

To rerun: `pnpm sim --scenario baseline,whatif:no-turns --players 2-8 --seeds 100 --out turns`, then
`pnpm sim:report turns --compare baseline`.

## A 1–20 value curve

_Added 2 October 2026, and adopted the same day: new campaigns play dataset `2026.2` with mission
rules version 4. Country values ran 1 to 10, given out by rank, so a superpower (10) was worth
about three median countries (3–4). The new curve makes it five or six: the same scores
(`values.yaml` weights) ranked against 1–20, with the two superpowers at 20, the next seven at
15–18 and the bottom half barely moved. The world's total value goes from 718 to 928 (×1.29).
The first runs below tried the curve in the simulator before it was adopted; the last checks it as
built._

Since every war rule compares one value to another (a stake of 80%, a raise of 125%), doubling
every value would change nothing. The shape is what matters. Mission numbers that add up value
(Expansion, Regional Power, Two Theater, Measured Expansion) are scaled by the total, single-country
bands move tier to tier, and Great Powers counts countries worth 13 or more (today's set less
Turkey). The trial ran them as mission rules 103. The bots' value units (`vpValue`, the declaring
thresholds, `betrayMargin`) are scaled by 1.29 as well; in the trial their worth of a war token
stayed at 1.

The same bots on the same seeds, 2–8 players, live and correspondence, 300 seeds each (4,200
campaigns a curve):

| All tables                                                | 1–10 today  | 1–20        |
| --------------------------------------------------------- | ----------- | ----------- |
| Median win round                                          | 12          | 12          |
| Won on points at the last round                           | 17%         | 14%         |
| Declarations per player per round                         | 0.94        | 0.94        |
| Defender raises                                           | 24%         | 22%         |
| Attacker wins (of games)                                  | 55%         | 55%         |
| Value changing hands per campaign (% of world)            | 54%         | 66%         |
| Great-power transfers per campaign (14 worth 8+ today)    | 15.4        | 16.5        |
| Campaigns where China or the US changes hands             | 88%         | 94%         |
| Win rate of the richest draft (1.00 = fair)               | 1.03        | 1.10        |
| Win rate of whoever drafted China or the US (1.00 = fair) | 0.99        | 1.01        |
| First pick / last pick win rate (1.00 = fair)             | 1.00 / 1.05 | 1.01 / 1.00 |
| Biggest empire at the end (% of world)                    | 32%         | 34%         |

- **Each war is worth more; the game isn't longer.** Bots declare, raise and win the chess as
  often. About a fifth more of the world's value changes hands, because the countries won and lost
  are worth more.
- **Superpowers are not out of reach.** A target worth 20 needs a stake of 16, but the bots still
  take China or the US in 94% of campaigns. People may hold their great powers back more than
  bots, which value countries consistently.
- **A strong draft seemed to count a little more, at four players most clearly.** The richest
  drafter won 1.10 times a fair share, against 1.03 today; at four players 1.30 against 1.06. Other
  table sizes moved both ways by more than their noise (about ±0.14). As built it didn't hold up
  (below). Draft order stays fair.
- **Redirects were already gone.** The steep top leaves fewer countries of each value to redirect
  to, but with nearby redirects that cost a token (the default) bots almost never redirect on
  either curve.
- **Expansion needs +22, not the scaled +19.** Value gained comes mostly from the top countries,
  which grew more than the total. Other missions stay within noise of today.

Expansion's gain, on the first 150 of those seeds (2,100 campaigns each):

| Players scoring Expansion | 1–10 today (+15) | 1–20, +19 | 1–20, +21 | 1–20, +22 |
| ------------------------- | ---------------- | --------- | --------- | --------- |
| All tables                | 37.1%            | 41.9%     | 39.4%     | 38.3%     |
| 2 players                 | 50.2%            | 54.8%     | 51.3%     | 49.8%     |
| 3–4 players               | 43.9%            | 47.6%     | 46.5%     | 46.3%     |
| 5–6 players               | 36.5%            | 42.8%     | 39.4%     | 37.1%     |
| 7–8 players               | 32.5%            | 37.0%     | 34.6%     | 34.0%     |
| Won on points             | 17.1%            | 13.9%     | 14.9%     | 16.7%     |

At +22 the share ended on points also returns to today's.

**As built.** Dataset `2026.2`, mission rules version 4 (the trial's numbers with Expansion at
+22), and the bots' value knobs scaled by 1.29, the worth of a war token now among them
(`knobsFor`). Against `values-10`, which plays `2026.1` with version 3 as campaigns created before
do, on the first 150 seeds (2,100 campaigns each):

| All tables                                                | 1–10 (`values-10`) | 1–20 as built |
| --------------------------------------------------------- | ------------------ | ------------- |
| Median win round                                          | 12                 | 12            |
| Won on points at the last round                           | 17%                | 17%           |
| Declarations per player per round                         | 0.94               | 0.94          |
| Defender raises                                           | 24%                | 21%           |
| Attacker wins (of games)                                  | 54%                | 55%           |
| Value changing hands per campaign (% of world)            | 54%                | 68%           |
| Campaigns where China or the US changes hands             | 89%                | 94%           |
| Win rate of the richest draft (1.00 = fair)               | 1.05               | 1.04          |
| Win rate of whoever drafted China or the US (1.00 = fair) | 1.01               | 0.99          |
| First pick / last pick win rate (1.00 = fair)             | 1.01 / 1.03        | 1.01 / 1.05   |
| Players scoring Expansion                                 | 37.1%              | 38.3%         |

Every mission is scored about as often as on 1–10 (within a point; Expansion 3–4 players about two
points more), and so are the secret missions. `values-10` plays the same campaigns as the 1–10 runs
above, seed for seed. The four-player edge of the richest draft in the first run (1.30) isn't
there (1.07, as on 1–10): it was noise.

To rerun: `pnpm sim --scenario baseline,values-10 --players 2-8 --paces live,correspondence --seeds 150 --out values`,
then `pnpm sim:report values --missions`. The trial's scenarios are gone; `--dataset 2026.1`
replays anything on the old values.

## Higher stakes

_Added 4 October 2026, and adopted the same day: new campaigns need a stake of at least 110% of the
target (from 80%), and 150% against a fortified country (from 125%). A declared war is hard to
get out of, so declaring should cost more; campaigns stored before keep 80% and 125%. The
simulator plays the new stakes as its baseline now; `whatif:original-stakes` plays the old ones,
and `whatif:stake-80`, `stake-100`, `stake-120` and `fortify-125` vary one number._

The same bots on the same seeds: mission rules version 4, dataset 2026.2, a last round of 25,
live, 200 campaigns per table size from 2 to 8, shown as 2–3 / 4–5 / 6–8 players. The 110% row
plays fortifying at 150%; the others at 125%.

| Stake floor | Declarations per player-round | Net value to the attacker per declaration | Value changing hands per campaign | Fortified per campaign | Median win round | Won on points | Round-5 leader wins |
| ----------- | ----------------------------- | ----------------------------------------- | --------------------------------- | ---------------------- | ---------------- | ------------- | ------------------- |
| 80%         | 0.96 / 0.93 / 0.93            | 2.65 / 2.15 / 1.66                        | 457 / 626 / 767                   | 0.02 / 0.03 / 0.05     | 12 / 10 / 8      | 16 / 8 / 4%   | 64 / 53 / 41%       |
| 100%        | 0.95 / 0.92 / 0.91            | 1.53 / 1.08 / 0.77                        | 406 / 614 / 724                   | 0.02 / 0.04 / 0.06     | 11 / 10 / 8      | 12 / 7 / 4%   | 65 / 44 / 44%       |
| **110%**    | 0.93 / 0.89 / 0.87            | 0.90 / 0.49 / 0.18                        | 439 / 575 / 704                   | 0.12 / 0.13 / 0.16     | 12 / 10 / 9      | 16 / 7 / 4%   | 65 / 48 / 42%       |
| 120%        | 0.91 / 0.86 / 0.84            | 0.26 / 0.15 / −0.14                       | 372 / 535 / 638                   | 0.14 / 0.20 / 0.23     | 11 / 11 / 8      | 17 / 11 / 5%  | 64 / 50 / 41%       |

- **Each 10 points roughly halves what a war is worth.** At 80% an attacker who wins half their
  games still comes out ahead; by 110% a war is close to even in country value, and at 120% it
  loses value at big tables. Defenders take more when they win (the stake is now worth more than
  the target), and attackers pick cheaper targets: value taken per attacker win falls from
  14–17 to 12–16 at 110%.
- **The bots hardly declare less.** Declarations fall 3–6% at 110% and 5–9% at 120%, because
  the bots declare mostly for missions, which are what win. Mission completion, game length, the
  share won on points and how often the early leader wins are all within what 200 campaigns can
  tell apart. People count country value more directly than the bots, so expect them to declare
  less than this.
- **Almost every neighbour can still be attacked.** Right after the draft, 84% of the enemy
  countries bordering a player can be attacked at 110%, against 88% at 80%. Rounding up costs
  most at the bottom: a target worth 1 needs a stake of 2, one worth 4 needs 5.
- **Fortifying is used more, for the wrong reason.** The bots fortify when they have a token to
  spare, and fewer wars worth declaring leave more tokens spare. A fortified country at 125% would
  have been protected by only 15 points over the floor; 150% keeps the gap at 40, close to the old 45. The simulator can't tell 125%, 140% and 150% apart (the bots fortify the same countries and
  rarely attack fortified ones either way), so the choice of 150% is a design call.

To rerun: `pnpm sim --scenario baseline,whatif:original-stakes,whatif:stake-100,whatif:stake-120 --players 2-8 --paces live --seeds 200 --out stakes`,
then `pnpm sim:report stakes --compare baseline`.

## Limitations

- **Bots are not your friends.** They are consistent, never tilt, never make deals over chat,
  never kingmake, and read every public claim perfectly.
  - Humans will be noisier. They will be slower to block, less likely to raise, and more likely to
    fight for fun or revenge.
  - The sensitivity runs vary these habits one at a time. The main findings hold across them (see
    [How much the bots' habits matter](#7-how-much-the-bots-habits-matter)).
  - The bots choose the secret showing the least effort. Players who take the dealer's best fit
    instead get much longer campaigns that often never end.
- **Chess is a coin with Elo on it.** Nothing models openings, time pressure or tilt. Checkmate
  Artist depends directly on the assumed share of wins by mate (30%), so it has its own
  sensitivity runs.
- **Time is rounds.** Hosts are assumed to wait out holding times and, live, to start a round
  once its wars are fought. Correspondence wars last 0–2 extra rounds by assumption.
- **What-ifs can't touch generation.** How targets are picked and how options are dealt is read
  from the catalog by version, so those changes are marked unvalidated.
- **One map.** Everything before [A 1–20 value curve](#a-120-value-curve) is on `2026.1`; `2026.2`
  has the same borders and sea lanes with other values. Missions tied to named countries (the named
  regions, the routes, Mare Nostrum, Seven Wonders) depend on how that map's borders and sea lanes
  fall.

## Rerunning

The runs above were on dataset `2026.1` (values 1 to 10), the first ones with mission rules version
2 and no last round. The simulator now plays what a new campaign plays (dataset `2026.2`, version
4, a last round of 25), so add `--dataset 2026.1` to repeat any run before
[A 1–20 value curve](#a-120-value-curve), with `--mission-rules 3` from
[Version 3, as built](#version-3-as-built) on, and `--mission-rules 2 --last-round none` before it:

```bash
pnpm sim --scenario baseline --players 2-8 --paces live,correspondence --seeds 400 --dataset 2026.1 --mission-rules 2 --last-round none --out baseline
pnpm sim --scenario secrets --players 2-8 --paces live --seeds 400 --dataset 2026.1 --mission-rules 2 --last-round none --out secrets
pnpm sim:report baseline                        # tables in packages/sim/out/baseline/report.md
pnpm sim:report whatif baseline --compare baseline
pnpm --filter @empire/sim trace --scenario baseline --players 4 --seed 7   # one campaign, round by round
```

The scenarios and what-if variants are in `packages/sim/src/scenarios.ts` and
`packages/sim/src/variants-catalog.ts`; the README there explains the knobs. Everything in this
report took a few hours of computing on a 10-core laptop (about 5–10 campaigns a second).
