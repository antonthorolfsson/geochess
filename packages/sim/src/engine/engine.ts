/**
 * One whole campaign: lobby, draft, selection, then rounds until someone wins (or the round cap).
 * Each round: diplomacy, then waves of declarations (in turns, where the rules have them), answers,
 * replies and the games that are due.
 */
import { heldBy, lastRoundOf, seasonMeasures, seasonWinners, shuffled, type UserId } from '@empire/rules';
import type { Bots } from '../bots';
import { loadDataset } from '../dataset';
import { checkInvariants } from './invariants';
import { beginSelection, nextRound, openCampaign, recordTimeline, runDraft, setupPublicMissions } from './lifecycle';
import { createState } from './state';
import type { SimConfig, SimState, SimWar } from './types';
import { pass } from './turns';
import { finish, settle } from './victory';
import { missionWorld } from './world';
import { answerPeace, declare, fight, fortify, offerPeace, recall, reply, respond, type Reply } from './wars';

export interface RunOptions {
  bots: Bots;
  idx?: ReturnType<typeof loadDataset>;
}

/** What a silent player does (the server's `expireResponses`), for an answer the rules refused. */
const silentReply = (war: SimWar): Reply =>
  war.counter?.kind === 'tribute' ? { kind: 'accept' } : { kind: 'withdraw' };

function fail(s: SimState, what: string): void {
  if (s.cfg.debug) throw new Error(`${what} (seed ${s.seed}, round ${s.round})`);
}

/**
 * Declaring in turns: whoever's turn it is fortifies (their first turn of the round, if they want
 * to), declares one war, or passes, until everyone is done.
 */
function takeTurns(s: SimState, bots: Bots): void {
  const considered = new Set<UserId>();
  while (s.status === 'active' && s.turns?.current) {
    const id = s.turns.current;
    const player = s.byId.get(id)!;
    if (!considered.has(id)) {
      considered.add(id);
      const spot = bots.fortify(s, player);
      if (spot) {
        const refused = fortify(s, id, spot);
        if (!refused) continue;
        fail(s, `${id} fortified ${spot} illegally: ${refused}`);
      }
    }
    const d = player.tokens > 0 ? bots.declare(s, player, 0) : null;
    if (d) {
      const war = declare(s, id, d);
      if (typeof war !== 'string') {
        if (s.cfg.debug) checkInvariants(s);
        continue;
      }
      fail(s, `${id} declared an illegal war on ${d.targetId}: ${war}`);
    }
    const refused = pass(s, id);
    if (refused) {
      fail(s, `${id} couldn't pass: ${refused}`);
      return;
    }
  }
}

/** Anyone declares whenever they like: each player in a random order fortifies, then declares all they want. */
function declareFreely(s: SimState, bots: Bots, wave: number): void {
  for (const id of shuffled(s.order, s.rng.order)) {
    const player = s.byId.get(id)!;
    // A country to fortify, once a round, before declaring.
    const fortified = wave === 0 && s.status === 'active' ? bots.fortify(s, player) : null;
    if (fortified) {
      const refused = fortify(s, id, fortified);
      if (refused) fail(s, `${id} fortified ${fortified} illegally: ${refused}`);
    }
    while (player.tokens > 0 && s.status === 'active') {
      const d = bots.declare(s, player, wave);
      if (!d) break;
      const war = declare(s, id, d);
      if (typeof war === 'string') {
        fail(s, `${id} declared an illegal war on ${d.targetId}: ${war}`);
        break;
      }
      if (s.cfg.debug) checkInvariants(s);
    }
  }
}

function playRound(s: SimState, bots: Bots): void {
  bots.diplomacy(s);
  for (let wave = 0; wave < s.cfg.waves && s.status === 'active'; wave++) {
    // With turns, declaring is over once everyone has passed: later waves only answer and fight.
    if (!s.turns) declareFreely(s, bots, wave);
    else if (wave === 0) takeTurns(s, bots);
    if (s.rules.war.recall) {
      for (const war of s.wars.filter((w) => w.status === 'declared')) {
        if (!bots.recall(s, war)) continue;
        const refused = recall(s, war);
        if (refused) fail(s, `${war.attackerId} called off ${war.id} illegally: ${refused}`);
        if (s.status !== 'active') return;
      }
    }
    for (const war of shuffled(
      s.wars.filter((w) => w.status === 'declared'),
      s.rng.order,
    )) {
      if (war.status !== 'declared') continue;
      let answer = bots.respond(s, war);
      if (answer.kind === 'peace') {
        // Terms first; turned down, the fallback answers the declaration.
        const offer = offerPeace(s, war, war.defenderId, answer.terms);
        if (typeof offer === 'string') fail(s, `${war.defenderId} offered illegal terms in ${war.id}: ${offer}`);
        else {
          const refused = answerPeace(s, war, offer, bots.answerPeace(s, war, offer));
          if (refused) fail(s, `${war.attackerId} answered terms in ${war.id} illegally: ${refused}`);
        }
        if (s.status !== 'active') return;
        if (war.status !== 'declared') continue;
        answer = answer.fallback;
      }
      const refused = respond(s, war, answer);
      if (refused) {
        fail(s, `${war.defenderId} answered ${war.id} illegally: ${refused}`);
        respond(s, war, { kind: 'accept' });
      }
      if (s.status !== 'active') return;
    }
    for (const war of shuffled(
      s.wars.filter((w) => w.status === 'countered'),
      s.rng.order,
    )) {
      const refused = reply(s, war, bots.reply(s, war));
      if (refused) {
        fail(s, `${war.attackerId} replied to ${war.id} illegally: ${refused}`);
        reply(s, war, silentReply(war));
      }
      if (s.status !== 'active') return;
    }
    for (const war of shuffled(
      s.wars.filter((w) => w.status === 'ready' && w.dueRound <= s.round),
      s.rng.order,
    )) {
      fight(s, war);
      if (s.cfg.debug) checkInvariants(s);
      if (s.status !== 'active') return;
    }
  }
}

/**
 * The host moves on from the last round (the server's `endSeason`): missions are brought up to
 * date, and unless that finishes the campaign, the most points win, then the campaign's tiebreak.
 */
function endSeason(s: SimState): void {
  s.actions.push({ t: 'end' });
  settle(s);
  if (s.status !== 'active') return;
  const world = missionWorld(s);
  const standings = new Map(
    s.players.map((p) => [
      p.id,
      {
        points: s.points.get(p.id) ?? 0,
        measures: seasonMeasures(s.idx, heldBy(world.owners, p.id), s.rules.victory.tiebreak),
      },
    ]),
  );
  s.endedByLimit = true;
  finish(s, seasonWinners(standings));
}

export function runCampaign(cfg: SimConfig, seed: number, opts: RunOptions): SimState {
  const s = createState(cfg, opts.idx ?? loadDataset(), seed);
  const { bots } = opts;
  setupPublicMissions(s);
  runDraft(s, bots.draftPick);
  bots.diplomacy(s);
  beginSelection(s, bots.chooseSecret);
  openCampaign(s);
  while (s.status === 'active') {
    playRound(s, bots);
    recordTimeline(s);
    const last = cfg.mode === 'normal' ? lastRoundOf(s.rules) : null;
    if (s.status === 'active' && last !== null && s.round >= last) {
      endSeason(s);
      break;
    }
    if (s.status !== 'active' || s.round >= cfg.roundCap) break;
    nextRound(s);
  }
  if (s.status === 'finished') recordTimeline(s);
  if (cfg.debug) checkInvariants(s);
  return s;
}
