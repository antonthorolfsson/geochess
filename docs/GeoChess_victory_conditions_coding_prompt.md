# Implement victory conditions for GeoChess

Implement this feature in https://github.com/antonthorolfsson/geochess. Deliver working code, migrations, UI, tests, and updated rules documentation—not just a proposal. Do not deploy as part of this task.

Read the current repository and applicable AGENTS.md/CLAUDE.md instructions first. Preserve unrelated work. The paths below are orientation from a prior review; verify the current architecture before editing:

- packages/rules/src: shared pure rules, configuration, graph operations, dataset and protocol types.
- apps/server/src/campaigns, wars, diplomacy, stats, notifications, realtime, and db.
- apps/web/src/components/campaign and components/rules/rules-guide.tsx.
- packages/data/datasets: versioned territory values, continent/subregion labels, terrain, land adjacency, and sea lanes.

Reuse the existing campaign mutation/transaction mechanism, event history, scheduler, notifications, and visual design. Prefer a typed, extensible mission system over special cases scattered through handlers.

## 1. Product goal and agreed rules

GeoChess combines territorial expansion, chess battles, and diplomacy. Victory missions should give players different reasons to value particular countries and create opportunities to infer and obstruct opponents' plans.

The core design is:

- Exactly four public missions per victory-enabled campaign, visible to everybody. Each is worth 2 victory points.
- Exactly one selected secret mission per player, worth 3 victory points.
- A player wins upon reaching at least 7 awarded points.
- Every player can score each public mission once; another player's completion does not remove it.
- Each player can score their secret mission once. No replacement mission after scoring.
- Points are permanent after award. Territorial changes can interrupt an unscored claim, but cannot remove banked points.
- Two public missions plus the secret give 7 points. All four public missions give 8, so a player can win without their secret.
- A secret becomes public when the player is one meaningful step away from completion, using mission-specific reveal rules. Do not use a universal 90% rule.
- Reveals are automatic and irreversible. Losing progress never makes a revealed mission secret again.
- Ownership missions can be completed through attacking, defending, or receiving territory as tribute. Battle-specific missions require actual qualifying war victories.

Implement the public and secret catalogs below. Keep thresholds and generation constraints in a central, versioned configuration so playtests can tune them without rewriting evaluators.

## 2. Explicit implementation defaults

The scoring model above is agreed. The following timing, tie, and lifecycle rules are proposed defaults that resolve gaps in the brainstorming. Implement and document them, keeping timing values configurable in the lobby and frozen when the draft starts.

### Eligibility and counting

- Snapshot every player's holdings and total value when the draft finishes. This is the baseline for all post-draft comparisons.
- No mission scores during drafting or secret selection.
- Drafted holdings count toward public ownership missions unless that mission explicitly requires post-draft progress. A condition satisfied by drafting still earns nothing immediately: its claim can start only when war round 1 begins and must survive the full response window. This lets drafting matter without an instant draft victory. Do not add a blanket acquisition requirement that makes a fixed-target mission impossible for somebody who drafted most of its targets.
- Secret candidates must require at least two meaningful remaining acquisitions when offered. Named target missions may include drafted holdings, but may not be dealt already complete or one acquisition from completion.
- Count distinct territory IDs. Losing and recapturing a country never creates multiple acquisitions for the same requirement. A country owned at the baseline does not become a new post-draft territory simply by losing and recovering it.
- Net-value missions compare current value with baseline value, including losses elsewhere.
- Count only resolved war outcomes, once per war. An Armageddon tiebreak is part of its original war, not another victory. Tribute and withdrawals are not chess victories. Follow existing outcome handling for resignation and timeout.
- Use the campaign's frozen dataset and its adjacency, island/mountain tags, and continent membership. A route may use sea lanes unless its mission explicitly restricts the edges.

### Claims and response windows

Public historical achievements, such as Campaign Veteran, award immediately when completed: their progress was already public and cannot be undone.

All ownership-based missions, public or secret, use a pending claim before awarding points:

1. When the full condition becomes true during round R, create a public pending claim. For an unrevealed secret, reveal it at the same time, even if a multi-territory transfer skipped its ordinary reveal trigger.
2. The player must continuously maintain the complete condition. Losing it cancels that claim episode; regaining it starts a new one. Reveal status persists.
3. The opponent response period includes one complete subsequent round. A claim first achieved during R cannot score before round R+2 starts.
4. Also require at least 10 minutes in live campaigns or 24 hours in correspondence campaigns after round R+1 starts. This prevents rapid host round advances from bypassing the response period. Both the round and elapsed-time conditions must be met.
5. Do not award while an unresolved declared war could invalidate the qualifying position. Use the mission's ownership predicate and the possible territory transfers to assess relevance. An unrelated war must not block scoring. If an alternative qualifying route or set makes the claim safe, account for that. Treat unresolved negotiations conservatively where a permitted redirect or tribute could affect it.
6. Recheck after relevant mutations and scheduled deadlines. If the condition held continuously and the blocking war ends without invalidating it, award without restarting the elapsed holding period.

An equivalent qualifying set may replace another without resetting the claim if the overall mission predicate never became false. For example, changing which three of five strategic positions are held need not reset a continuously valid claim.

An early secret reveal is only a warning; it does not start the holding period. The holding period starts upon full completion. Reveal before awarding within the same transaction, so no secret can instantly produce an unannounced win.

### Victory and campaign ending

- Evaluate all affected players and award all eligible points atomically for the same event/checkpoint before deciding the winner.
- If multiple players cross 7 in that batch, the highest resulting victory-point total wins. Equal totals produce a shared victory. Never break a tie using array iteration or database row order.
- Separate committed events retain first-to-threshold semantics.
- Persist the final score/mission snapshot and winner IDs. Make finalization idempotent.
- Default ending behavior: the campaign becomes read-only; no new wars, moves, accords, rounds, or territorial transfers are accepted. Archive unfinished wars/games with a distinct campaign-ended cancellation reason, preserve existing moves/history, and do not count those cancellations as wins, losses, draws, or resignations. Cancel pending game/declaration jobs and release reservations consistently.
- Publicly reveal all selected secret missions in the final results, including incomplete ones. Do not disclose discarded candidate options.

## 3. Campaign setup and mission selection

- Add an Objectives victory mode alongside the existing open-ended mode. Default new campaigns to Objectives; deserialize older campaigns with no victory configuration as open-ended. Never silently enable missions or backfill points in existing active campaigns.
- Public missions, their exact targets, and thresholds are chosen and displayed in the lobby before drafting. Lock them with the other campaign rules.
- Default public set: Expansion, Strategic Positions, The Great Connection, Campaign Veteran.
- Allow the host to choose another valid set of four distinct catalog missions before the draft. Provide generated targets and previews; avoid building a general-purpose mission editor.
- After the draft, generate three suitable secret options privately for each player. They select one irrevocably before war play begins.
- Implement a brief mission-selection phase, reusing existing lifecycle patterns. Show readiness without revealing anyone's options. Begin round 1 and initial token allocation only once every player has selected or been automatically assigned.
- Default selection deadline: 5 minutes live, 24 hours correspondence. At expiry, assign that player's precomputed best-fit option and privately notify them. The host cannot inspect choices or choose on another player's behalf.
- Persist candidate options and their ranking; refreshes, reconnects, retries, and restarts cannot reroll them.

Generation must validate actual map topology and starting ownership. Estimate required new territories, intervening enemy territories, target value, and distinct opposing owners. Treat this as a transparent heuristic, not a claim of mathematically proven balance.

For public targets, generate positions/endpoints that multiple possible starting areas can contest. Avoid isolated, trivial, or extremely long routes and excessive overlap among the four objectives. Targets selected before drafting must not silently change afterward.

For private candidates, favor a mix of regional, route/position, and expansion/diplomacy missions. Filter for player count, draft mode, reachability, ownership, and remaining effort. Do not deal Northern Passage indiscriminately to a player with no plausible access to the North Atlantic.

Use persisted server-private randomness for secret choices, with injectable deterministic randomness in tests. A public campaign seed must not allow opponents to reconstruct secret candidates.

If fewer than three valid options exist, offer the valid options rather than inventing impossible ones. Include a documented fallback template, Measured Expansion: gain and retain 20 net territory value above baseline, including at least three new territories; reveal at +16 with two new territories, or when one legal acquisition could satisfy both thresholds. Offer it only when feasible. If no valid option exists even after fallback, surface a setup error rather than deadlocking or silently changing the victory rules.

## 4. Public mission catalog — 2 points each

All territorial entries use the response window. Post-draft requirements apply where expressly stated below.

| ID | Name | Completion condition |
| --- | --- | --- |
| expansion | Expansion | Current total territory value is at least baseline +15. |
| regional_power | Regional Power | Own at least 60% of the frozen total game value of a marked region, including at least three territories. Use a suitable subregion or explicit generated set, not interchangeable whole continents. |
| strategic_positions | Strategic Positions | Own any three of five public marked territories simultaneously. |
| great_connection | The Great Connection | Own both public endpoints and a continuous path of owned territories between them, using land or sea edges. |
| campaign_veteran | Campaign Veteran | Win three wars against at least two different opponents, with at least one win as attacker. For two-player campaigns, require one distinct opponent. Historical; no holding period. |
| great_powers | Great Powers | Own three territories valued at least 8 each, with at least two acquired after the draft. |
| across_the_seas | Across the Seas | Win three distinct attacks launched across sea-lane edges, acquiring three distinct non-baseline territories, and still own all three. Determine sea launch from the actual resolved target/launch relation after any redirect. |
| continental_bridge | Continental Bridge | An owned connected component contains at least two territories on each of three continents. Label as a longer campaign option. |
| consolidation | Consolidation | At least 80% of current empire value lies in one owned component containing at least two non-baseline territories. If the baseline had multiple components, it must connect holdings from at least two of them, with two new territories contributing to a connecting path. If the baseline was already connected, expanding that component with two new territories is the explicit fallback. Free-draft mode only. |
| two_fronts | Two Fronts | Currently own at least two non-baseline territories on each of two different continents. |

Validate regional sizes and graph constraints using the dataset, rather than assuming all continents or named regions offer similar difficulty. Inapplicable catalog entries must have a clear explanation in setup instead of producing impossible runtime goals.

## 5. Secret mission catalog — 3 points each

Every selected secret in this initial catalog has a territorial completion condition and uses the response window. Show owners exact targets and requirements from selection onward. Other players see neither identity nor progress until reveal.

| ID | Name | Completion condition | Automatic reveal |
| --- | --- | --- | --- |
| northern_passage | Northern Passage | Own Canada, Greenland, Iceland, and the UK. | Own three of four. |
| caribbean_chain | Caribbean Chain | Own Cuba, Haiti, Dominican Republic, and Puerto Rico. | Own three of four. |
| pacific_passage | Pacific Passage | Own Australia, New Zealand, Polynesia, and Fiji. | Own three of four. |
| mediterranean_arc | Mediterranean Arc | Own Spain, France, Italy, and Tunisia. | Own three of four. |
| central_asian_union | Central Asian Union | Own four of Kazakhstan, Uzbekistan, Turkmenistan, Kyrgyzstan, and Tajikistan. | Own three of five. |
| island_empire | Island Empire | Own four of six designated island-tagged territories, including at least two non-baseline territories. | Own three targets and one further acquisition can satisfy both requirements. |
| mountain_kingdom | Mountain Kingdom | Own three designated mountain-tagged territories forming a feasible local campaign. | Own two of three. |
| unification | Unification | Connect two marked baseline holdings belonging to separate baseline components through owned land/sea adjacency. Require at least two new territories contributing to that connection. | One additional territory can complete a valid connection and the acquisition requirement. |
| encirclement | Encirclement | Own every land/sea neighbor of a marked territory while the marked territory remains owned by somebody else. Select targets with three to five distinct neighbors. | Own all but one neighbor, with the center still outside the empire. |
| hidden_triangle | Hidden Triangle | Own three fixed generated targets requiring expansion in two distinct directions from baseline holdings. | Own two of three. |
| two_theater_power | Two-Theater Power | On each of two designated continents, retain at least 8 net value above that continent's baseline and at least two non-baseline territories. | One theater is complete and one further acquisition could complete the other. |
| protected_expansion | Protected Expansion | Complete a qualifying episode in which accords with two distinct partners both hold through at least two whole overlapping war-phase rounds, and acquire three distinct non-baseline territories from other players while both accords are active. Still own those three territories. Four or more players only. | A qualifying two-round accord history exists and two qualifying territories have been acquired and retained. |

Resolve named places to existing dataset IDs; do not add or rename countries. Verify named sets and routes against the campaign's dataset. Omit a template for a dataset where its entities or necessary topology are unavailable.

Protected Expansion details: draft rounds do not count; token tribute does not count; territory tribute may count; the prior owner of each acquired territory must be outside the two qualifying partners. Use actual accord start/end/renunciation history, not current reputation. Once the historical episode is complete, ordinary accord expiry does not erase that proof; the ownership requirement remains contestable. Do not require new accords to remain active indefinitely during claim settlement.

For a route or numerical mission, “one additional acquisition” must be a real reachable possibility under ownership and adjacency, not an arbitrary percentage or geometric distance. Evaluate strategic proximity without suppressing a reveal merely because a token is temporarily unavailable or a truce/lock is active. Full completion always reveals, including jumps caused by winning a defensive stake.

## 6. Rules engine, persistence, and API

- Separate reusable mission definitions from instantiated parameters and per-player state. Snapshot a mission-rules version per campaign so later balance changes do not alter active campaigns.
- Use typed predicates and evidence for ownership sets, graph connections, net-value changes, war outcomes, and accord episodes.
- Evaluators should produce structured progress, unmet requirements, reveal eligibility, completion, and qualifying evidence. Multi-part missions need multiple progress fields; do not invent misleading single percentages.
- Persist baselines, secret candidates/selection, reveal timestamp, current claim episode, timing eligibility, award ledger, and final results using normal migrations and constraints.
- Model reveal status separately from pending-claim status. A revealed mission can become incomplete; a scored mission stays scored.
- Award uniqueness must be enforced in the database for campaign + player + mission instance. Retries and concurrent resolutions must not duplicate points, notifications, or winners.
- Evaluate on draft/selection completion, territory transfer including tribute, war resolution, relevant accord transitions, round advancement, and due scheduler jobs. Prefer a central integration point to duplicated controller checks.
- Use server time for deadlines. Restore due work after restarts. Do not depend on an open browser or award points through side effects in a GET request.
- Keep secret candidate lists, parameters, progress, evaluation evidence, and private random seeds out of public snapshots, WebSocket messages, notifications, event logs, stats endpoints, and error responses. Shared evaluation code is fine; secret instances and data stay server-side.
- Enforce ownership authorization for secret selection and private reads. Host privileges must not bypass mission secrecy.
- Public reveal events include exact mission requirements and targets. Publish safe public DTOs and owner-private DTOs deliberately.

## 7. User experience and documentation

Preserve the existing mobile-first operations-map style, country selection flow, and accessibility conventions.

- Lobby: victory mode, four public cards, target previews, response timing, and concise scoring explanation.
- Post-draft: private choice among eligible secret cards with concrete requirements and map previews. Others see readiness only.
- Campaign: an accessible Objectives view with public mission progress per player, awarded points, and the owner's secret card. Never show a hidden progress bar or “almost done” indicator for another player's secret.
- Map: highlight relevant targets and paths when a permitted mission is selected; never leak another player's secret through overlays or cached map data.
- Standings: victory points become the primary race in Objectives mode. Keep territory value visible as a separate statistic.
- Pending claims: show what must be held, the next eligible scoring round, the minimum time deadline, and any unresolved-war blocker. Do not show a countdown that falsely guarantees award at expiry.
- Dispatches/notifications: secret reveal, claim started/interrupted, points awarded, and victory. Deduplicate notifications; keep private selection notifications private.
- Final screen: winner(s), points, completed missions, all selected secret missions, and an understandable final map/score snapshot.
- Update the rules guide and README. Explain nonexclusive public missions, permanent points, reveals, the full response window, ties, and ending behavior. Generate mission wording/progress from shared definitions where practical.
- Make secret confidentiality correct on refresh, reconnect, direct URL navigation, and simultaneous tabs.

## 8. Required verification

Use the repository's existing test tooling. Add meaningful rules and integration coverage for:

1. The 2+2+3=7 route, four-public=8 route, nonexclusive public scoring, and once-only awards.
2. Every catalog evaluator, invalid generated candidates, deterministic test generation, two-player adaptations, free-draft restrictions, and fallback behavior.
3. Baseline accounting, relevant acquisitions, losses, tribute, recapture without farming, sea-lane redirects, and one-war counting for Armageddon.
4. Every reveal trigger, sticky reveals after lost progress, hidden information before reveal, and a defensive transfer jumping directly from incomplete to complete.
5. Full claim timing: qualification in R cannot score at R+1; R+2 still waits for minimum elapsed time; rapid host advances cannot bypass the window; losing/rebuilding a position resets only its claim episode.
6. Relevant unresolved wars blocking claims, unrelated wars not blocking them, alternate valid paths/sets, and resumption after a blocking war ends.
7. Idempotent retries, concurrent war resolutions, restart recovery, atomic multi-player scoring, shared ties, and exactly-once finalization.
8. Privacy across all affected HTTP/WebSocket/event/stat/notification routes, including the host and another authenticated player.
9. Existing open-ended campaigns remaining unchanged after migration, and the complete setup → selection → reveal → claim → scoring → victory flow.
10. Campaign-ending cancellation preserving history without generating fabricated chess results or later territorial changes.

Run relevant tests, type checking, and the production build. Visually check the selection, objective, pending-claim, and final-result screens on mobile and desktop using available tooling. Report any checks you cannot run accurately.

## 9. Delivery expectations

Start with a concise implementation plan grounded in the current code, then execute it. Do not stop at the plan or leave core catalog entries as placeholders.

Keep this task focused on victory missions. Do not introduce new combat systems, economic resources, capitals, territorial trading, rating handicaps, or AI opponents.

When finished, summarize the behavior, files/migrations changed, verification performed, balancing heuristics and defaults, and any concrete remaining limitations. The feature must work from campaign creation through final results without exposing a hidden mission prematurely.
