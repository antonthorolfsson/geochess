/**
 * What a war could change, in words: its endings as things stand (the game won, lost or drawn,
 * under the campaign's own draw rule), the other ways it can still end now (backing down, tribute,
 * peace terms the viewer was offered or offered), and what could still change it before the game.
 *
 * Every number comes from the rules package: what changes hands from `warTransfers` and
 * `peaceTransfers`, and what that does to titles, missions, points and the campaign from
 * `projectWar`, which scores with the functions the server does. This file only picks the endings
 * and words them.
 */
import {
  ARMAGEDDON_BLACK_TIME,
  TITLES,
  activeWar,
  addedCountries,
  attackerRaised,
  canRaise,
  canRaiseAgain,
  claimsHeldUp,
  counterCost,
  matchedRaiseRange,
  missionName,
  openWarOf,
  owedByDefender,
  partAmount,
  peaceTransfers,
  projectWar,
  projectedWarOf,
  raiseAnswerer,
  raiseDemand,
  raiseOptions,
  raisesMade,
  redirectOptions,
  scoreStateFrom,
  tributeOptions,
  valueOf,
  warTransfers,
  type CampaignView,
  type EndingProjection,
  type MissionEffect,
  type PeaceOfferView,
  type PendingClaim,
  type ScoreState,
  type TerritoryId,
  type Transfer,
  type WarBoard,
  type WarEnding,
  type WarOutcome,
  type WarView,
} from '@empire/rules';
import type { CampaignModel } from './campaign';
import { countryName, playerName, tokensText } from './wars';

/** The campaign as the viewer may preview it; null outside the war or without victory points. */
export type PreviewState = ScoreState & { missionsKnown: boolean };

const states = new WeakMap<CampaignView, PreviewState | null>();

/** The preview state of the campaign view the model was built from, worked out once per view. */
export function previewState(model: CampaignModel, now = Date.now()): PreviewState | null {
  const view = model.campaign;
  if (!states.has(view)) states.set(view, scoreStateFrom(view, model.me.userId, model.board, now));
  return states.get(view)!;
}

/** The id a war being declared goes by in previews, before it has one. */
export const PROPOSED_WAR_ID = 'proposed';

/** A war the viewer is about to declare, as the previews read wars. */
export function proposedWar(
  model: CampaignModel,
  targetId: TerritoryId,
  draft: { launchId: TerritoryId; stake: readonly TerritoryId[] },
  reserves: readonly TerritoryId[] = [],
): WarView {
  return {
    id: PROPOSED_WAR_ID,
    attackerId: model.me.userId,
    defenderId: model.owners.get(targetId) ?? '',
    targetId,
    launchId: draft.launchId,
    stake: [...draft.stake],
    redirectedFrom: null,
    status: 'declared',
    counter: null,
    outcome: null,
    declaredRound: model.campaign.round,
    resolvedRound: null,
    respondBy: null,
    declaredAt: '',
    resolvedAt: null,
    games: [],
    reserves: [...reserves],
    peace: [],
  };
}

/** One way a war could end, from the viewer's side. */
export interface EndingView {
  key: string;
  /** "If you win", "If Bo wins", "If drawn", "If Bo backs down". */
  label: string;
  /** Good or bad for the viewer, where they're one of the two at war. */
  tone: 'good' | 'bad' | 'even';
  /** What happens, in a sentence: what changes hands, or why that isn't known yet. */
  summary: string;
  /** The ending as the rules see it; null when it isn't settled yet (a stake still to choose, Armageddon to come). */
  ending: WarEnding | null;
  projection: EndingProjection | null;
  /** The same win by checkmate, where that would count for a mission the viewer can see. */
  byMate: EndingProjection | null;
}

export interface WarOutlook {
  /** The game's endings, on the terms as they stand. */
  current: EndingView[];
  /** Other ways the war can end now, without the game: backing down, tribute, peace terms. */
  alternatives: EndingView[];
  /** What could still change the terms before the game, in lines. */
  later: string[];
  /** Why the preview can't be certain, in lines. */
  provisional: string[];
  /** Pending claims this war holds up while it lasts. */
  heldUp: PendingClaim[];
  /** The preview couldn't read the missions (an older server): only the map, titles and points. */
  missionsUnknown: boolean;
}

const you = (model: CampaignModel, userId: string) => (userId === model.me.userId ? 'you' : playerName(model, userId));
const You = (model: CampaignModel, userId: string) => (userId === model.me.userId ? 'You' : playerName(model, userId));
const yours = (model: CampaignModel, userId: string) =>
  userId === model.me.userId ? 'your' : `${playerName(model, userId)}’s`;
const s = (model: CampaignModel, userId: string) => (userId === model.me.userId ? '' : 's');

/** Words in a list: "Italy", "France and Andorra", "Peru, Chile and Bolivia". */
const listText = (words: readonly string[]) =>
  words.length <= 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

/** "Italy (14)", "France and Andorra (15)". */
export function countriesText(model: CampaignModel, ids: readonly TerritoryId[]): string {
  return `${listText(ids.map((id) => countryName(model, id)))} (${valueOf(model.idx, ids)})`;
}

/** What changes hands, in a sentence: "You take Italy (14)." "Nothing changes hands." */
export function transfersText(model: CampaignModel, transfers: readonly Transfer[]): string {
  if (transfers.length === 0) return 'Nothing changes hands.';
  const byTaker = new Map<string, TerritoryId[]>();
  for (const t of transfers) byTaker.set(t.to, [...(byTaker.get(t.to) ?? []), t.territoryId]);
  return [...byTaker]
    .map(([to, ids]) => `${You(model, to)} take${s(model, to)} ${countriesText(model, ids)}.`)
    .join(' ');
}

function tone(model: CampaignModel, war: Pick<WarView, 'attackerId' | 'defenderId'>, winner: string | null) {
  const me = model.me.userId;
  if (winner === null || (war.attackerId !== me && war.defenderId !== me)) return 'even' as const;
  return winner === me ? ('good' as const) : ('bad' as const);
}

interface Options {
  /** The stake the viewer is building (declaring, or meeting a raise), in place of the war's. */
  stake?: readonly TerritoryId[];
}

/**
 * Everything a war could change, from where it stands. A war being declared is a `proposedWar`.
 * Returns null where nothing can be previewed (no victory points, or not at war).
 */
export function warOutlook(model: CampaignModel, war: WarView, opts: Options = {}): WarOutlook | null {
  const state = previewState(model);
  if (!state || war.status === 'resolved') return null;
  const proposed = war.id === PROPOSED_WAR_ID;
  // A war being declared isn't on the board yet: it locks its countries like any other.
  const board: WarBoard = proposed ? { ...model.board, wars: [...model.board.wars, activeWar(war)] } : model.board;
  const attacker = playerName(model, war.attackerId);
  const defender = playerName(model, war.defenderId);
  const counter = war.counter;
  const added = addedCountries(counter);
  const target = model.idx.byId.get(war.targetId);
  const current: Omit<EndingView, 'projection' | 'byMate'>[] = [];
  const alternatives: Omit<EndingView, 'projection' | 'byMate'>[] = [];
  const later: string[] = [];
  const end = (outcome: WarOutcome, transfers: Transfer[], endReason: WarEnding['endReason'] = null): WarEnding => ({
    outcome,
    transfers,
    endReason,
  });

  // The game, fought for `targetId` (and what raises put in) against `stake`, where it's known.
  const fight = (targetId: TerritoryId, stake: readonly TerritoryId[] | null, more?: string) => {
    const fought = { ...war, targetId, stake: stake ? [...stake] : war.stake, added };
    const win = end('attacker', warTransfers(fought, 'attacker'), 'resignation');
    const winSummary = transfersText(model, win.transfers).replace(/\.$/, more ? `, ${more}.` : '.');
    const loss = stake ? end('defender', warTransfers(fought, 'defender'), 'resignation') : null;
    const lossSummary = loss
      ? transfersText(model, loss.transfers)
      : `${You(model, war.defenderId)} take${s(model, war.defenderId)} ${yours(model, war.attackerId)} stake, which must reach ${counter?.kind === 'raise' ? counter.minValue : valueOf(model.idx, war.stake)}.`;
    const me = model.me.userId;
    const attackerWins = {
      key: 'win',
      label: war.attackerId === me ? 'If you win' : war.defenderId === me ? 'If you lose' : `If ${attacker} wins`,
      tone: tone(model, war, war.attackerId),
      summary: winSummary,
      ending: win,
    };
    const defenderWins = {
      key: 'loss',
      label: war.defenderId === me ? 'If you win' : war.attackerId === me ? 'If you lose' : `If ${defender} wins`,
      tone: tone(model, war, war.defenderId),
      summary: lossSummary,
      ending: loss,
    };
    current.push(...(war.defenderId === model.me.userId ? [defenderWins, attackerWins] : [attackerWins, defenderWins]));
    // A draw, by the campaign's own rule.
    const armageddon = war.games.at(-1)?.armageddon ?? false;
    if (armageddon) {
      current.push({
        key: 'draw',
        label: 'If drawn',
        tone: tone(model, war, war.attackerId),
        summary: `Black wins a drawn Armageddon. ${winSummary}`,
        ending: win,
      });
    } else if (model.campaign.rules.war.draws === 'armageddon') {
      current.push({
        key: 'draw',
        label: 'If drawn',
        tone: 'even',
        summary: `An Armageddon game decides it: ${you(model, war.attackerId)} play${s(model, war.attackerId)} Black with ${Math.round(ARMAGEDDON_BLACK_TIME * 100)}% of White’s time, and a draw then goes to ${you(model, war.attackerId)}.`,
        ending: null,
      });
    } else {
      current.push({
        key: 'draw',
        label: 'If drawn',
        tone: 'even',
        summary: `${countryName(model, targetId)} holds: nothing changes hands.`,
        ending: end('held', [], 'agreement'),
      });
    }
  };

  const rules = model.campaign.rules.war;
  const active = board.wars.find((w) => w.id === war.id);
  switch (war.status) {
    case 'declared': {
      fight(war.targetId, opts.stake ?? war.stake);
      if (active) later.push(...answersBefore(model, board, war));
      break;
    }
    case 'countered': {
      if (!counter) break;
      if (counter.kind === 'raise' && raiseAnswerer(counter) === 'attacker') {
        fight(war.targetId, opts.stake ?? null);
        if (attackerRaised(counter)) {
          alternatives.push({
            key: 'forfeit',
            label: war.attackerId === model.me.userId ? 'If you back down' : `If ${attacker} backs down`,
            tone: tone(model, war, war.defenderId),
            summary: `${transfersText(model, warTransfers(war, 'forfeited'))} No game is played.`,
            ending: end('forfeited', warTransfers(war, 'forfeited')),
          });
        } else {
          alternatives.push({
            key: 'withdraw',
            label: war.attackerId === model.me.userId ? 'If you withdraw' : `If ${attacker} withdraws`,
            tone: 'even',
            summary: `Nothing changes hands, and ${yours(model, war.attackerId)} war token is lost.`,
            ending: end('withdrawn', []),
          });
        }
        if (canRaiseAgain(model.campaign.rules, counter)) {
          const left = rules.raises - raisesMade(counter);
          later.push(
            `${You(model, war.attackerId)} may raise again rather than only meet it: ${left} more ${left === 1 ? 'raise' : 'raises'} can go back and forth, each putting more at stake on both sides.`,
          );
        }
      } else if (counter.kind === 'raise') {
        // The attacker raised again: the defender meets it with one more country, or backs down.
        const owed = owedByDefender(counter);
        fight(
          war.targetId,
          war.stake,
          `and the country ${you(model, war.defenderId)} put${s(model, war.defenderId)} in to meet the raise (worth ${owed} or more)`,
        );
        alternatives.push({
          key: 'yield',
          label: war.defenderId === model.me.userId ? 'If you back down' : `If ${defender} backs down`,
          tone: tone(model, war, war.attackerId),
          summary: `${transfersText(model, warTransfers(war, 'yielded'))} No game is played.`,
          ending: end('yielded', warTransfers(war, 'yielded')),
        });
        if (canRaiseAgain(model.campaign.rules, counter)) {
          later.push(`${You(model, war.defenderId)} may raise again with a country worth more still.`);
        }
      } else if (counter.kind === 'redirect') {
        fight(counter.targetId, war.stake);
        alternatives.push({
          key: 'withdraw',
          label: war.attackerId === model.me.userId ? 'If you withdraw' : `If ${attacker} withdraws`,
          tone: 'even',
          summary: `Nothing changes hands, and ${yours(model, war.attackerId)} war token is lost.`,
          ending: end('withdrawn', []),
        });
      } else {
        const transfers: Transfer[] = counter.territoryId
          ? [{ territoryId: counter.territoryId, from: war.defenderId, to: war.attackerId }]
          : [];
        alternatives.push({
          key: 'tribute',
          label:
            war.attackerId === model.me.userId ? 'If you accept the tribute' : `If ${attacker} accepts the tribute`,
          tone: tone(model, war, war.attackerId),
          summary: counter.territoryId
            ? transfersText(model, transfers)
            : `${tokensText(counter.tokens)} go${counter.tokens === 1 ? 'es' : ''} to ${you(model, war.attackerId)}; nothing changes hands.`,
          ending: end('tribute', transfers),
        });
        fight(war.targetId, war.stake);
      }
      break;
    }
    case 'ready':
    case 'playing':
      fight(war.targetId, war.stake);
      break;
  }
  if (rules.peaceTerms) {
    later.push(
      war.attackerId === model.me.userId || war.defenderId === model.me.userId
        ? 'Either of you can offer peace terms until the game ends; nobody else learns of an offer unless it’s accepted.'
        : `${attacker} and ${defender} can also agree peace terms until the game ends.`,
    );
  }
  if (war.status === 'declared') later.push('Without an answer in time, the war goes ahead as declared.');
  // Peace terms on the table: only ever the viewer's own (`WarView.peace` holds no one else's).
  for (const offer of war.peace.filter((o) => o.status === 'proposed'))
    alternatives.push(peaceEnding(model, war, offer));

  // Score every ending that's settled enough to score.
  const projected = projectedWarOf(
    {
      ...war,
      targetId: war.counter?.kind === 'redirect' && war.status === 'countered' ? war.counter.targetId : war.targetId,
    },
    model.campaign.victory?.world,
  );
  const all = [...current, ...alternatives];
  const scorable = all.filter((e) => e.ending !== null);
  const projections = projectWar(
    { ...state, board, openWars: proposed ? [...state.openWars, openWarOf(war)] : state.openWars },
    projected,
    scorable.map((e) => e.ending!),
  );
  const byEnding = new Map(scorable.map((e, i) => [e, projections[i]!]));
  // A checkmate counts for Checkmate Artist: where the winner has it, score the win by mate too.
  const mates = (winnerId: string) =>
    state.missions.some((m) => m.userId === winnerId && m.spec.kind === 'checkmate_artist');
  const mateOf = (e: Omit<EndingView, 'projection' | 'byMate'>): EndingProjection | null => {
    const ending = e.ending;
    if (!ending || (ending.outcome !== 'attacker' && ending.outcome !== 'defender')) return null;
    const winnerId = ending.outcome === 'attacker' ? war.attackerId : war.defenderId;
    if (!mates(winnerId)) return null;
    return projectWar({ ...state, board }, projected, [{ ...ending, endReason: 'checkmate' }])[0] ?? null;
  };
  const finish = (e: Omit<EndingView, 'projection' | 'byMate'>): EndingView => ({
    ...e,
    projection: byEnding.get(e) ?? null,
    byMate: mateOf(e),
  });

  return {
    current: current.map(finish),
    alternatives: alternatives.map(finish),
    later,
    provisional: provisionalLines(model, war, state),
    heldUp: proposed ? claimsHeldUp(state, openWarOf(war)) : [],
    missionsUnknown: !state.missionsKnown,
  };

  function answersBefore(m: CampaignModel, b: WarBoard, w: WarView): string[] {
    const lines: string[] = [];
    const a = b.wars.find((x) => x.id === w.id)!;
    const value = target?.value ?? 0;
    const def = You(m, w.defenderId);
    const att = you(m, w.attackerId);
    if (rules.raise !== 'off' && canRaise(b, a)) {
      if (rules.raise === 'matched') {
        const range = matchedRaiseRange(value);
        const n = raiseOptions(b, a).length;
        lines.push(
          `${def} may raise: put in one of ${n} ${n === 1 ? 'country' : 'countries'} worth ${range.min} to ${range.max}, which ${att} must match to fight on, and winning takes it too.` +
            (rules.raises > 1 ? ` Up to ${rules.raises} raises can go back and forth.` : ''),
        );
      } else {
        const cost = counterCost(m.campaign.rules, 'raise');
        lines.push(
          `${def} may raise: demand a stake worth ${raiseDemand(b, a)}${cost > 0 ? `, paying ${tokensText(cost)}` : ''}; ${att} must raise the stake or withdraw.`,
        );
      }
    }
    const redirects = redirectOptions(b, a);
    if (redirects.length > 0) {
      const cost = counterCost(m.campaign.rules, 'redirect');
      lines.push(
        `${def} may redirect the war to ${listText(redirects.map((id) => countryName(m, id)))} (worth ${value} each)` +
          `${cost > 0 ? `, paying ${tokensText(cost)}` : ''}, which ${att} can fight for or withdraw from.`,
      );
    }
    if (!rules.peaceTerms) {
      const tributes = tributeOptions(b, a);
      const tokens = m.membersById.get(w.defenderId)?.tokens ?? 0;
      if (tributes.length > 0 || tokens > 0) {
        lines.push(
          `${def} may offer tribute instead: ${[tributes.length > 0 && `a country worth less than ${value}`, tokens > 0 && 'war tokens'].filter(Boolean).join(', or ')}.`,
        );
      }
    }
    if (rules.recall) {
      lines.push(
        `${You(m, w.attackerId)} may call it off until ${you(m, w.defenderId)} answer${s(m, w.defenderId)}; the war token stays spent.`,
      );
    }
    return lines;
  }
}

/** Accepting peace terms on the table: the viewer's own offer, or one made to them. */
function peaceEnding(
  model: CampaignModel,
  war: WarView,
  offer: PeaceOfferView,
): Omit<EndingView, 'projection' | 'byMate'> {
  const transfers = peaceTransfers(war, offer.terms);
  const tokens = offer.terms.tokensToAttacker + offer.terms.tokensToDefender;
  const toMe = offer.recipientId === model.me.userId;
  return {
    key: `peace:${offer.id}`,
    label: toMe
      ? `If you accept ${playerName(model, offer.proposerId)}’s terms`
      : `If ${playerName(model, offer.recipientId)} accepts your terms`,
    tone: 'even',
    summary:
      `${transfersText(model, transfers)}${tokens > 0 ? ` ${tokensText(tokens)} change hands.` : ''}` +
      `${offer.terms.accordRounds ? ` An accord for ${offer.terms.accordRounds} ${offer.terms.accordRounds === 1 ? 'round' : 'rounds'}.` : ''} Only the two of you see this offer.`,
    ending: { outcome: 'settled', transfers, endReason: null },
  };
}

/** Why the preview can't be certain: other wars still to end, and secret missions nobody can see. */
function provisionalLines(model: CampaignModel, war: WarView, state: PreviewState): string[] {
  const lines: string[] = [];
  const others = state.openWars.filter((w) => w.id !== war.id).length;
  if (others > 0) {
    lines.push(
      `As the map stands now: ${others} other ${others === 1 ? 'war is' : 'wars are'} still unresolved, and ${others === 1 ? 'its result' : 'their results'} could move titles or missions first.`,
    );
  }
  const victory = model.campaign.victory;
  const hidden = [war.attackerId, war.defenderId].filter(
    (id) => id !== model.me.userId && !victory?.players.find((p) => p.userId === id)?.secret,
  );
  if (hidden.length > 0) {
    lines.push(
      `${hidden.map((id) => `${playerName(model, id)}’s`).join(' and ')} secret ${hidden.length === 1 ? 'mission isn’t' : 'missions aren’t'} revealed, so ${hidden.length === 1 ? 'it isn’t' : 'they aren’t'} counted here.`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// In words

/** How important a line is: `major` lines always show; `minor` ones (progress) can fold away. */
export interface OutcomeLine {
  kind: 'victory' | 'title' | 'scores' | 'claim' | 'breaks' | 'reveal' | 'points' | 'progress';
  weight: 'major' | 'minor';
  /** Good or bad for the viewer. */
  tone: 'good' | 'bad' | 'even';
  text: string;
}

/** The name of a mission as one player plays it: "Regional Power", "Bo’s secret mission, Iron Wall". */
function missionLabel(model: CampaignModel, m: Pick<MissionEffect, 'userId' | 'key' | 'spec'>): string {
  const name = missionName(m.spec);
  return m.key === 'secret' ? `${yours(model, m.userId)} secret mission, ${name}` : name;
}

/** The first requirement an ending moves, as "Wars won: 1 → 2 of 3". */
function partStep(effect: MissionEffect): string {
  const i = effect.after.parts.findIndex((p, j) => p.have !== effect.before.parts[j]?.have);
  const after = effect.after.parts[Math.max(0, i)];
  const before = effect.before.parts[Math.max(0, i)];
  if (!after || !before) return '';
  return `${after.label}: ${partAmount(before, before.have)} → ${partAmount(after, after.have)} of ${partAmount(after, after.need)}`;
}

const good = (model: CampaignModel, userId: string | null) =>
  userId === model.me.userId ? ('good' as const) : ('even' as const);
const bad = (model: CampaignModel, userId: string | null) =>
  userId === model.me.userId ? ('bad' as const) : ('even' as const);

/** Names in a list: "you", "Ann and Bo". */
const namesText = (model: CampaignModel, ids: readonly string[]) => listText(ids.map((id) => you(model, id)));

/**
 * What one ending does to the race, in lines, from the viewer's side: the campaign won, titles
 * moving, missions scored (kept for good), claims started or kept (not points until they score),
 * claims broken, progress, and everyone's points after.
 */
export function outcomeLines(model: CampaignModel, projection: EndingProjection): OutcomeLine[] {
  const lines: OutcomeLine[] = [];
  const me = model.me.userId;
  const toWin = model.campaign.victory?.pointsToWin ?? 0;
  if (projection.winners.length > 0) {
    const w = projection.winners;
    lines.push({
      kind: 'victory',
      weight: 'major',
      tone: w.includes(me) ? 'good' : 'bad',
      text:
        w.length > 1
          ? `${namesText(model, w).replace(/^you/, 'You')} would share the victory: the campaign ends.`
          : w[0] === me
            ? `You win the campaign, with ${projection.points.get(me)} points.`
            : `${playerName(model, w[0]!)} wins the campaign, with ${projection.points.get(w[0]!)} points.`,
    });
  }
  for (const t of projection.titles) {
    const name = TITLES[t.kind].name;
    const points = model.campaign.victory?.titlePoints ?? 1;
    const text = t.to
      ? `${name}${t.from ? ` passes from ${you(model, t.from)} to ${you(model, t.to)}` : ` goes to ${you(model, t.to)}`}: +${points} while ${t.to === me ? 'you lead' : 'they lead'}, and it can be lost again.`
      : `${name} is lost by ${you(model, t.from!)}: the lead is shared, so nobody holds it (−${points}).`;
    lines.push({ kind: 'title', weight: 'major', tone: t.to === me ? 'good' : t.from === me ? 'bad' : 'even', text });
  }
  for (const m of projection.missions) {
    const label = missionLabel(model, m);
    const who = You(model, m.userId);
    switch (m.change) {
      case 'scores':
        lines.push({
          kind: 'scores',
          weight: 'major',
          tone: good(model, m.userId),
          text: `${who} score${s(model, m.userId)} ${label}: +${m.points}, kept for good.`,
        });
        break;
      case 'claims':
        lines.push({
          kind: 'claim',
          weight: 'major',
          tone: good(model, m.userId),
          text: `${who} complete${s(model, m.userId)} ${label}: a claim, not points yet. It can score +${m.points} in round ${m.eligibleRound} at the earliest, if held.`,
        });
        break;
      case 'keeps':
        lines.push({
          kind: 'claim',
          weight: 'major',
          tone: good(model, m.userId),
          text: `${yours(model, m.userId).replace(/^y/, 'Y')} claim on ${label} survives this war${m.blockedBy && m.blockedBy.length > 0 ? `, but ${m.blockedBy.length === 1 ? 'another war' : `${m.blockedBy.length} other wars`} could still break it` : ''}. It can score in round ${m.eligibleRound} at the earliest.`,
        });
        break;
      case 'breaks':
        lines.push({
          kind: 'breaks',
          weight: 'major',
          tone: bad(model, m.userId),
          text: `${yours(model, m.userId).replace(/^y/, 'Y')} claim on ${label} is broken: no points, and it has to be completed again.`,
        });
        break;
      case 'progress':
      case 'setback': {
        const step = partStep(m);
        lines.push({
          kind: 'progress',
          weight: 'minor',
          tone: m.change === 'progress' ? good(model, m.userId) : bad(model, m.userId),
          // A secret mission's label already says whose it is.
          text: `${m.key === 'secret' ? label.replace(/^y/, 'Y') : `${label} (${you(model, m.userId)})`} · ${step || (m.change === 'progress' ? 'nearer' : 'further away')}.`,
        });
        break;
      }
    }
    if (m.reveals) {
      lines.push({
        kind: 'reveal',
        weight: 'major',
        tone: 'even',
        text: `Your secret mission comes within a step of completion, so it is revealed to everyone.`,
      });
    }
  }
  for (const m of projection.claimWins) {
    lines.push({
      kind: 'victory',
      weight: 'major',
      tone: m.userId === me ? 'good' : 'bad',
      text: `If that claim on ${missionLabel(model, m)} scores, ${you(model, m.userId)} reach${m.userId === me ? '' : 'es'} ${toWin}: it could win the campaign from round ${m.eligibleRound}.`,
    });
  }
  const before = new Map(model.campaign.victory?.players.map((p) => [p.userId, p.points]) ?? []);
  const changed = [...projection.points].filter(([id, p]) => (before.get(id) ?? 0) !== p);
  if (changed.length > 0) {
    lines.push({
      kind: 'points',
      weight: 'major',
      tone: 'even',
      text: `Points: ${changed.map(([id, p]) => `${you(model, id)} ${before.get(id) ?? 0} → ${p}`).join(', ')}.`,
    });
  }
  return lines;
}

/** Lines a win by checkmate adds to the same win otherwise: Checkmate Artist, and what follows from it. */
export function mateLines(model: CampaignModel, plain: EndingProjection, mate: EndingProjection): OutcomeLine[] {
  const seen = new Set(outcomeLines(model, plain).map((l) => l.text));
  return outcomeLines(model, mate).filter((l) => !seen.has(l.text) && l.kind !== 'points');
}

// ---------------------------------------------------------------------------------------------
// The war room and the board: which wars could decide the campaign

export interface WarStakes {
  /** Players some ending of the war would make winners there and then. */
  winners: string[];
  /** Players a claim this war starts or keeps would take to the points to win, if it scores. */
  claimWinners: string[];
}

const stakes = new WeakMap<CampaignView, Map<string, WarStakes>>();

/** Who this war could win the campaign for: at once, or through a claim it sets up. Worked out once per view. */
export function warStakes(model: CampaignModel, war: WarView): WarStakes {
  let byWar = stakes.get(model.campaign);
  if (!byWar) stakes.set(model.campaign, (byWar = new Map()));
  const known = byWar.get(war.id);
  if (known) return known;
  const outlook = warOutlook(model, war);
  const endings = outlook ? [...outlook.current, ...outlook.alternatives] : [];
  const projections = endings.flatMap((e) => [e.projection, e.byMate]).filter((p) => p !== null);
  const winners = [...new Set(projections.flatMap((p) => p.winners))].sort();
  const claimWinners = [...new Set(projections.flatMap((p) => p.claimWins.map((m) => m.userId)))]
    .filter((id) => !winners.includes(id))
    .sort();
  const result = { winners, claimWinners };
  byWar.set(war.id, result);
  return result;
}

/** "Could win the campaign for you", "Could win the campaign for Ann or Bo"; null when it can't. */
export function stakesText(model: CampaignModel, war: WarView): string | null {
  const { winners, claimWinners } = warStakes(model, war);
  const names = (ids: string[]) => ids.map((id) => you(model, id)).join(ids.length > 2 ? ', ' : ' or ');
  if (winners.length > 0) return `Could win the campaign for ${names(winners)}`;
  if (claimWinners.length > 0) return `Could set up a winning claim for ${names(claimWinners)}`;
  return null;
}
