# Empire Chess: Implementation Plan

*Working title. Draft, September 2026.*

## 1. Concept

Players take turns claiming countries on a world map to build empires. Wars between empires are declared under structured rules and settled by a game of chess. The winner takes the contested territory.

- **Audience:** Private friend-group lobbies. Campaigns run for days or weeks.
- **Platform:** Web app, equally usable on mobile and desktop, installable to the home screen.
- **Theme:** Modern military, styled as an operations map room.
- **Chess engine:** Lichess's open-source board (chessground) and rules library (chessops).

---

## 2. Game design summary

### Setup

- Each campaign is an invite-only lobby. The host configures the rules.
- Every country has a game value from 1 to 10, generated from blended real-world data (population, economy, area) and then hand-tuned. Microstates are bundled into regions.
- The campaign opens with a snake draft: players take turns claiming countries on the map.

### Declaring war

- **War tokens:** Each player receives a base number of declarations per round, plus a bonus based on holdings.
- **Adjacency:** The target must border one of your countries by land or by a designated sea lane.
- **Stakes:** The country you attack from is your stake. If its value is too low, you add countries connected to it until the stake reaches 80–125% of the target's value.
- **Locks:** A staked country can't be staked again or traded away until its war resolves. A newly conquered country can't be staked for a set number of rounds.
- **Truces:** After a war, the same two players can't fight each other for a set number of rounds.

### Defender responses

- **Accept:** The game is on.
- **Raise:** Demand a stake at the top of the allowed range. If the attacker refuses, the war is off and the attacker loses the token.
- **Redirect:** Offer a different country of equal value as the target.
- **Pay tribute:** Cede a smaller country or tokens to avoid the fight.
- **Call an ally (later version):** An ally plays the game as your champion.

### Resolution

- **Outcome:** If the attacker wins, they take the target. If the defender wins, they take the stake.
- **Draws:** Host setting. Either the defender holds, or the players play an Armageddon tiebreak (White gets more time, Black wins on a draw).
- **Clock modifiers:**
  - The defender gets bonus time for home turf and difficult terrain (mountains, islands).
  - The attacker gets bonus time for each owned country adjacent to the target (supply lines).
  - A rating-based handicap applies (see below).
  - All modifiers combined are capped.
- **Optional sliding scale:** Instead of a fixed stake range, the ratio of stake value to target value sets the clock ratio.

### Surprise wars (Chess960)

- The defender gets no response window: no raise, redirect, tribute or ally.
- The game is played as Fischer Random (Chess960). The attacker plays White or sees the starting position a few hours early.
- The defender loses the home-turf clock bonus.
- **Costs:**
  - Double war tokens.
  - A stake of 100–150% of the target's value.
  - A public reputation penalty.
  - A limit of one or two per campaign.
- A surprise war is the only way to attack a player you have a treaty or truce with.
- **Counterplay:**
  - **Garrisons:** Spend a token to make a country immune to surprise attacks for a few rounds.
  - **Retaliation:** A surprised defender gets a free declaration against the attacker, and the truce rule doesn't apply.

### Diplomacy

- Lobby chat and private messages.
- Public treaties with a reputation score. Betrayal is possible but visible.
- **Champions (later version):** Allies or mercenaries can play on your behalf. Handicaps are based on whoever actually plays.
- **Bughouse (later version):** Alliance wars are played as 2v2 bughouse.

### Ratings and handicaps

- Ratings use Glicko-2, tracked separately for live and correspondence games.
- Players can seed their rating by importing it from Lichess or Chess.com.
- Ratings persist across campaigns within a lobby but are frozen for the duration of a campaign, which prevents sandbagging.
- The host chooses the handicap level: off, light or full.

### Long-term mechanics

- **Overextension:** Large empires risk rebellions in distant countries, fought against a Stockfish bot.
- **Elimination:** Knocked-out players return as mercenaries or rebel leaders.
- **Victory conditions:** The host picks from domination percentage, continent bonuses, secret objectives, or a fixed-length season.
- **Two paces:** Live blitz for game nights, and correspondence (about one move per day) for slow campaigns.

### Empire statistics page

- **Totals:** Real population, area, GDP (nominal and PPP) and military spending, plus share of the world.
- **Real-world comparisons:** For example, "Your economy would rank 3rd in the world."
- **Country list:** Each holding with its game value and real stats.
- **History graph:** Empire size over the campaign, with wars marked.
- **War record:** Wins, losses and draws as attacker and as defender, surprise wars launched, and treaties broken.
- **Chess profile:** Rating, most-played openings, and results in standard vs. Chess960 games.

---

## 3. Scope

| First version | Later |
|---|---|
| Private lobbies and invites | Glicko-2 ratings and handicaps |
| Snake draft | Surprise wars (Chess960), garrisons, retaliation |
| Adjacency, stakes, locks, truces | Champions and mercenaries |
| Accept, raise, redirect, tribute | Rebellions vs. bot |
| Live and correspondence chess | Bughouse alliance wars |
| Chat, treaties, reputation | Fair-play engine analysis |
| Empire statistics page | End-of-campaign map timelapse |

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript throughout | One language across client, server and rules |
| Frontend | Next.js, installable web app | Web push for move alerts. iOS only allows push once the app is added to the home screen, so email is the fallback |
| Map | d3-geo + TopoJSON (Natural Earth) rendered to SVG, with d3-zoom | Pinch and pan zoom; tappable dots for microstates |
| Chess board | chessground (Lichess) | Supports piece drops for bughouse |
| Chess rules | chessops (Lichess) | Chess960 castling, crazyhouse rules as a base for bughouse, FEN/PGN |
| Backend | Node + Postgres + WebSockets | Supabase is an option for login, database and real-time updates |
| Jobs | pg-boss or a cron service | Move deadlines, round timers, truce expiry |
| Engine | Stockfish, server-side | Rebellion bots and fair-play analysis |
| Data | Natural Earth, World Bank open data | Public domain and CC BY 4.0 (attribution required) |

### Licensing

chessground, chessops and Stockfish are all GPL-3.0.

- **Frontend:** Because the browser code bundles chessground, it must be released under a GPL-compatible license, with source available to players.
- **Rules package:** The shared rules package imports chessops and ships to the browser, so it must be GPL-compatible too.
- **Backend:** Server-only code isn't distributed, so the GPL doesn't strictly require publishing it. The AGPL would.

**Recommendation:** Open-source the whole project from day one, under GPL-3.0 or AGPL-3.0 (Lichess itself uses AGPL). It's simpler than splitting licenses and fits the Lichess ecosystem. Confirm the choice before the first public commit. This isn't legal advice.

---

## 5. Architecture

```
┌────────────────────────┐        ┌───────────────────────────────┐
│ Web client (PWA)       │  WS /  │ Game server (Node)            │
│ - Map (d3-geo)         │◄──────►│ - Rules engine (authoritative)│
│ - Board (chessground)  │  HTTP  │ - Chess clocks + lag comp.    │
│ - Rules engine (preview)│       │ - Lobby, chat, treaties       │
└────────────────────────┘        │ - Notifications (push, email) │
                                  └──────┬───────────┬────────────┘
                                         │           │
                                  ┌──────▼─────┐ ┌───▼────────────┐
                                  │ Postgres   │ │ Job runner     │
                                  │ + event log│ │ - deadlines    │
                                  └────────────┘ │ - round timers │
                                                 └───┬────────────┘
                                                     │
                                              ┌──────▼───────────┐
                                              │ Stockfish worker │
                                              │ - bots, fair play│
                                              └──────────────────┘
```

**Key principles:**

- **Shared rules engine.** A pure TypeScript package holds every game rule: adjacency, stake ranges, locks, tokens, truces, clock modifiers and victory checks. The client uses it for previews, such as highlighting valid targets and building a stake. The server uses it as the final authority. Test it heavily, because balance bugs hide here.
- **Server authority.** The server validates every chess move with chessops and runs every clock, with lag compensation. Never trust the client for time or legality.
- **Event log.** Every territory change, war, treaty and reputation change is written as an event. The history graph, war record and end-of-campaign timelapse are all derived from it.
- **Static country data.** Country shapes, adjacency, values and real-world stats are built by a script and versioned. Each campaign snapshots the dataset at the start.

---

## 6. Data model

| Table | Key fields | Notes |
|---|---|---|
| users | id, name, linked Lichess/Chess.com account | |
| campaigns | id, host, rules config (JSON), dataset version, status, round | Rules config holds all host settings |
| members | campaign, user, color, pattern, tokens, reputation, status | Status: active, eliminated, mercenary |
| countries | iso code, name, value, neighbors, sea lanes, terrain, real stats | Static, versioned dataset |
| holdings | campaign, country, owner, acquired round, locked by war, garrison until | |
| wars | campaign, type, attacker, defender, target, stake list, status, result | Type: standard or surprise |
| games | war, variant, time control, clocks, FEN/PGN, white and black players | Players may be champions |
| treaties | campaign, parties, terms, status, broken by | |
| ratings | user, lobby, speed, Glicko-2 values | Frozen per campaign |
| events | campaign, round, type, payload, timestamp | Append-only |

---

## 7. Map and data pipeline

1. **Map canon.** Decide how disputed territories are handled (for example Taiwan, Kosovo, Western Sahara) and which microstates are bundled into regions. Adjacency depends on this, so it comes first.
2. **Shapes.** Import Natural Earth country shapes and simplify them for mobile performance.
3. **Adjacency.** Compute land borders automatically with TopoJSON's neighbors function, then add sea lanes by hand in a config file.
4. **Real stats.** Import population, area, GDP (nominal and PPP), military spending and armed forces personnel from World Bank open data, keyed by ISO country code. Fill gaps with clearly labeled estimates.
5. **Game values.** Generate 1–10 values with a weighted, compressed formula, then hand-tune them in a reviewable config file.
6. **Terrain.** Tag countries for terrain bonuses (mountains, islands) in config.
7. **Build.** Output one versioned JSON dataset. Refresh it yearly.

---

## 8. Build phases

Estimates assume one experienced developer working full time.

### Phase 1: Foundation (3–4 weeks)

- Monorepo (web, server, shared rules package), CI and license set up
- Login, lobby creation and invite links
- Map pipeline and map rendering with ownership colors
- Country values script
- Snake draft

**Done when** a group can create a lobby and draft a full map on phone and desktop.

### Phase 2: War loop (4–6 weeks)

- Declaration flow with valid-target highlighting and a stake builder
- Defender responses: accept, raise, redirect, tribute
- Chess games with chessground and server-side chessops validation, in live and correspondence time controls
- Server clocks with lag compensation
- Territory transfer, locks, truces and draw rules
- Push and email notifications

**Done when** a war can be declared, played and resolved in both live and correspondence modes.

### Phase 3: Diplomacy (2–3 weeks)

- Lobby chat and private messages
- Treaties and reputation
- Activity feed

**Done when** players can form, view and break treaties, with reputation updating visibly.

### Phase 4: Stats and history (2 weeks)

- Empire statistics page with real-world data and comparisons
- History graph and war record built from the event log
- Chess profile

**Done when** every empire has a complete stats page that updates after each war.

### Phase 5: Playtest (one full campaign)

- Run a real campaign with the friend group.
- Tune country values, the token economy, the stake range, time controls and round length.
- Gather feedback before building more.

### Phase 6: Advanced mechanics (4–6 weeks)

- Glicko-2 ratings, rating import and handicaps
- Surprise wars (Chess960), garrisons and retaliation
- Champions and mercenaries
- Rebellions against a Stockfish bot
- Bughouse alliance wars
- Fair-play engine analysis flagged to the host
- End-of-campaign map timelapse

**Total:** roughly 4–5 months before playtest iterations.

---

## 9. Visual design

**Direction:** An operations map room built on military cartography and briefing documents, rather than the green-on-black gaming HUD common in the genre.

### Palette

| Token | Hex | Use |
|---|---|---|
| Gunmetal | #1F2428 | Page background |
| Panel | #2B3238 | Panels and sheets |
| Olive drab | #4B5320 | Unclaimed land |
| Deep sea | #16232B | Oceans |
| Grease-pencil red | #C8372D | Wars, hostile actions |
| Signal amber | #E3A92B | Alerts, your turn |
| Map-room white | #E4E2D8 | Primary text |

- **Player colors:** A set of 8 empire colors, tested for colorblind distinguishability. Each is paired with a hatching pattern and shown as a translucent overlay, like acetate sheets over a planning map.
- **Mode:** Dark-first. A light "paper map" variant can come later.

### Type

- **Interface:** A condensed sans-serif. Candidate: Sofia Sans Condensed. Use tabular figures for stats and clocks.
- **Display:** A stencil face used only for empire names and war headlines. Candidate: Saira Stencil One.

### Signature element

Active wars are drawn as hand-marked arrows from the launching country to the target, like grease pencil on a map table. Keep everything else restrained so this stands out.

### Voice

- Flavor text can use military vocabulary: declarations are dispatches, treaties are accords, notifications are intel reports.
- Buttons stay plain and literal: "Declare war", "Accept", "Pay tribute".

### Chess board

Themed colors from the palette, but readability comes first: high contrast between squares and pieces, clear last-move and check highlights.

### Accessibility

- Tap targets of at least 44px, including microstates
- Hatching patterns in addition to color
- Reduced motion respected
- Full keyboard support for the board on desktop

---

## 10. Layouts

Design mobile-first. The desktop layout uses the same panels with more room.

### Mobile

```
┌───────────────────────────┐
│ Campaign name    2 wars ⚑ │
│                           │
│                           │
│        WORLD MAP          │
│    (pinch and pan zoom)   │
│                           │
├───────────────────────────┤  ← slide-up panel
│ Poland         value 6    │
│ Owner, real stats         │
│ [ Declare war ]           │
├───────────────────────────┤
│ Map │ Wars │ Diplo │ Empire│
└───────────────────────────┘
```

During a game, the board fills the screen width, with the opponent's clock above and yours below.

### Desktop

```
┌────────────┬──────────────────────────────┬──────────────┐
│ Activity   │                              │ Selected     │
│ feed       │          WORLD MAP           │ country or   │
│            │                              │ war panel    │
│            │                              │              │
│            │                              │              │
└────────────┴──────────────────────────────┴──────────────┘
```

Chess games open alongside the map, so players can see what's at stake while they play.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Engine cheating, especially in slow games | Post-game Stockfish analysis flagged to the host; friends-only lobbies |
| Chess skill snowballing | Rating handicaps, champions, Chess960 surprise wars |
| Campaigns stalling from inactive players | Correspondence deadlines with auto-forfeit; host tools to pause or replace players |
| Push notifications unreliable on iOS | Prompt players to install to home screen; email fallback |
| GPL obligations | Choose the license at repo creation and publish source |
| Disputed territories | Settle map canon early; use neutral names |
| Data licensing | Use World Bank and Natural Earth with attribution; avoid proprietary military indexes |
| Scope creep | Ship the first version and playtest before Phase 6 |

---

## 12. Open questions

- Weights in the country value formula
- War token economy: base tokens per round and holdings bonus
- Round length for correspondence campaigns
- Default time controls for live and correspondence games
- Default draw rule: defender holds or Armageddon
- Minimum and maximum players per lobby
- Default victory condition
- Project license: GPL-3.0 or AGPL-3.0
- Final name
