import {
  MATCHED_RAISE_MIN_PCT,
  MAX_VALUE,
  RESPONSE_WINDOW_TEXT,
  TURN_WINDOW_TEXT,
  durationText,
  holdMs,
  missionRules,
  raiseFloor,
  selectionMs,
  stakeFloor,
  tiebreakText,
  type CampaignRules,
  type Handicap,
  type LiveClock,
  type Pace,
  type PlayerRating,
} from '@empire/rules';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** Small counts in words, as prose writes them. */
export const inWords = (n: number) => WORDS[n] ?? String(n);

/** "1 round", "3 rounds". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "1 war token", "3 war tokens". */
export const warTokens = (n: number) => plural(n, 'war token');

/**
 * How long something counted in round starts lasts, from the round it begins in. A 1-round truce
 * set in round 3 ends when round 4 starts: "for the rest of the round". Two rounds: "for the rest
 * of the round and the next one".
 */
export function forRounds(rounds: number): string {
  const more = rounds - 1;
  if (more <= 0) return 'for the rest of the round';
  return `for the rest of the round and the next ${more === 1 ? 'one' : inWords(more)}`;
}

/** "12 hours", "1 day", "3 days". */
export const hoursText = (hours: number) => (hours % 24 === 0 ? plural(hours / 24, 'day') : plural(hours, 'hour'));

/** "1 day per move", "12 hours per move". */
export const perMoveText = (hours: number) => `${hoursText(hours)} per move`;

/** "5 minutes each, plus 3 seconds a move". */
export function liveClockText(clock: LiveClock): string {
  const [minutes, seconds] = clock.split('+').map(Number) as [number, number];
  return `${plural(minutes, 'minute')} each, plus ${plural(seconds, 'second')} a move`;
}

/** The campaign's time control in a word or two: "5+3" or "1 day per move". */
export const timeControlText = (rules: CampaignRules) =>
  rules.war.pace === 'live' ? rules.war.liveClock : perMoveText(rules.war.hoursPerMove);

/**
 * What the stake table's second row shows, if anything: the stake a raise to a percentage demands,
 * and a fortified country needs. A matched raise depends on the country put in, so has no row.
 */
export function raisedRowLabel(rules: CampaignRules): string | null {
  const { raise, fortify } = rules.war;
  const raised = raise === 'token' || raise === 'free';
  if (raised && fortify) return 'After a raise, or fortified';
  if (raised) return 'After a raise';
  return fortify ? 'Fortified' : null;
}

/** Target values the stake table shows on a map whose values run 1 to 20: every low value, then steps. */
const STAKE_TABLE_VALUES_20 = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];

/**
 * What a stake must be worth against a target of each value, as declared and after a raise (or
 * fortified), for a map whose values run 1 to `top`.
 */
export function stakeTable(rules: CampaignRules, top = MAX_VALUE): { value: number; stake: number; raised: number }[] {
  const values = top === 10 ? Array.from({ length: 10 }, (_, i) => i + 1) : STAKE_TABLE_VALUES_20;
  return values.map((value) => ({ value, stake: stakeFloor(rules, value), raised: raiseFloor(rules, value) }));
}

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The host's settings, in the words the rules use. */
export function settingsList(rules: CampaignRules): { label: string; value: string }[] {
  const { war, victory } = rules;
  const objectives = victory.mode === 'objectives';
  return [
    {
      label: 'Victory',
      value: objectives
        ? `First to ${missionRules(victory.version).points.toWin} points${missionRules(victory.version).titles ? ', with titles' : ''}`
        : 'Open-ended',
    },
    ...(objectives
      ? [
          {
            label: 'Last round',
            value: victory.lastRound === null ? 'None' : `Round ${victory.lastRound}, then the most points win`,
          },
          ...(victory.lastRound === null
            ? []
            : [{ label: 'Level on points', value: sentenceCase(tiebreakText(victory.tiebreak)) }]),
          { label: 'Claims are held', value: `${durationText(holdMs(rules))} after the next round starts` },
          { label: 'Time to choose a secret', value: durationText(selectionMs(rules)) },
        ]
      : []),
    { label: 'Players', value: `Up to ${rules.maxPlayers}` },
    { label: 'Draft', value: rules.draft.mode === 'contiguous' ? 'Contiguous' : 'Free' },
    { label: 'Pace', value: war.pace === 'live' ? 'Live' : 'Correspondence' },
    { label: 'Time control', value: timeControlText(rules) },
    {
      label: 'Declaring',
      value: war.turns ? `In turns, ${TURN_WINDOW_TEXT[war.pace]} each` : 'Whenever you like',
    },
    { label: 'Time to answer', value: RESPONSE_WINDOW_TEXT[war.pace] },
    { label: 'Draws', value: war.draws === 'armageddon' ? 'Armageddon' : 'Defender holds' },
    { label: 'Clock modifiers', value: war.clockModifiers ? 'On' : 'Off' },
    { label: 'Rating handicap', value: handicapText(rules) },
    { label: 'War tokens', value: `${war.tokensPerRound} a round, up to ${war.tokenCap}` },
    { label: 'Least stake', value: `${war.stakeFloorPct}% of the target` },
    { label: 'Raising the stakes', value: raiseText(rules) },
    ...(raisedRowLabel(rules) ? [{ label: 'Raised stake', value: `${war.raisePct}% of the target` }] : []),
    {
      label: 'Redirects',
      value: `${war.redirect === 'nearby' ? 'Near the target' : 'Anywhere on the border'}, ${war.redirectToken ? 'for a token' : 'free'}`,
    },
    { label: 'Fortifying', value: war.fortify ? 'A token, until the round after next' : 'Off' },
    { label: 'Peace terms', value: war.peaceTerms ? 'Until the game ends' : 'Off: tribute instead' },
    { label: 'Calling off a declaration', value: war.recall ? 'Until the defender answers' : 'Off' },
    { label: 'Truce after a war', value: war.truceRounds === 0 ? 'None' : plural(war.truceRounds, 'round') },
    { label: 'Lock on won countries', value: war.lockRounds === 0 ? 'None' : plural(war.lockRounds, 'round') },
  ];
}

/** How the campaign's defenders raise the stakes, in a few words. */
export function raiseText(rules: CampaignRules): string {
  switch (rules.war.raise) {
    case 'matched':
      return (
        `Matched: a country worth ${MATCHED_RAISE_MIN_PCT}–100% of the target` +
        (rules.war.raises > 1 ? `, raised back and forth up to ${rules.war.raises} times` : '')
      );
    case 'token':
      return `For a token, to ${rules.war.raisePct}% of the target`;
    case 'free':
      return `Free, to ${rules.war.raisePct}% of the target`;
    case 'off':
      return 'None';
  }
}

/** The campaign's rating handicap, in a few words. */
export function handicapText(rules: CampaignRules): string {
  const { handicap, selfRatings } = rules.war;
  if (handicap === 'off') return 'Off';
  return `${handicap === 'full' ? 'Full' : 'Light'}, from Lichess ratings${selfRatings ? ' or players’ own' : ''}`;
}

/** A player's rating and where it's from: "1834, Lichess blitz". */
export function ratingText(r: PlayerRating): string {
  const from =
    r.source === 'lichess' ? `Lichess ${r.perf ?? ''}`.trim() : r.source === 'bot' ? 'bot level' : 'own rating';
  return `${r.rating}, ${from}`;
}

/**
 * A war game's time odds in a line: "Ann +40% time, Bo −40% (250 points apart)". In
 * correspondence the stronger player keeps their time.
 */
export function handicapLine(h: Handicap, pace: Pace, names: { attacker: string; defender: string }): string {
  const weaker = h.favored === 'attacker' ? names.attacker : names.defender;
  const stronger = h.favored === 'attacker' ? names.defender : names.attacker;
  const taken = pace === 'live' ? `, ${stronger} −${h.pct}%` : '';
  return `${weaker} +${h.pct}% time${taken} (${h.gap} points apart)`;
}
