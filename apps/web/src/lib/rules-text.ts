import {
  CURRENT_MISSION_RULES,
  DEFAULT_RULES,
  MATCHED_RAISE_MIN_PCT,
  MAX_VALUE,
  MISSIONS,
  RESPONSE_WINDOW_TEXT,
  TURN_WINDOW_TEXT,
  durationText,
  holdMs,
  holdsByTurns,
  kindName,
  missionRules,
  raiseFloor,
  roundProgression,
  selectionMs,
  stakeFloor,
  tiebreakText,
  type CampaignRules,
  type Handicap,
  type LiveClock,
  type MissionKind,
  type MissionRules,
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

export const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Whether the campaign's stakes can be raised back and forth. */
export const backAndForth = (rules: CampaignRules) => rules.war.raise === 'matched' && rules.war.raises > 1;

export const otherPace = (pace: Pace): Pace => (pace === 'live' ? 'correspondence' : 'live');

/** The rules as they read at another pace: what the standard rules quote for the pace they don't play. */
const atPace = (rules: CampaignRules, pace: Pace): CampaignRules => ({ ...rules, war: { ...rules.war, pace } });

/**
 * A time that depends on the pace. A campaign's page quotes its own; the standard rules quote the
 * standard pace's, then the other's: "24 hours (5 minutes in live campaigns)".
 */
export function paceTimeText(rules: CampaignRules, standard: boolean, time: (rules: CampaignRules) => string): string {
  const own = time(rules);
  if (!standard) return own;
  const other = otherPace(rules.war.pace);
  return `${own} (${time(atPace(rules, other))} in ${other} campaigns)`;
}

/** How long a player has to answer a declaration, a counter, peace terms or an accord proposal. */
export const answerTimeText = (rules: CampaignRules, standard: boolean) =>
  paceTimeText(rules, standard, (r) => RESPONSE_WINDOW_TEXT[r.war.pace]);

/** How long a turn to declare lasts. */
export const turnTimeText = (rules: CampaignRules, standard: boolean) =>
  paceTimeText(rules, standard, (r) => TURN_WINDOW_TEXT[r.war.pace]);

/** How long players have to choose a secret mission once the draft ends. */
export const selectionTimeText = (rules: CampaignRules, standard: boolean) =>
  paceTimeText(rules, standard, (r) => durationText(selectionMs(r)));

/** How long a claim is held after the next round starts, where claims are held for a time. */
export const holdTimeText = (rules: CampaignRules, standard: boolean) =>
  paceTimeText(rules, standard, (r) => durationText(holdMs(r)));

export interface DeadlineRow {
  who: string;
  /** The time allowed at each pace asked for, in the order asked. */
  times: string[];
  silence: string;
}

/**
 * Everything that waits on a player, how long it waits at each of `paces`, and what silence does.
 * A campaign's page asks for its own pace; the standard rules for both.
 */
export function deadlineRows(rules: CampaignRules, paces: readonly Pace[] = [rules.war.pace]): DeadlineRow[] {
  const { war } = rules;
  const row = (who: string, time: (r: CampaignRules) => string, silence: string): DeadlineRow => ({
    who,
    times: paces.map((pace) => time(atPace(rules, pace))),
    silence,
  });
  const answer = (r: CampaignRules) => RESPONSE_WINDOW_TEXT[r.war.pace];
  return [
    ...(roundProgression(rules) === 'scheduled'
      ? [
          row(
            'A round runs its time',
            (r) => (roundProgression(r) === 'scheduled' ? hoursText(r.rounds.hours) : 'The host’s call'),
            'The next round starts by itself: turns not yet taken are lost, and wars carry on. After the last round, the campaign ends on points.',
          ),
        ]
      : []),
    ...(war.turns
      ? [
          row(
            'A player takes their turn to declare',
            (r) => TURN_WINDOW_TEXT[r.war.pace],
            'They pass, and are done declaring for the round.',
          ),
        ]
      : []),
    row('The defender answers a declaration', answer, 'The war goes ahead as declared.'),
    row(
      war.raise === 'off' ? 'The attacker replies to a redirect' : 'The attacker replies to a raise or redirect',
      answer,
      'The war is called off, and the token is spent.',
    ),
    ...(backAndForth(rules)
      ? [
          row('The defender answers the attacker’s raise', answer, 'They back down: the target goes to the attacker.'),
          row(
            'The attacker answers a raise after raising',
            answer,
            'They back down: the stake as declared goes to the defender.',
          ),
        ]
      : []),
    war.peaceTerms
      ? row(
          'A player answers peace terms',
          (r) => `${answer(r)}, or before their next move in the game`,
          'The offer lapses.',
        )
      : row('The attacker replies to a tribute offer', answer, 'The tribute is accepted.'),
    row('A player answers an accord proposal', answer, 'The proposal lapses.'),
    row(
      'A player moves',
      (r) => (r.war.pace === 'live' ? `On the clock, ${r.war.liveClock}` : perMoveText(r.war.hoursPerMove)),
      'They lose the game.',
    ),
    row('A player answers a result reported over the board', answer, 'The result stands.'),
    ...(rules.victory.mode === 'objectives'
      ? [
          row(
            'A player chooses a secret mission',
            (r) => durationText(selectionMs(r)),
            'The option that fits them best is chosen for them.',
          ),
        ]
      : []),
  ];
}

/** The most points missions can make: every public mission, and the secret. */
export const missionPointsMax = (cfg: MissionRules) => cfg.publicCount * cfg.points.public + cfg.points.secret;

/**
 * How points add up to a win, in a sentence or two: whether missions alone can get there (so
 * whether titles are ever needed) and, without titles, whether the secret is.
 */
export function winningMathText(cfg: MissionRules): string {
  const { public: pub, secret, toWin } = cfg.points;
  const most = missionPointsMax(cfg);
  const all = cfg.publicCount * pub;
  if (cfg.titles) {
    const each = cfg.titles.points;
    const titles = (n: number) => (n === 1 ? 'one title' : `${inWords(n)} titles`);
    if (most < toWin) {
      const need = Math.ceil((toWin - most) / each);
      return (
        `Missions make ${most} points at most, ${toWin - most} short of the ${toWin} to win, so a winner holds at ` +
        `least ${titles(need)} as well.`
      );
    }
    // A mix with one public mission fewer, made up with titles.
    const fewer = cfg.publicCount - 1;
    const short = toWin - (fewer * pub + secret);
    const mix = Math.ceil(short / each);
    const example =
      short > 0 && mix <= cfg.titles.kinds.length
        ? ` With titles, fewer missions will do: ${inWords(fewer)} public missions, the secret and ${titles(mix)} make ` +
          `${fewer * pub + secret + mix * each}.`
        : '';
    return (
      `Missions alone can make ${most} points (all ${inWords(cfg.publicCount)} public missions and the secret), ` +
      `${most > toWin ? 'more than' : 'exactly'} the ${toWin} to win, so no title is ever required.${example}`
    );
  }
  if (most < toWin) return `Missions make ${most} points at most, so a campaign can only end at its last round.`;
  const withSecret = Math.max(0, Math.ceil((toWin - secret) / pub));
  const without = Math.ceil(toWin / pub);
  const mix =
    withSecret === 0
      ? `The secret alone makes ${secret}`
      : `${sentenceCase(inWords(withSecret))} public ${withSecret === 1 ? 'mission' : 'missions'} and the secret make ${withSecret * pub + secret}`;
  const publicOnes = without === cfg.publicCount ? `all ${inWords(without)}` : inWords(without);
  return without <= cfg.publicCount
    ? `${mix}, and ${publicOnes} public ones make ${without * pub}, so a player can win without their secret.`
    : `${mix}; all ${inWords(cfg.publicCount)} public ones make only ${all}, so every winner needs their secret.`;
}

/**
 * Missions that are records, not positions (wars won, an accord broken): they score the moment
 * they're complete, with no claim. By scope, as the version deals them.
 */
export function recordMissions(cfg: MissionRules): { public: string[]; secret: string[] } {
  const records = (kinds: readonly MissionKind[]) =>
    kinds.filter((k) => MISSIONS[k].timing === 'historic').map((k) => kindName(k, cfg));
  return { public: records(cfg.publicKinds), secret: records(cfg.secretKinds) };
}

/** How a season ends when nobody reaches the target: "the most victory points win, then …". */
export const seasonEndText = (rules: CampaignRules) =>
  `the most victory points win, then ${tiebreakText(rules.victory.tiebreak)}`;

/** An Objectives campaign in a sentence, as the lobby offers it. */
export function objectivesText(rules: CampaignRules): string {
  const cfg = missionRules(rules.victory.version);
  const last = rules.victory.lastRound;
  return (
    `${sentenceCase(inWords(cfg.publicCount))} public missions and a secret one for each player` +
    `${cfg.titles ? ', and titles for leading the table' : ''}. The first to ${cfg.points.toWin} victory points wins` +
    `${last === null ? '' : `, or the most points when round ${last} ends`}.`
  );
}

/**
 * Why a campaign's Winning rules differ from the standard ones, if they do: it keeps the mission
 * rules version it was created with.
 */
export function missionVersionNote(rules: CampaignRules): string | null {
  const { version } = rules.victory;
  if (rules.victory.mode !== 'objectives' || version === CURRENT_MISSION_RULES) return null;
  const cfg = missionRules(version);
  const current = missionRules(CURRENT_MISSION_RULES);
  const changes = [
    cfg.points.toWin !== current.points.toWin && `${cfg.points.toWin} points to win`,
    !cfg.titles && current.titles && 'no titles',
  ].filter((s): s is string => Boolean(s));
  return `This campaign plays mission rules version ${version}, which it was created with${
    changes.length > 0 ? ` (${changes.join(', ')})` : ''
  }: the missions, numbers and points here are its own. New campaigns play version ${CURRENT_MISSION_RULES}.`;
}

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
          {
            label: 'Claims are held',
            value: holdsByTurns(rules)
              ? 'Until everyone has had their turns in a later round'
              : `${durationText(holdMs(rules))} after the next round starts`,
          },
          { label: 'Time to choose a secret', value: durationText(selectionMs(rules)) },
        ]
      : []),
    { label: 'Players', value: `Up to ${rules.maxPlayers}` },
    { label: 'Draft', value: rules.draft.mode === 'contiguous' ? 'Contiguous' : 'Free' },
    { label: 'Pace', value: war.pace === 'live' ? 'Live' : 'Correspondence' },
    { label: 'Time control', value: timeControlText(rules) },
    { label: 'Rounds', value: roundsText(rules) },
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

/** How the campaign's rounds move on, in a few words: "Started by the host", "On a schedule, 3 days each". */
export const roundsText = (rules: CampaignRules) =>
  roundProgression(rules) === 'scheduled'
    ? `On a schedule, ${hoursText(rules.rounds.hours)} each`
    : 'Started by the host';

/** The settings a campaign is summed up by, in this order, before the rest (`settingsList`). */
const KEY_SETTINGS = ['Pace', 'Time control', 'Rounds', 'Players', 'Draft', 'Victory', 'Last round'];

/** The few settings that sum a campaign up: its pace and clocks, the table, the draft and how it's won. */
export function keySettings(rules: CampaignRules): { label: string; value: string }[] {
  const listed = settingsList(rules);
  return KEY_SETTINGS.flatMap((label) => listed.filter((s) => s.label === label));
}

/**
 * The standard rules, what a quick start plays, at the campaign's pace and on its own mission rules
 * version and missions: what a campaign's settings are compared with.
 */
export function standardRules(rules: CampaignRules): CampaignRules {
  return {
    ...DEFAULT_RULES,
    war: { ...DEFAULT_RULES.war, pace: rules.war.pace },
    victory: {
      ...DEFAULT_RULES.victory,
      version: rules.victory.version,
      publicMissions: rules.victory.publicMissions,
    },
  };
}

/** The settings (`settingsList` labels) where a campaign differs from the standard rules at its pace. */
export function changedSettings(rules: CampaignRules): string[] {
  const standard = new Map(settingsList(standardRules(rules)).map((s) => [s.label, s.value]));
  return settingsList(rules)
    .filter((s) => standard.get(s.label) !== s.value)
    .map((s) => s.label);
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
