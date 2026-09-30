/**
 * What a campaign's bots do next, one action at a time, from a snapshot: first anything waiting
 * on a bot's answer (accord proposals, secret missions, peace offers, declarations, counters),
 * then each bot's round (breaking and proposing accords, fortifying), then declarations.
 */
import { shuffled, type TerritoryId, type WarCounter } from '@empire/rules';
import type { Answer, Declaration, LiveBots, Reply, SimState } from '@empire/sim/live';
import type { MemberRow } from '../campaigns/mutate';
import type { AppContext } from '../context';
import { botState, botsIn, type Snapshot } from './state';

export type BotAction =
  | { kind: 'accord'; botId: string; accordId: string; accept: boolean }
  | { kind: 'secret'; botId: string; optionId: string }
  | { kind: 'peace'; botId: string; warId: string; offerId: string; accept: boolean }
  | { kind: 'respond'; botId: string; warId: string; answer: Answer }
  /** `counter`: what the attacker is answering, for the silent answer should this one fail. */
  | { kind: 'reply'; botId: string; warId: string; counter: WarCounter['kind']; reply: Reply }
  | { kind: 'renounce'; botId: string; accordId: string }
  /** The bot's round: an accord to propose and a country to fortify, if any. Done once a round. */
  | { kind: 'round'; botId: string; round: number; propose: string | null; fortify: TerritoryId | null }
  | { kind: 'declare'; botId: string; declaration: Declaration };

/** Names an action on a thing, so one that failed isn't tried again in the same pass. */
export function actionKey(a: BotAction): string {
  switch (a.kind) {
    case 'accord':
    case 'renounce':
      return `${a.kind}:${a.accordId}`;
    case 'peace':
      return `peace:${a.offerId}`;
    case 'respond':
    case 'reply':
      return `${a.kind}:${a.warId}`;
    case 'secret':
    case 'declare':
      return `${a.kind}:${a.botId}`;
    case 'round':
      return `round:${a.botId}:${a.round}`;
  }
}

export interface Decider {
  ctx: AppContext;
  bots: LiveBots;
  random(): number;
}

/** One bot's view, built once per snapshot. */
function views(d: Decider, snap: Snapshot): (botId: string) => SimState {
  const built = new Map<string, SimState>();
  return (botId) => {
    let s = built.get(botId);
    if (!s) built.set(botId, (s = botState(d.ctx, snap, botId, Math.floor(d.random() * 2 ** 31))));
    return s;
  };
}

/** Whether the bot whose view `s` is takes the peace terms offered to it. */
export function acceptsPeace(d: Decider, s: SimState, offerId: string): boolean {
  const offer = s.peaceOffers.find((o) => o.id === offerId);
  const war = offer && s.wars.find((w) => w.id === offer.warId);
  return offer && war ? d.bots.answerPeace(s, war, offer) : false;
}

/** The next thing a bot in this campaign does, or null if they're all done. `skip` lists actions that failed. */
export function nextAction(d: Decider, snap: Snapshot, skip: ReadonlySet<string>): BotAction | null {
  const { campaign } = snap;
  const status = campaign.status;
  if (status === 'lobby' || status === 'finished') return null;
  const view = views(d, snap);
  const bots = shuffled(botsIn(snap), d.random);
  const fresh = (a: BotAction | null): a is BotAction => a !== null && !skip.has(actionKey(a));

  for (const bot of bots) {
    const action = owedBy(d, snap, bot, view, fresh);
    if (action) return action;
  }
  if (status === 'selection' || status === 'active') {
    for (const bot of bots) {
      if (bot.botRound !== null && bot.botRound >= campaign.round) continue;
      const action = roundFor(d, snap, bot, view, skip);
      if (fresh(action)) return action;
    }
  }
  if (status === 'active') {
    for (const bot of bots) {
      if (bot.tokens < 1) continue;
      const s = view(bot.userId);
      const declaration = d.bots.declare(s, s.byId.get(bot.userId)!);
      const action: BotAction | null = declaration ? { kind: 'declare', botId: bot.userId, declaration } : null;
      if (fresh(action)) return action;
    }
  }
  return null;
}

/** Something waiting on this bot's answer. */
function owedBy(
  d: Decider,
  snap: Snapshot,
  bot: MemberRow,
  view: (botId: string) => SimState,
  fresh: (a: BotAction | null) => a is BotAction,
): BotAction | null {
  const id = bot.userId;
  const status = snap.campaign.status;
  for (const a of snap.accords) {
    if (a.status !== 'proposed' || a.recipientId !== id) continue;
    const s = view(id);
    const accord = s.accords.find((x) => x.id === a.id)!;
    const action: BotAction = { kind: 'accord', botId: id, accordId: a.id, accept: d.bots.accept(s, accord) };
    if (fresh(action)) return action;
  }
  if (status === 'selection') {
    const mine = snap.players.find((p) => p.userId === id);
    if (mine && !mine.secret && !mine.noSecret && mine.options.length > 0) {
      const s = view(id);
      const option = d.bots.chooseSecret(s, s.byId.get(id)!) ?? mine.options[0]!;
      const action: BotAction = { kind: 'secret', botId: id, optionId: option.id };
      if (fresh(action)) return action;
    }
  }
  if (status !== 'active') return null;
  for (const o of snap.peace) {
    if (o.recipientId !== id) continue;
    const action: BotAction = {
      kind: 'peace',
      botId: id,
      warId: o.warId,
      offerId: o.id,
      accept: acceptsPeace(d, view(id), o.id),
    };
    if (fresh(action)) return action;
  }
  for (const w of snap.wars) {
    if (w.status === 'declared' && w.defenderId === id) {
      const s = view(id);
      const action: BotAction = {
        kind: 'respond',
        botId: id,
        warId: w.id,
        answer: d.bots.respond(
          s,
          s.wars.find((x) => x.id === w.id)!,
        ),
      };
      if (fresh(action)) return action;
    }
    if (w.status === 'countered' && w.attackerId === id && w.counter) {
      const s = view(id);
      const action: BotAction = {
        kind: 'reply',
        botId: id,
        warId: w.id,
        counter: w.counter.kind,
        reply: d.bots.reply(
          s,
          s.wars.find((x) => x.id === w.id)!,
        ),
      };
      if (fresh(action)) return action;
    }
  }
  return null;
}

/**
 * The bot's round: first any accord it breaks (one at a time, each on a fresh view), then the
 * accord it proposes and the country it fortifies. Proposals are private, so it can only rule out
 * players it has a proposal with itself.
 */
function roundFor(
  d: Decider,
  snap: Snapshot,
  bot: MemberRow,
  view: (botId: string) => SimState,
  skip: ReadonlySet<string>,
): BotAction {
  const id = bot.userId;
  const active = snap.campaign.status === 'active';
  const s = view(id);
  const player = s.byId.get(id)!;
  if (active) {
    const broken = d.bots.renounce(s, player);
    const renounce: BotAction | null = broken ? { kind: 'renounce', botId: id, accordId: broken.id } : null;
    // Should breaking it fail, the round goes on without.
    if (renounce && !skip.has(actionKey(renounce))) return renounce;
  }
  const waiting = new Set(
    snap.accords
      .filter((a) => a.status === 'proposed' && (a.proposerId === id || a.recipientId === id))
      .map((a) => (a.proposerId === id ? a.recipientId : a.proposerId)),
  );
  return {
    kind: 'round',
    botId: id,
    round: snap.campaign.round,
    propose: d.bots.propose(s, player, (partnerId) => waiting.has(partnerId)),
    fortify: active ? d.bots.fortify(s, player) : null,
  };
}
