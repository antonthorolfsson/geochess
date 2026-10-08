import {
  canTakeTurn,
  durationText,
  joinWords,
  lastRoundOf,
  roundMs,
  roundReadiness,
  type ClaimAtRoundEnd,
  type ClaimView,
  type RoundReadiness,
} from '@empire/rules';
import type { CampaignModel } from './campaign';
import { formatWhen } from './format';
import { seasonEndText, sentenceCase, warTokens } from './rules-text';
import { claimTiming, findMission, titleOf } from './victory';
import { playerName, timeLeft } from './wars';

/**
 * How the round ends: when the host starts the next one (always, in a live campaign), at a time on
 * a schedule, or, with the schedule paused, once the time the round kept has run after it resumes.
 */
export type RoundClock =
  { kind: 'host' } | { kind: 'scheduled'; endsAt: number } | { kind: 'paused'; remainingMs: number };

export function roundClock(model: CampaignModel): RoundClock {
  const schedule = model.campaign.status === 'active' ? model.campaign.schedule : null;
  if (!schedule) return { kind: 'host' };
  if (schedule.paused) return { kind: 'paused', remainingMs: schedule.paused.remainingMs };
  return schedule.nextRoundAt ? { kind: 'scheduled', endsAt: Date.parse(schedule.nextRoundAt) } : { kind: 'host' };
}

/** What the round is waiting for, and what its end would do, as the rules see it now. */
export function readinessOf(model: CampaignModel, now: number): RoundReadiness {
  const { campaign, board } = model;
  const clock = roundClock(model);
  return roundReadiness({
    round: campaign.round,
    lastRound: lastRoundOf(campaign.rules),
    turns: campaign.turns,
    canAct: (userId) => canTakeTurn(board, userId, model.membersById.get(userId)?.tokens ?? 0),
    wars: model.activeWars,
    claims: campaign.victory?.claims ?? [],
    hold: campaign.victory?.hold ?? 'time',
    now,
    endsAt: clock.kind === 'scheduled' ? clock.endsAt : null,
  });
}

const who = (model: CampaignModel, userId: string) => (userId === model.me.userId ? 'you' : playerName(model, userId));
const whose = (model: CampaignModel, userId: string) =>
  userId === model.me.userId ? 'your' : `${playerName(model, userId)}’s`;

/** "Sat 10 Oct, 18:00 (in 1d 6h)". */
function whenText(at: number, now: number): string {
  return `${formatWhen(at)} (${at > now ? `in ${timeLeft(at - now)}` : 'any moment now'})`;
}

/** When the round ends, in a line: at the host's word, at a time on the schedule, or paused. */
export function roundEndText(model: CampaignModel, now: number): string {
  const { round } = model.campaign;
  const final = isFinal(model);
  const clock = roundClock(model);
  const host = model.isHost;
  switch (clock.kind) {
    case 'host':
      return final
        ? `The campaign ends on points when ${host ? 'you end' : 'the host ends'} this round.`
        : `${host ? 'You start' : 'The host starts'} the next round when the group is ready.`;
    case 'scheduled':
      return final
        ? `The campaign ends on points ${whenText(clock.endsAt, now)}.`
        : `Round ${round + 1} starts by itself ${whenText(clock.endsAt, now)}.`;
    case 'paused':
      return `${host ? 'You have' : 'The host has'} paused the schedule, with ${timeLeft(clock.remainingMs)} left ${
        final ? 'before the campaign ends' : 'in this round'
      }.`;
  }
}

const isFinal = (model: CampaignModel) => {
  const last = lastRoundOf(model.campaign.rules);
  return last !== null && model.campaign.round >= last;
};

/**
 * What the end of the last round does, whoever or whatever ends it: points decide it, and nothing
 * underway counts.
 */
export function finalRoundText(model: CampaignModel, toWin: number): string {
  return (
    `The last round: if nobody has reached ${toWin} points when it ends, ${seasonEndText(model.campaign.rules)}. ` +
    'Wars still underway then are called off, with nothing changing hands, and claims that haven’t scored don’t count.'
  );
}

/**
 * One line of the readiness summary:
 * - `done`: nothing to wait for.
 * - `waiting`: what the round's end would cut short.
 * - `note`: worth knowing, but nothing to wait for.
 */
export interface ReadinessItem {
  state: 'done' | 'waiting' | 'note';
  text: string;
}

export interface ReadinessText {
  /** "Before round 5", or "Before the campaign ends". */
  heading: string;
  /** Ready, or what the round is waiting for, in a line. */
  summary: string;
  /** What the round waits for: declaring, and in the last round, the wars and claims its end cuts short. */
  checklist: ReadinessItem[];
  /** Outside the last round: the wars that carry on into the next, in a line; null with none. */
  carries: string | null;
  /** Outside the last round: claims waiting to score, and what the round's end means for each. */
  claims: ReadinessItem[];
  /** What the round's end does to turns still to be taken; null when nobody is still to declare. */
  boundary: string | null;
}

/** The readiness summary in words: what's waiting, what carries on, and what the round's end does. */
export function readinessText(model: CampaignModel, r: RoundReadiness, now: number): ReadinessText {
  const { campaign } = model;
  const next = campaign.round + 1;
  const wars = r.answers.length + r.battles.length;
  const claims = r.claims.flatMap((c) => {
    const claim = campaign.victory?.claims.find((x) => x.id === c.claimId);
    return claim ? [claimItem(model, claim, c.atRoundEnd, now)] : [];
  });
  const checklist: ReadinessItem[] = [];
  if (campaign.turns) checklist.push(declaringItem(model, r, now));
  if (r.final) {
    checklist.push(
      wars === 0
        ? { state: 'done', text: 'No war underway.' }
        : {
            state: 'waiting',
            text: `${wars === 1 ? 'A war still underway is' : `${wars} wars still underway are`} called off if the campaign ends first, with nothing changing hands: ${warCounts(r)}.`,
          },
      ...claims,
    );
  }
  const chances = r.claims.filter((c) => c.atRoundEnd === 'last-chance').length;
  const waitingFor = [
    r.turnsLeft.length > 0 && 'declaring to finish',
    r.final && wars > 0 && (wars === 1 ? 'a war to end' : `${wars} wars to end`),
    r.final &&
      chances > 0 &&
      (chances === 1 ? 'a claim that could still score' : `${chances} claims that could still score`),
  ].filter((s): s is string => Boolean(s));
  return {
    heading: r.final ? 'Before the campaign ends' : `Before round ${next}`,
    summary: r.ready
      ? `Nothing is cut short if ${r.final ? 'the campaign ends' : `round ${next} starts`} now.`
      : `Waiting for ${joinWords(waitingFor)}.`,
    checklist,
    carries:
      r.final || wars === 0
        ? null
        : `${wars === 1 ? 'A war carries' : `${wars} wars carry`} on into round ${next} as ${wars === 1 ? 'it stands' : 'they stand'}, deadlines and clocks too, and ${wars === 1 ? 'its' : 'their'} countries stay locked: ${warCounts(r)}.`,
    claims: r.final ? [] : claims,
    boundary: r.final || r.turnsLeft.length === 0 ? null : boundaryText(model),
  };
}

/** "1 answer due, 2 battles underway and 1 game waiting to start". */
function warCounts(r: RoundReadiness): string {
  const queued = r.battles.filter((b) => b.queued).length;
  const fought = r.battles.length - queued;
  const count = (n: number, one: string, many: string) => (n === 0 ? null : `${n} ${n === 1 ? one : many}`);
  return joinWords(
    [
      count(r.answers.length, 'answer due', 'answers due'),
      count(fought, 'battle underway', 'battles underway'),
      count(queued, 'game waiting to start', 'games waiting to start'),
    ].filter((s): s is string => s !== null),
  );
}

function declaringItem(model: CampaignModel, r: RoundReadiness, now: number): ReadinessItem {
  const [first, ...rest] = r.turnsLeft;
  if (!first) return { state: 'done', text: 'Declaring is over for this round.' };
  const deadline = model.campaign.turns?.deadline;
  const left = deadline ? `, ${timeLeft(Date.parse(deadline) - now)} left` : '';
  const turn = first === model.me.userId ? 'Your turn' : `${playerName(model, first)}’s turn`;
  const then = rest.length > 0 ? `; then ${joinWords(rest.map((id) => who(model, id)))}` : '';
  return { state: 'waiting', text: `${turn} to declare${left}${then}.` };
}

function claimItem(model: CampaignModel, claim: ClaimView, at: ClaimAtRoundEnd, now: number): ReadinessItem {
  const played = findMission(model, claim.userId, claim.missionKey);
  const subject = `${sentenceCase(whose(model, claim.userId))} claim on ${played ? titleOf(played.mission) : 'a mission'}`;
  const next = model.campaign.round + 1;
  switch (at) {
    case 'scores':
      return { state: 'note', text: `${subject} scores as round ${next} starts, if the position still holds.` };
    case 'delayed':
      return {
        state: 'note',
        text: `${subject} waits for everyone’s turns this round: if round ${next} starts first, it waits for round ${next}’s.`,
      };
    case 'waits': {
      const timing = claimTiming(model, claim, now);
      const war = timing.blockers.length > 0 ? ' A war underway could still break it.' : '';
      return {
        state: 'note',
        text: `${subject}: ${lowerFirst(timing.round)}${timing.hold ? ` ${timing.hold}` : ''}${war}`,
      };
    }
    case 'last-chance': {
      const timing = claimTiming(model, claim, now);
      const what = timing.hold ?? (timing.blockers.length > 0 ? 'A war underway could still break it.' : '');
      return { state: 'waiting', text: `${subject} can still score before the end.${what ? ` ${what}` : ''}` };
    }
    case 'too-late':
      return {
        state: 'note',
        text: `${subject} can’t score before the campaign ends: ${
          claim.eligibleRound > model.campaign.round
            ? `round ${claim.eligibleRound} would be its first`
            : 'its holding time runs past the end'
        }.`,
      };
  }
}

/** What the round's end does to turns still to be taken, following the rules for any round's end. */
function boundaryText(model: CampaignModel): string {
  const { round, rules } = model.campaign;
  const clock = roundClock(model);
  const lost = `anyone still to declare loses the rest of their turns this round. Unused war tokens carry over, up to ${rules.war.tokenCap}.`;
  return clock.kind === 'scheduled'
    ? `Round ${round + 1} starts at ${formatWhen(clock.endsAt)} even if declaring isn’t over: ${lost}`
    : `If round ${round + 1} starts before declaring is over, ${lost}`;
}

/** What the host's Next round (or, in the last round, End the campaign) would do, to confirm it. */
export function nextRoundQuestion(model: CampaignModel, r: RoundReadiness): string {
  const { campaign } = model;
  const { rules } = campaign;
  const clock = roundClock(model);
  const ahead = clock.kind === 'scheduled' ? ` now, ahead of ${formatWhen(clock.endsAt)}` : '';
  const wars = r.answers.length + r.battles.length;
  if (r.final) {
    const chances = r.claims.filter((c) => c.atRoundEnd === 'last-chance').length;
    return (
      `Round ${campaign.round} was the last. End the campaign${ahead}? ${sentenceCase(seasonEndText(rules))}.` +
      (wars > 0 ? ` ${wars === 1 ? 'A war still underway is' : `${wars} wars still underway are`} called off.` : '') +
      (chances > 0
        ? ` ${chances === 1 ? 'A claim that could still score this round doesn’t' : `${chances} claims that could still score this round don’t`} count.`
        : '')
    );
  }
  const next = campaign.round + 1;
  const parts = [
    `Start round ${next}${ahead}? Everyone gains ${warTokens(rules.war.tokensPerRound)}, up to ${rules.war.tokenCap}.`,
  ];
  if (r.turnsLeft.length > 0) {
    const names = sentenceCase(joinWords(r.turnsLeft.map((id) => who(model, id))));
    const one = r.turnsLeft.length === 1 && r.turnsLeft[0] !== model.me.userId;
    parts.push(`${names} ${one ? 'hasn’t' : 'haven’t'} finished declaring: turns not yet taken this round are lost.`);
  }
  const delayed = r.claims.filter((c) => c.atRoundEnd === 'delayed');
  if (delayed.length > 0) {
    parts.push(
      `${delayed.length === 1 ? `${sentenceCase(whose(model, delayed[0]!.userId))} claim then waits` : `${delayed.length} claims then wait`} for round ${next}’s turns.`,
    );
  }
  if (wars > 0) parts.push(`${wars === 1 ? 'A war carries' : `${wars} wars carry`} on into round ${next}.`);
  if (clock.kind === 'scheduled') parts.push(`Round ${next} then runs ${durationText(roundMs(rules))} from now.`);
  return parts.join(' ');
}

/** To confirm pausing the schedule. */
export function pauseQuestion(model: CampaignModel, now: number): string {
  const clock = roundClock(model);
  const left =
    clock.kind === 'scheduled' ? ` the ${timeLeft(clock.endsAt - now)} it has left` : ' the time it has left';
  return (
    `Pause the schedule? Round ${model.campaign.round} keeps${left} until you resume it. ` +
    'Turns, answers and games keep their own deadlines meanwhile.'
  );
}

/** To confirm resuming the schedule. */
export function resumeQuestion(model: CampaignModel, now: number): string {
  const clock = roundClock(model);
  const remaining = clock.kind === 'paused' ? clock.remainingMs : 0;
  const ends = isFinal(model) ? 'The campaign then ends on points' : `Round ${model.campaign.round} then ends`;
  return `Resume the schedule? ${ends} ${formatWhen(now + remaining)}, in ${timeLeft(remaining)}.`;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
