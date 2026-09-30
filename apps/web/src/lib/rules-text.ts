import {
  MATCHED_RAISE_MIN_PCT,
  RESPONSE_WINDOW_TEXT,
  TURN_WINDOW_TEXT,
  durationText,
  holdMs,
  missionRules,
  raiseFloor,
  selectionMs,
  stakeFloor,
  type CampaignRules,
  type LiveClock,
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

/** What a stake must be worth against a target of each value, as declared and after a raise (or fortified). */
export function stakeTable(rules: CampaignRules): { value: number; stake: number; raised: number }[] {
  return Array.from({ length: 10 }, (_, i) => ({
    value: i + 1,
    stake: stakeFloor(rules, i + 1),
    raised: raiseFloor(rules, i + 1),
  }));
}

/** The host's settings, in the words the rules use. */
export function settingsList(rules: CampaignRules): { label: string; value: string }[] {
  const { war, victory } = rules;
  const objectives = victory.mode === 'objectives';
  return [
    {
      label: 'Victory',
      value: objectives ? `First to ${missionRules(victory.version).points.toWin} points` : 'Open-ended',
    },
    ...(objectives
      ? [
          {
            label: 'Last round',
            value: victory.lastRound === null ? 'None' : `Round ${victory.lastRound}, then the most points win`,
          },
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
      return `Matched: a country worth ${MATCHED_RAISE_MIN_PCT}–100% of the target`;
    case 'token':
      return `For a token, to ${rules.war.raisePct}% of the target`;
    case 'free':
      return `Free, to ${rules.war.raisePct}% of the target`;
    case 'off':
      return 'None';
  }
}
