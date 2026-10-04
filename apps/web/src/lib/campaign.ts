import {
  accordsInForce,
  activeWar,
  attackableTargets,
  canTakeTurn,
  checkTurn,
  turnsBefore,
  warLocks,
  draftListStatus,
  legalPicks,
  partnerIn,
  picksUntilTurn,
  renunciationsFrom,
  upcomingPickers,
  waitingOn,
  type AccordView,
  type AutodraftFallback,
  type CampaignView,
  type DatasetIndex,
  type DraftListStatus,
  type MemberView,
  type PeaceOfferView,
  type SessionUser,
  type TerritoryId,
  type TurnRejection,
  type WarBoard,
  type WarView,
} from '@empire/rules';

/** Declaring in turns this round, as the campaign screen shows it. */
export interface TurnsModel {
  /** The round's order. */
  order: MemberView[];
  /** Whose turn it is, or null once declaring is over for the round. */
  current: MemberView | null;
  /** It's my turn to declare war, fortify or pass. */
  mine: boolean;
  /** When the current turn passes on its own. */
  deadline: string | null;
  /** Players done declaring for the round. */
  passed: Set<string>;
  /** Whether I have anything to do with a turn: a token, and something to declare war on or fortify. */
  canAct: boolean;
  /**
   * Turns to come before mine, passing over players with nothing to do as things stand; null once
   * I've passed, or when I have nothing to do myself.
   */
  before: number | null;
}

/**
 * Something waiting for my answer: a war (a declaration on me, a counter-offer to my attack, a raise
 * back to me, or peace terms offered to me) or an accord proposal.
 */
export interface Answer {
  kind: 'war' | 'accord';
  id: string;
  /** When time runs out on it; for a war with more than one thing to answer, the soonest. */
  respondBy: string | null;
}

/** Everything the campaign screen derives from the server's view of a campaign. */
export interface CampaignModel {
  campaign: CampaignView;
  idx: DatasetIndex;
  me: MemberView;
  isHost: boolean;
  membersById: Map<string, MemberView>;
  owners: Map<TerritoryId, string>;
  /** Empire color of every claimed territory, for the map. */
  ownerColors: Map<TerritoryId, number>;
  holdingsByUser: Map<string, TerritoryId[]>;
  currentPicker: MemberView | null;
  myTurn: boolean;
  /** What I may claim right now; null when it isn't my pick. */
  legal: Set<TerritoryId> | null;
  /** Legal picks worth calling out on the map: only when the rules narrow the choice. */
  highlighted: Set<TerritoryId> | null;
  picksUntilMine: number | null;
  upcoming: MemberView[];
  totalRounds: number;
  /** Territories nobody holds (all of them before the draft; some if the host ends it early). */
  unclaimed: number;
  /** Whether draft lists can still be edited: from the lobby until the draft ends. */
  draftListOpen: boolean;
  /** My draft list with where each entry stands right now. */
  draftList: { id: TerritoryId; status: DraftListStatus }[];
  /** What my auto-draft does once nothing on my list can be claimed. */
  autodraftFallback: AutodraftFallback;
  /** It's my pick although auto-draft is on: it is waiting for me because my list ran out. */
  autodraftWaiting: boolean;
  /** What the war rules see, for previews: holdings, locks and truces. */
  board: WarBoard;
  /** My war tokens. */
  tokens: number;
  /** Unresolved wars, newest first. */
  activeWars: WarView[];
  /** Recently resolved wars, most recent first. */
  pastWars: WarView[];
  /** Enemy countries I could declare war on now, tokens aside. Empty unless the campaign is underway. */
  targets: Set<TerritoryId>;
  /** Wars waiting for my answer: a declaration on me, a counter-offer to my attack, or a raise back to me. */
  awaitingMe: WarView[];
  /** Peace terms offered to me in a war, waiting for my answer. */
  peaceToMe: { war: WarView; offer: PeaceOfferView }[];
  /**
   * The unresolved war each locked country is caught up in (as target, stake, offer, a country a
   * raise put in, or reserves).
   */
  warOf: Map<TerritoryId, WarView>;
  /** Accords in force between any two players, most recently signed first. */
  accordsInForce: AccordView[];
  /** Accord proposals waiting for my answer. */
  proposalsToMe: AccordView[];
  /** My accord in force with each partner, by their id. */
  accordWith: Map<string, AccordView>;
  /** The proposal waiting between me and each other player, whichever way it goes, by their id. */
  proposalWith: Map<string, AccordView>;
  /** Everything waiting for my answer, one entry per war or proposal, the soonest deadline first. */
  answers: Answer[];
  /** Declaring in turns this round; null where anyone declares whenever they like. */
  turns: TurnsModel | null;
  /** Why I can't declare war or fortify right now, as far as turns go; null if I can. */
  turnRejection: TurnRejection | null;
}

export function buildModel(campaign: CampaignView, user: SessionUser, idx: DatasetIndex): CampaignModel | null {
  const membersById = new Map(campaign.members.map((m) => [m.userId, m]));
  const me = membersById.get(user.id);
  if (!me) return null;

  const owners = new Map(Object.entries(campaign.holdings));
  const ownerColors = new Map<TerritoryId, number>();
  const holdingsByUser = new Map<string, TerritoryId[]>(campaign.members.map((m) => [m.userId, []]));
  for (const [territoryId, ownerId] of owners) {
    const owner = membersById.get(ownerId);
    if (owner) ownerColors.set(territoryId, owner.color);
    holdingsByUser.get(ownerId)?.push(territoryId);
  }

  const draft = campaign.draft;
  const currentPicker = draft?.currentPicker ? (membersById.get(draft.currentPicker) ?? null) : null;
  const myTurn = campaign.status === 'draft' && currentPicker?.userId === user.id;
  const running = campaign.status === 'draft' && draft !== null;
  const legal = myTurn ? new Set(legalPicks(idx, campaign.rules, owners, user.id)) : null;

  const board: WarBoard = {
    idx,
    rules: campaign.rules,
    round: campaign.round,
    holdings: new Map(
      [...owners].map(([id, ownerId]) => [
        id,
        { ownerId, acquiredRound: campaign.acquired[id] ?? 0, fortifiedUntil: campaign.fortified[id] ?? null },
      ]),
    ),
    wars: campaign.wars.filter((w) => w.status !== 'resolved').map(activeWar),
    truces: campaign.truces,
    accords: accordsInForce(campaign.accords, campaign.round),
    renunciations: renunciationsFrom(campaign.accords, campaign.round),
  };
  const activeWars = campaign.wars.filter((w) => w.status !== 'resolved');
  const warOf = new Map<TerritoryId, WarView>();
  const byId = new Map(activeWars.map((w) => [w.id, w]));
  for (const [id, warId] of warLocks(board.wars)) {
    const war = byId.get(warId);
    if (war) warOf.set(id, war);
  }

  const inForce = campaign.accords.filter((a) => board.accords.some((x) => x.id === a.id));
  const accordWith = new Map<string, AccordView>();
  for (const a of inForce)
    if (a.proposerId === me.userId || a.recipientId === me.userId) accordWith.set(partnerIn(a, me.userId), a);
  const pending = campaign.accords.filter((a) => a.status === 'proposed');
  const proposalWith = new Map(pending.map((a) => [partnerIn(a, me.userId), a]));
  const proposalsToMe = pending.filter((a) => a.recipientId === me.userId);
  const awaitingMe = activeWars.filter((w) => waitingOn(w) === me.userId);
  const peaceToMe = activeWars.flatMap((war) =>
    war.peace.filter((o) => o.status === 'proposed' && o.recipientId === me.userId).map((offer) => ({ war, offer })),
  );
  const turnView = campaign.status === 'active' ? campaign.turns : null;
  const canAct = (userId: string) => canTakeTurn(board, userId, membersById.get(userId)?.tokens ?? 0);
  const iCanAct = turnView !== null && canAct(me.userId);
  const turns: TurnsModel | null = turnView && {
    order: turnView.order.flatMap((id) => membersById.get(id) ?? []),
    current: turnView.current ? (membersById.get(turnView.current) ?? null) : null,
    mine: turnView.current === me.userId,
    deadline: turnView.deadline,
    passed: new Set(turnView.passed),
    canAct: iCanAct,
    before: turnView.current === me.userId ? 0 : iCanAct ? turnsBefore(turnView, me.userId, canAct) : null,
  };
  const warAnswers = new Map<string, Answer>();
  for (const [war, respondBy] of [
    ...awaitingMe.map((w) => [w, w.respondBy] as const),
    ...peaceToMe.map(({ war, offer }) => [war, offer.respondBy] as const),
  ]) {
    const earlier = warAnswers.get(war.id);
    if (!earlier || due(respondBy) < due(earlier.respondBy))
      warAnswers.set(war.id, { kind: 'war', id: war.id, respondBy });
  }
  const answers: Answer[] = [
    ...warAnswers.values(),
    ...proposalsToMe.map((a): Answer => ({ kind: 'accord', id: a.id, respondBy: a.respondBy })),
  ].sort((a, b) => due(a.respondBy) - due(b.respondBy) || 0);

  return {
    campaign,
    idx,
    me,
    isHost: campaign.hostId === user.id,
    membersById,
    owners,
    ownerColors,
    holdingsByUser,
    currentPicker,
    myTurn,
    legal,
    highlighted: legal && legal.size < idx.ids.length - owners.size ? legal : null,
    picksUntilMine: running ? picksUntilTurn(draft.order, draft.pickIndex, draft.totalPicks, user.id) : null,
    upcoming: running
      ? upcomingPickers(draft.order, draft.pickIndex, 12, draft.totalPicks).flatMap((id) => membersById.get(id) ?? [])
      : [],
    totalRounds: draft ? Math.ceil(draft.totalPicks / Math.max(draft.order.length, 1)) : 0,
    unclaimed: idx.ids.length - owners.size,
    draftListOpen: campaign.status === 'lobby' || campaign.status === 'draft',
    draftList: draftListStatus(idx, campaign.rules, owners, user.id, campaign.myDraftList),
    autodraftFallback: campaign.myAutodraftFallback,
    autodraftWaiting: myTurn && me.autodraft,
    board,
    tokens: me.tokens,
    activeWars,
    pastWars: campaign.wars.filter((w) => w.status === 'resolved'),
    targets: campaign.status === 'active' ? attackableTargets(board, me.userId) : new Set(),
    awaitingMe,
    peaceToMe,
    warOf,
    accordsInForce: inForce,
    proposalsToMe,
    accordWith,
    proposalWith,
    answers,
    turns,
    turnRejection: checkTurn(turnView, me.userId),
  };
}

const due = (respondBy: string | null) => (respondBy ? Date.parse(respondBy) : Infinity);

/**
 * Where "Answer needed" takes me: the most pressing answer, or the one after `last`, where it took
 * me the time before, so pressing again goes round them all.
 */
export function nextAnswer(answers: readonly Answer[], last: string | null): Answer | null {
  const at = answers.findIndex((a) => a.id === last);
  return answers[(at + 1) % answers.length] ?? null;
}

export function totalValue(idx: DatasetIndex, ids: readonly TerritoryId[]): number {
  return ids.reduce((sum, id) => sum + (idx.byId.get(id)?.value ?? 0), 0);
}
