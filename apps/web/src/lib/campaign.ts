import {
  activeWar,
  attackableTargets,
  draftListStatus,
  legalPicks,
  picksUntilTurn,
  upcomingPickers,
  type AutodraftFallback,
  type CampaignView,
  type DatasetIndex,
  type DraftListStatus,
  type MemberView,
  type SessionUser,
  type TerritoryId,
  type WarBoard,
  type WarView,
} from '@empire/rules';

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
  /** Wars waiting for my answer: a declaration on me, or a counter-offer to my attack. */
  awaitingMe: WarView[];
  /** The unresolved war each locked country is caught up in (as target, stake or offer). */
  warOf: Map<TerritoryId, WarView>;
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
    holdings: new Map([...owners].map(([id, ownerId]) => [id, { ownerId, acquiredRound: campaign.acquired[id] ?? 0 }])),
    wars: campaign.wars.filter((w) => w.status !== 'resolved').map(activeWar),
    truces: campaign.truces,
  };
  const activeWars = campaign.wars.filter((w) => w.status !== 'resolved');
  const warOf = new Map<TerritoryId, WarView>();
  for (const war of activeWars) {
    const locking = board.wars.find((w) => w.id === war.id)!;
    for (const id of [locking.targetId, ...locking.stake, ...(locking.offered ? [locking.offered] : [])]) {
      warOf.set(id, war);
    }
  }

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
    awaitingMe: activeWars.filter(
      (w) =>
        (w.status === 'declared' && w.defenderId === me.userId) ||
        (w.status === 'countered' && w.attackerId === me.userId),
    ),
    warOf,
  };
}

export function totalValue(idx: DatasetIndex, ids: readonly TerritoryId[]): number {
  return ids.reduce((sum, id) => sum + (idx.byId.get(id)?.value ?? 0), 0);
}
