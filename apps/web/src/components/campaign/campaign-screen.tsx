'use client';

import { missionName, type CampaignStatus, type TerritoryId } from '@empire/rules';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Topology } from 'topojson-specification';
import { ApiError, errorMessage } from '@/lib/api';
import { buildModel, type CampaignModel } from '@/lib/campaign';
import { useCampaign, useMapData, useMe, useWar } from '@/lib/queries';
import { useRealtime, useServerMessages } from '@/lib/realtime';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useIsDesktop } from '@/lib/use-media-query';
import { useMyGames } from '@/lib/use-my-games';
import { findMission, missionOverlay, progressOf, rivalClaims, titleOf } from '@/lib/victory';
import { countryName, outcomeText, playerName } from '@/lib/wars';
import { DiploPanel, useUnread, type DiploView } from '../diplo/diplo-panel';
import { GamePanel } from '../game/game-panel';
import { WorldMap, type MapWar } from '../map/world-map';
import { Notice, SegmentTabs, Spinner } from '../ui';
import { MissionsPanel, type MissionFocus } from '../victory/missions-panel';
import { CountrySearch } from './country-search';
import { DraftPanel, DraftStatus, Standings } from './draft-panel';
import { EmpirePanel } from './empire-panel';
import { LobbyPanel } from './lobby-panel';
import { CampaignRoomProvider } from './room-context';
import { TerritoryPanel } from './territory-panel';
import { WarDetail, type StakePreview } from './war-detail';
import { WarsPanel } from './wars-panel';

type Tab = 'lobby' | 'map' | 'wars' | 'draft' | 'missions' | 'diplo' | 'empire';

const TAB: Record<Tab, { id: Tab; label: string }> = {
  lobby: { id: 'lobby', label: 'Lobby' },
  map: { id: 'map', label: 'Map' },
  wars: { id: 'wars', label: 'Wars' },
  draft: { id: 'draft', label: 'Draft' },
  missions: { id: 'missions', label: 'Missions' },
  diplo: { id: 'diplo', label: 'Diplo' },
  empire: { id: 'empire', label: 'Empire' },
};

/** The phone tabs for each stage; Objectives campaigns add Missions from the draft on. */
function tabsFor(status: CampaignStatus, objectives: boolean): { id: Tab; label: string }[] {
  const ids: Tab[] = {
    lobby: ['lobby', 'map', 'diplo'] as Tab[],
    draft: objectives
      ? (['map', 'draft', 'missions', 'diplo', 'empire'] as Tab[])
      : (['map', 'draft', 'diplo', 'empire'] as Tab[]),
    // Choosing a secret mission is the one thing to do between the draft and round 1.
    selection: ['missions', 'map', 'diplo', 'empire'] as Tab[],
    active: objectives
      ? (['map', 'wars', 'missions', 'diplo', 'empire'] as Tab[])
      : (['map', 'wars', 'diplo', 'empire'] as Tab[]),
    // The results come first once someone has won.
    finished: objectives
      ? (['missions', 'map', 'wars', 'diplo', 'empire'] as Tab[])
      : (['map', 'wars', 'diplo', 'empire'] as Tab[]),
  }[status];
  return ids.map((id) => TAB[id]);
}

/** What the desktop's left column shows: the lobby, draft or war room, the missions, or diplomacy. */
type Side = 'main' | 'missions' | 'diplo';
const MAIN_LABEL: Record<CampaignStatus, string> = {
  lobby: 'Lobby',
  draft: 'Draft',
  selection: 'Missions',
  active: 'Wars',
  finished: 'Wars',
};

/** A campaign: the map room, with any page opened over it (an empire's statistics) as `children`. */
export function CampaignScreen({ id, children }: { id: string; children?: ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const campaign = useCampaign(id);
  const mapData = useMapData(campaign.data?.datasetVersion);
  const user = me.data?.user;

  useEffect(() => {
    // Back to the same place after signing in: an empire's page, or a war or game from a link.
    if (me.data && !me.data.user) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }, [me.data, router]);

  const model = useMemo(
    () => (campaign.data && user && mapData.data ? buildModel(campaign.data, user, mapData.data.idx) : null),
    [campaign.data, user, mapData.data],
  );

  const error = campaign.error ?? mapData.error ?? me.error;
  const notMember = Boolean(campaign.data && user && mapData.data && !model);
  if (error || notMember) {
    const gone = notMember || (error instanceof ApiError && error.status === 404);
    return (
      <CenteredMessage>
        <Notice tone={gone ? 'info' : 'error'}>
          {gone ? 'This campaign does not exist, or you are not part of it.' : errorMessage(error)}
        </Notice>
        <Link href="/" className="btn btn-ghost mt-4">
          All campaigns
        </Link>
      </CenteredMessage>
    );
  }
  if (!model || !mapData.data) {
    return (
      <CenteredMessage>
        <Spinner label="Unrolling the map" />
      </CenteredMessage>
    );
  }
  return (
    <CampaignRoom model={model} topo={mapData.data.topo}>
      {children}
    </CampaignRoom>
  );
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">{children}</div>;
}

/**
 * Opens and closes panels through the query string (?war=, ?game=, ?chat=, ?accord=), so links and
 * the back button work.
 */
function usePanelParams(campaignId: string, overPage: boolean) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const set = useCallback(
    (key: 'war' | 'game' | 'chat' | 'accord' | 'missions', value: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (value) params.set(key, value);
      else params.delete(key);
      const query = params.toString();
      // Panels are part of the map room: opening one from a page over it (a live game starting
      // while an empire's statistics are open) goes back to the map room.
      if (overPage) {
        if (value) router.push(`/c/${campaignId}?${query}`);
        return;
      }
      const url = query ? `?${query}` : window.location.pathname;
      if (value) window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    },
    [campaignId, overPage, router],
  );
  return {
    /** The whole query, kept by links that leave the map room and come back (empire pages). */
    query: searchParams.toString(),
    warId: searchParams.get('war'),
    gameId: searchParams.get('game'),
    /** The player whose private conversation is open. */
    chatWith: searchParams.get('chat'),
    /** An accord to show, e.g. from a notification. */
    accordId: searchParams.get('accord'),
    /** Open the missions, e.g. from a notification about a claim or a reveal. */
    missions: searchParams.get('missions') !== null,
    set,
  };
}

function CampaignRoom({ model, topo, children }: { model: CampaignModel; topo: Topology; children?: ReactNode }) {
  const { campaign } = model;
  const me = model.me.userId;
  const router = useRouter();
  // A page open over the map room: an empire's statistics, or the rules.
  const pageSegment = useSelectedLayoutSegment();
  const overPage = pageSegment !== null;
  const { userId: empireOf } = useParams<{ userId?: string }>();
  const { connected } = useRealtime();
  const isDesktop = useIsDesktop();
  const objectives = campaign.victory !== null;
  const tabs = tabsFor(campaign.status, objectives);
  const [tab, setTab] = useState<Tab>(tabs[0]!.id);
  const [selected, setSelected] = useState<TerritoryId | null>(null);
  const [focus, setFocus] = useState<{ id: TerritoryId; nonce: number } | null>(null);
  const [showValues, setShowValues] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [preview, setPreview] = useState<StakePreview | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const panels = usePanelParams(campaign.id, overPage);
  // Older wars aren't in the campaign view; a link to one (a dispatch, an empire's record) reads it.
  const warInView = panels.warId ? campaign.wars.find((w) => w.id === panels.warId) : undefined;
  const olderWar = useWar(campaign.id, panels.warId && !warInView ? panels.warId : null);
  const openWar = warInView ?? olderWar.data;
  const myGames = useMyGames(model);
  const myMoves = myGames.filter((g) => g.myMove).length;
  const answers = model.answersNeeded;
  const unread = useUnread(campaign.id);
  // A finished Objectives campaign opens on its results.
  const [side, setSide] = useState<Side>(campaign.status === 'finished' && objectives ? 'missions' : 'main');
  const [diploView, setDiploView] = useState<DiploView>('dispatches');

  // A conversation or accord in the address (a notification, the back button) opens Diplo on it.
  const { chatWith, accordId } = panels;
  useEffect(() => {
    if (!chatWith) return;
    setDiploView('messages');
    setTab('diplo');
    setSide('diplo');
  }, [chatWith]);
  useEffect(() => {
    if (!accordId) return;
    setDiploView('accords');
    setTab('diplo');
    setSide('diplo');
  }, [accordId]);
  const changeDiploView = (view: DiploView) => {
    if (view !== 'messages' && chatWith) panels.set('chat', null);
    if (view !== 'accords' && accordId) panels.set('accord', null);
    setDiploView(view);
  };
  // Leaving Diplo drops its address, so a notification for the same conversation opens it again.
  const diploShown = isDesktop ? side === 'diplo' : tab === 'diplo';
  const wasDiploShown = useRef(diploShown);
  useEffect(() => {
    if (wasDiploShown.current && !diploShown) {
      if (chatWith) panels.set('chat', null);
      if (accordId) panels.set('accord', null);
    }
    wasDiploShown.current = diploShown;
  }, [diploShown, chatWith, accordId, panels]);

  // Phones show a war over the map or in the Wars tab, so a war opened by a link (from a page over
  // the map room, or the back button) brings the Wars tab up if another is showing.
  const { warId } = panels;
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  });
  useEffect(() => {
    if (warId && !isDesktop && tabRef.current !== 'map' && tabRef.current !== 'wars') setTab('wars');
  }, [warId, isDesktop]);

  // Jump to the natural first tab when the campaign moves on (e.g. the host starts the draft), and
  // to the results when it ends.
  const status = campaign.status;
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current !== status) {
      setTab(tabsFor(status, objectives)[0]!.id);
      if (status === 'finished' && objectives) setSide('missions');
      if (status === 'active') setSide('main');
    }
    lastStatus.current = status;
  }, [status, objectives]);

  // A link to the missions (a notification about a claim, a reveal or the result) opens them.
  const { missions: missionsLinked } = panels;
  useEffect(() => {
    if (!missionsLinked || !objectives) return;
    setTab('missions');
    setSide(campaign.status === 'selection' ? 'main' : 'missions');
    panels.set('missions', null);
  }, [missionsLinked, objectives, campaign.status, panels]);

  // A mission called out on the map, recomputed as the campaign changes (and dropped if it
  // stops being one the viewer may see).
  const [missionFocus, setMissionFocus] = useState<MissionFocus | null>(null);
  const missionMap = useMemo(() => {
    if (!missionFocus) return null;
    if (missionFocus.kind === 'option') {
      return { label: missionName(missionFocus.spec), overlay: missionOverlay(model, missionFocus.spec, undefined) };
    }
    const played = findMission(model, missionFocus.ownerId, missionFocus.key);
    if (!played) return null;
    const whose = missionFocus.ownerId ?? me;
    return {
      label: titleOf(played.mission),
      overlay: missionOverlay(model, played.mission.spec, progressOf(model, whose, missionFocus.key)),
    };
  }, [missionFocus, model, me]);

  // Tell the player when their pick comes up.
  const wasMyTurn = useRef(model.myTurn);
  useEffect(() => {
    if (model.myTurn && !wasMyTurn.current) {
      setToast('Your pick');
      navigator.vibrate?.(120);
    }
    wasMyTurn.current = model.myTurn;
  }, [model.myTurn]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const openGame = useCallback((gameId: string) => panels.set('game', gameId), [panels]);

  // Intel reports: wars declared on me, answers I'm owed, battles starting and ending.
  const modelRef = useRef(model);
  useEffect(() => {
    modelRef.current = model;
  });
  useServerMessages((message) => {
    if (message.type !== 'campaign.events' || message.campaignId !== campaign.id) return;
    const current = modelRef.current;
    const warById = (warId: string) => current.campaign.wars.find((w) => w.id === warId);
    for (const e of message.events) {
      if (e.type === 'war.declared' && e.payload.defenderId === me) {
        setToast(`War declared on ${countryName(current, e.payload.targetId)}`);
        navigator.vibrate?.([80, 60, 80]);
      } else if (e.type === 'war.response' && e.payload.counter && warById(e.payload.warId)?.attackerId === me) {
        setToast('Your attack needs an answer');
      } else if (e.type === 'war.started' && (e.payload.whiteId === me || e.payload.blackId === me)) {
        setToast('Battle stations');
        navigator.vibrate?.(120);
        // In a live campaign the clocks are about to start, so go straight to the board.
        if (current.campaign.rules.war.pace === 'live') openGame(e.payload.gameId);
      } else if (
        e.type === 'accord.signed' &&
        e.actorId !== me &&
        (e.payload.proposerId === me || e.payload.recipientId === me)
      ) {
        setToast(`Accord signed with ${playerName(current, e.actorId ?? '')}`);
      } else if (e.type === 'accord.broken' && e.payload.partnerId === me) {
        setToast(`${playerName(current, e.payload.breakerId)} broke your accord`);
        navigator.vibrate?.([80, 60, 80]);
      } else if (e.type === 'mission.revealed' && e.payload.reason !== 'final') {
        setToast(
          e.payload.userId === me
            ? 'Your secret mission is revealed'
            : `${playerName(current, e.payload.userId)}’s secret: ${missionName(e.payload.mission)}`,
        );
      } else if (e.type === 'claim.started') {
        const mission = missionName({ kind: e.payload.kind });
        setToast(
          e.payload.userId === me
            ? `Claim started: ${mission}`
            : `${playerName(current, e.payload.userId)} claims ${mission}`,
        );
      } else if (e.type === 'claim.interrupted' && e.payload.userId === me) {
        setToast(`Claim lost: ${missionName({ kind: e.payload.kind })}`);
      } else if (e.type === 'mission.awarded' && e.payload.userId === me) {
        setToast(`+${e.payload.points} victory points`);
        navigator.vibrate?.(120);
      } else if (e.type === 'campaign.won') {
        const winners = e.payload.winners;
        setToast(
          winners.includes(me) ? 'Victory' : `${winners.map((id) => playerName(current, id)).join(' and ')} won`,
        );
      }
    }
  });
  // Private messages, unless that conversation is already on screen.
  useServerMessages((message) => {
    if (message.type !== 'chat.message' || message.campaignId !== campaign.id) return;
    const m = message.message;
    if (m.recipientId !== me || m.body === null) return;
    if (diploShown && diploView === 'messages' && chatWith === m.authorId) return;
    setToast(`Message from ${playerName(modelRef.current, m.authorId)}`);
  });
  // New accord proposals arrive with a refetch, since only the two players are told.
  const seenProposals = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(model.proposalsToMe.map((a) => a.id));
    const fresh = seenProposals.current && model.proposalsToMe.find((a) => !seenProposals.current!.has(a.id));
    if (fresh) setToast(`${playerName(model, fresh.proposerId)} proposes an accord`);
    seenProposals.current = ids;
  }, [model]);
  // Results arrive with a refetch, so the war's outcome is in the model by then.
  const lastResolved = useRef<string | null>(null);
  useEffect(() => {
    const latest = model.pastWars[0];
    if (!latest || latest.id === lastResolved.current) return;
    const fresh = lastResolved.current !== null;
    lastResolved.current = latest.id;
    if (fresh && (latest.attackerId === me || latest.defenderId === me)) setToast(outcomeText(model, latest));
  }, [model, me]);

  // A secret mission waiting to be chosen.
  const mustChoose = campaign.status === 'selection' && Boolean(campaign.mySecret?.options?.length);
  const flag = model.myTurn
    ? '(Your pick) '
    : mustChoose
      ? '(Choose a mission) '
      : myMoves > 0
        ? '(Your move) '
        : answers > 0
          ? '(Answer needed) '
          : unread.direct > 0
            ? '(New message) '
            : '';
  const page = empireOf
    ? `${model.membersById.get(empireOf)?.name ?? 'Empire'} · `
    : pageSegment === 'rules'
      ? 'Rules · '
      : '';
  useDocumentTitle(`${flag}${page}${campaign.name} · Empire Chess`);

  const [initialFrame] = useState(() => model.holdingsByUser.get(me) ?? []);

  // How much of the map the phone's bottom sheet covers, so the map can keep clear of it.
  const [sheetHeight, setSheetHeight] = useState(0);
  const sheetRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSheetHeight(entry!.contentRect.height));
    observer.observe(el);
    return () => {
      observer.disconnect();
      setSheetHeight(0);
    };
  }, []);

  const selectOnMap = (id: TerritoryId | null) => {
    setSelected(id);
    if (id && panels.warId) panels.set('war', null);
  };
  /** Calls a mission out on the map, framing its targets; phones switch to the map to show it. */
  const [fit, setFit] = useState<{ ids: TerritoryId[]; nonce: number } | null>(null);
  const showMission = (focus: MissionFocus) => {
    setMissionFocus(focus);
    setSelected(null);
    if (!isDesktop) setTab('map');
    const spec = focus.kind === 'option' ? focus.spec : findMission(model, focus.ownerId, focus.key)?.mission.spec;
    const progress = focus.kind === 'mission' ? progressOf(model, focus.ownerId ?? me, focus.key) : undefined;
    const overlay = spec ? missionOverlay(model, spec, progress) : null;
    const ids = overlay ? [...overlay.targets, ...(overlay.path ?? [])] : [];
    if (ids.length > 0) setFit({ ids, nonce: Date.now() });
  };
  const flyTo = (id: TerritoryId) => {
    selectOnMap(id);
    setFocus({ id, nonce: Date.now() });
    setTab('map');
  };
  /** From a page over the map room: back to the map, on the country. */
  const showCountry = (id: TerritoryId) => {
    flyTo(id);
    router.push(`/c/${campaign.id}`);
  };
  const showWar = (warId: string) => {
    setSelected(null);
    if (panels.gameId) panels.set('game', null);
    panels.set('war', warId);
  };
  // Desktop: the map follows the war that opens, however it was opened (here, a link, the back button).
  const shownWar = useRef<string | null>(null);
  useEffect(() => {
    if (!openWar) {
      shownWar.current = null;
      return;
    }
    if (shownWar.current === openWar.id) return;
    shownWar.current = openWar.id;
    if (isDesktop) setFocus({ id: openWar.targetId, nonce: Date.now() });
  }, [openWar, isDesktop]);
  const closeWar = () => panels.set('war', null);
  const closeGame = () => panels.set('game', null);
  const openChat = (userId: string) => panels.set('chat', userId);
  const closeChat = () => panels.set('chat', null);
  /** From a dispatch: on phones the war opens in the Wars tab. */
  const showWarFromDiplo = (warId: string) => {
    showWar(warId);
    if (!isDesktop) setTab('wars');
  };

  const mapWars: MapWar[] = useMemo(
    () =>
      model.activeWars.map((w) => ({
        id: w.id,
        from: w.launchId,
        to: w.targetId,
        threat: w.status === 'declared' || w.status === 'countered',
        mine: w.attackerId === me || w.defenderId === me,
      })),
    [model.activeWars, me],
  );
  const atWar = campaign.status === 'active' || campaign.status === 'finished';

  const territoryPanel = selected && (
    <TerritoryPanel
      model={model}
      territoryId={selected}
      onSelect={flyTo}
      onClose={() => setSelected(null)}
      onOpenWar={showWar}
      onPreview={setPreview}
    />
  );
  const warPanel = openWar && (
    <WarDetail
      model={model}
      war={openWar}
      onSelectCountry={flyTo}
      onFocusCountry={(id) => setFocus({ id, nonce: Date.now() })}
      onOpenGame={openGame}
      onClose={closeWar}
      onPreview={setPreview}
    />
  );
  const gamePanel = panels.gameId && (
    <GamePanel model={model} gameId={panels.gameId} onClose={closeGame} onOpenWar={showWar} />
  );
  const warRoom = (
    <div className="space-y-6 p-4">
      <WarsPanel model={model} onOpenWar={showWar} onOpenGame={openGame} />
      <Standings model={model} />
    </div>
  );
  const diploPanel = (
    <DiploPanel
      model={model}
      view={diploView}
      onView={changeDiploView}
      chatWith={chatWith}
      onOpenChat={openChat}
      onCloseChat={closeChat}
      focusAccordId={accordId}
      onSelect={flyTo}
      onOpenWar={showWarFromDiplo}
    />
  );
  const missionsPanel = objectives && (
    <MissionsPanel model={model} onSelectCountry={flyTo} onShowOnMap={showMission} onOpenWar={showWarFromDiplo} />
  );
  // Badges: amber when something needs the player, plain for unread channel messages and for
  // rivals' claims waiting to score.
  const warsNeedMe = model.awaitingMe.length + myMoves;
  const diploNeedsMe = model.proposalsToMe.length + unread.direct;
  const rivalsClaiming = objectives ? rivalClaims(model).length : 0;
  const leftPanel =
    campaign.status === 'lobby' ? (
      <LobbyPanel model={model} onSelect={flyTo} onShowOnMap={showMission} />
    ) : campaign.status === 'selection' ? (
      missionsPanel
    ) : atWar ? (
      warRoom
    ) : (
      <DraftPanel model={model} onSelect={flyTo} onOpenWar={showWar} />
    );
  const sides = [
    {
      id: 'main' as const,
      label: MAIN_LABEL[campaign.status],
      badge: model.myTurn || mustChoose ? 1 : warsNeedMe,
      alert: true,
    },
    ...(objectives && campaign.status !== 'lobby' && campaign.status !== 'selection'
      ? [{ id: 'missions' as const, label: 'Missions', badge: rivalsClaiming }]
      : []),
    { id: 'diplo' as const, label: 'Diplo', badge: diploNeedsMe || unread.channel, alert: diploNeedsMe > 0 },
  ];

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <CampaignHeader
        model={model}
        connected={connected}
        myMoves={myMoves}
        answers={answers}
        mustChoose={mustChoose}
        back={
          overPage
            ? { href: `/c/${campaign.id}${panels.query ? `?${panels.query}` : ''}`, label: 'Back to the map' }
            : { href: '/', label: 'All campaigns' }
        }
        rules={{
          // Like links to empire pages, this keeps the query, so a panel open underneath stays as it was.
          href: `/c/${campaign.id}/rules${panels.query ? `?${panels.query}` : ''}`,
          open: pageSegment === 'rules',
        }}
      />

      <div className="relative flex min-h-0 flex-1">
        {isDesktop && (
          <aside
            className="flex w-[340px] shrink-0 flex-col border-r border-line"
            aria-label="Campaign"
            inert={overPage}
          >
            <SegmentTabs<Side>
              label="Campaign"
              value={sides.some((s) => s.id === side) ? side : 'main'}
              onChange={setSide}
              tabs={sides}
            />
            {side === 'diplo' ? (
              <div className="min-h-0 flex-1">{diploPanel}</div>
            ) : side === 'missions' && sides.some((s) => s.id === 'missions') ? (
              <div className="min-h-0 flex-1 overflow-y-auto">{missionsPanel}</div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">{leftPanel}</div>
            )}
          </aside>
        )}

        {/* A page over the map room leaves it mounted, as it was, but out of reach until it closes. */}
        <main className="relative min-w-0 flex-1" inert={overPage}>
          <WorldMap
            topo={topo}
            dataset={model.idx.dataset}
            owners={model.ownerColors}
            selectedId={selected}
            highlighted={showTargets && atWar ? model.targets : model.highlighted}
            showValues={showValues}
            onSelect={selectOnMap}
            focus={focus}
            initialFrame={initialFrame}
            bottomInset={isDesktop ? 0 : sheetHeight}
            listed={model.draftListOpen ? model.campaign.myDraftList : undefined}
            wars={mapWars}
            onSelectWar={showWar}
            preview={preview}
            mission={missionMap?.overlay ?? null}
            fit={fit}
          />

          <div className="pointer-events-none absolute top-3 right-[4.25rem] left-3 flex max-w-lg flex-col gap-2">
            <div className="flex items-start gap-2">
              <div className="pointer-events-auto flex-1">
                <CountrySearch idx={model.idx} onPick={flyTo} />
              </div>
              {campaign.status === 'active' && (
                <MapToggle pressed={showTargets} onClick={() => setShowTargets((v) => !v)}>
                  Targets
                </MapToggle>
              )}
              <MapToggle pressed={showValues} onClick={() => setShowValues((v) => !v)}>
                Values
              </MapToggle>
            </div>
            {missionMap && (
              <div
                role="status"
                className="pointer-events-auto flex min-h-11 max-w-full items-center gap-2 self-start rounded-[3px] border border-paper/60 bg-panel/95 pl-3 shadow-lg backdrop-blur"
              >
                <span className="min-w-0 truncate text-sm">
                  <span className="text-muted">Showing </span>
                  <strong className="font-stencil text-base tracking-wide">{missionMap.label}</strong>
                  {missionMap.overlay.targets.length === 0 && <span className="text-muted"> · no fixed targets</span>}
                </span>
                <button
                  type="button"
                  className="flex size-11 shrink-0 items-center justify-center text-lg text-muted hover:text-paper"
                  aria-label="Stop showing the mission"
                  onClick={() => setMissionFocus(null)}
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Phones: a sheet over the map for the selected country or war, or the campaign at a glance. */}
          {!isDesktop && tab === 'map' && (
            <div ref={sheetRef} className="absolute inset-x-0 bottom-0">
              {warPanel || territoryPanel ? (
                <div className="sheet-in max-h-[58dvh] overflow-y-auto rounded-t-md border-t border-line-strong bg-panel shadow-[0_-8px_24px_rgba(0,0,0,0.4)]">
                  {warPanel ?? territoryPanel}
                </div>
              ) : (
                <MapFooter model={model} onOpen={(t) => setTab(t)} />
              )}
            </div>
          )}

          {/* Phones: other tabs cover the map (which stays mounted to keep its zoom). */}
          {!isDesktop && tab !== 'map' && (
            <div className={`absolute inset-0 bg-gunmetal ${tab === 'diplo' ? 'flex flex-col' : 'overflow-y-auto'}`}>
              {tab === 'lobby' && <LobbyPanel model={model} onSelect={flyTo} onShowOnMap={showMission} />}
              {tab === 'wars' && (warPanel ?? warRoom)}
              {tab === 'draft' && <DraftPanel model={model} onSelect={flyTo} onOpenWar={showWar} />}
              {tab === 'missions' && missionsPanel}
              {tab === 'diplo' && diploPanel}
              {tab === 'empire' && <EmpirePanel model={model} onSelect={flyTo} />}
            </div>
          )}

          {/* Phones: the board fills the screen, opponent's clock above and yours below. */}
          {!isDesktop && gamePanel && (
            <div className="absolute inset-0 z-20 overflow-y-auto bg-gunmetal">{gamePanel}</div>
          )}
        </main>

        {isDesktop && (
          <aside
            className={`shrink-0 overflow-y-auto border-l border-line ${gamePanel ? 'w-[460px]' : 'w-[360px]'}`}
            aria-label="Details"
            inert={overPage}
          >
            {gamePanel || warPanel || territoryPanel || <EmpirePanel model={model} onSelect={flyTo} />}
          </aside>
        )}

        <CampaignRoomProvider value={{ model, showCountry }}>
          {/* One element either way, so opening and closing a page doesn't remount Next's router below. */}
          <div className={overPage ? 'absolute inset-0 z-40 overflow-y-auto bg-gunmetal' : 'hidden'}>{children}</div>
        </CampaignRoomProvider>

        {toast && (
          <div
            role="status"
            className={`sheet-in pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-[3px] bg-amber px-4 py-2 text-center font-stencil text-xl tracking-wide whitespace-nowrap text-gunmetal shadow-xl ${
              overPage ? 'top-3' : 'top-18'
            }`}
          >
            {toast}
          </div>
        )}
      </div>

      {!isDesktop && (
        <nav
          className="grid shrink-0 border-t border-line bg-gunmetal pb-[env(safe-area-inset-bottom)]"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          aria-label="Sections"
        >
          {tabs.map((t) => {
            const alert =
              (t.id === 'draft' && model.myTurn) ||
              (t.id === 'wars' && warsNeedMe > 0) ||
              (t.id === 'missions' && mustChoose) ||
              (t.id === 'diplo' && diploNeedsMe > 0);
            const quiet =
              !alert && ((t.id === 'diplo' && unread.channel > 0) || (t.id === 'missions' && rivalsClaiming > 0));
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  if (overPage) router.push(`/c/${campaign.id}`);
                  else if (panels.gameId) closeGame();
                }}
                aria-current={tab === t.id && !overPage ? 'page' : undefined}
                className={`relative min-h-14 font-bold uppercase ${
                  tabs.length > 4 ? 'text-[0.8rem] tracking-[0.06em]' : 'text-sm tracking-[0.12em]'
                } ${tab === t.id && !overPage ? 'text-paper' : 'text-faint'}`}
              >
                {tab === t.id && !overPage && (
                  <span className="absolute inset-x-6 top-0 h-0.5 bg-amber" aria-hidden="true" />
                )}
                {t.label}
                {alert && (tab !== t.id || overPage) && (
                  <span className="absolute top-3 ml-1 size-2 rounded-full bg-amber" aria-label="needs you" />
                )}
                {quiet && (tab !== t.id || overPage) && (
                  <span
                    className="absolute top-3 ml-1 size-2 rounded-full bg-paper/70"
                    aria-label={t.id === 'missions' ? 'rivals’ claims' : 'unread messages'}
                  />
                )}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

function MapToggle({ pressed, onClick, children }: { pressed: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`pointer-events-auto btn btn-sm min-h-11 border-line-strong shadow-lg ${
        pressed ? 'bg-paper text-gunmetal' : 'bg-panel/95 text-paper'
      }`}
    >
      {children}
    </button>
  );
}

function CampaignHeader({
  model,
  connected,
  myMoves,
  answers,
  mustChoose,
  back,
  rules,
}: {
  model: CampaignModel;
  connected: boolean;
  myMoves: number;
  answers: number;
  /** A secret mission is waiting to be chosen. */
  mustChoose: boolean;
  /** Where the arrow leads: all campaigns, or back to the map from a page over it. */
  back: { href: string; label: string };
  /** The rules page, always a tap away; `open` while it's showing. */
  rules: { href: string; open: boolean };
}) {
  const { campaign } = model;
  const victory = campaign.victory;
  const myPoints = victory?.players.find((p) => p.userId === model.me.userId)?.points ?? 0;
  const winners = victory?.result?.winners.map((id) => model.membersById.get(id)?.name ?? 'A player') ?? [];
  const statusLine = {
    lobby: `Lobby · ${campaign.members.length} of ${campaign.rules.maxPlayers} players`,
    draft: campaign.draft ? `Draft · Round ${campaign.draft.round} of ${model.totalRounds}` : 'Draft',
    selection: 'Draft over · choosing secret missions',
    active:
      `Round ${campaign.round} · ${model.tokens} war ${model.tokens === 1 ? 'token' : 'tokens'}` +
      (victory ? ` · ${myPoints} of ${victory.pointsToWin} VP` : ''),
    finished:
      winners.length > 0
        ? `Finished · ${winners.join(' and ')} ${winners.length > 1 ? 'share it' : 'won'}`
        : 'Finished',
  }[campaign.status];
  const wars = model.activeWars.length;
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-line bg-gunmetal px-2 pt-[env(safe-area-inset-top)]">
      <Link
        href={back.href}
        aria-label={back.label}
        className="flex size-11 items-center justify-center text-xl text-muted hover:text-paper"
      >
        ←
      </Link>
      <div className="min-w-0 flex-1 py-1.5">
        <h1 className="truncate text-lg leading-tight font-bold">{campaign.name}</h1>
        <p className="truncate text-xs font-semibold tracking-[0.14em] text-muted uppercase">{statusLine}</p>
      </div>
      {!connected && (
        <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
          <span className="size-2 animate-pulse rounded-full bg-grease" aria-hidden="true" />
          Reconnecting
        </span>
      )}
      {wars > 0 && (
        <span className="text-sm font-bold tracking-wider text-[#ef7b72] uppercase">
          {wars} {wars === 1 ? 'war' : 'wars'} ⚑
        </span>
      )}
      {(model.myTurn || mustChoose || myMoves > 0 || answers > 0) && (
        <span className="rounded-[3px] bg-amber px-2 py-1 text-sm font-bold tracking-wider whitespace-nowrap text-gunmetal uppercase">
          {model.myTurn ? 'Your pick' : mustChoose ? 'Choose mission' : myMoves > 0 ? 'Your move' : 'Answer needed'}
        </span>
      )}
      <Link
        href={rules.href}
        aria-label="Rules"
        aria-current={rules.open ? 'page' : undefined}
        className="group flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 text-sm font-bold tracking-wider text-muted uppercase hover:text-paper aria-[current=page]:text-paper sm:px-1"
      >
        <span
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded-full border-[1.5px] border-current text-[0.8rem] leading-none group-aria-[current=page]:border-paper group-aria-[current=page]:bg-paper group-aria-[current=page]:text-gunmetal"
        >
          ?
        </span>
        <span className="hidden sm:inline">Rules</span>
      </Link>
    </header>
  );
}

function MapFooter({ model, onOpen }: { model: CampaignModel; onOpen(tab: Tab): void }) {
  const { campaign } = model;
  const atWar = campaign.status === 'active' || campaign.status === 'finished';
  const toMissions = campaign.victory !== null && (campaign.status === 'selection' || campaign.status === 'finished');
  const target: Tab = toMissions ? 'missions' : atWar ? 'wars' : 'draft';
  const label = {
    missions: campaign.status === 'finished' ? 'Results' : 'Missions',
    wars: 'Wars',
    draft: 'Draft board',
  }[target as 'missions' | 'wars' | 'draft'];
  return (
    <div className="border-t border-line-strong bg-panel/95 p-3 backdrop-blur">
      {campaign.status === 'lobby' ? (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-[0.95rem] text-muted">Scout the map while the table fills up.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen('lobby')}>
            Lobby
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <DraftStatus model={model} compact />
          </div>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => onOpen(target)}>
            {label}
          </button>
        </div>
      )}
    </div>
  );
}
