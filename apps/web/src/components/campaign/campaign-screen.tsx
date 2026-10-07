'use client';

import { missionName, type CampaignStatus, type TerritoryId } from '@empire/rules';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { Topology } from 'topojson-specification';
import { ApiError, errorMessage } from '@/lib/api';
import { buildModel, nextAnswer, type CampaignModel } from '@/lib/campaign';
import { useCampaign, useMapData, useMe, useWar } from '@/lib/queries';
import { useRealtime, useServerMessages } from '@/lib/realtime';
import { CAMPAIGN_WIDTH, RAIL_WIDTH, roomLayout } from '@/lib/room-layout';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useElementSize } from '@/lib/use-element-size';
import { useFullscreen } from '@/lib/use-fullscreen';
import { useIsDesktop } from '@/lib/use-media-query';
import { useMyGames } from '@/lib/use-my-games';
import { findMission, missionOverlay, progressOf, rivalClaims, titleOf } from '@/lib/victory';
import { countryName, outcomeText, playerName, stakedByRaises } from '@/lib/wars';
import { DiploPanel, useUnread, type DiploView } from '../diplo/diplo-panel';
import { GamePanel } from '../game/game-panel';
import { WorldMap, type MapWar, type MapWarFocus } from '../map/world-map';
import { Notice, SegmentTabs, Spinner, type SegmentTab } from '../ui';
import { StandInBanner } from './stand-in';
import { AwardCeremonies } from '../victory/award-ceremony';
import { Finale, useFinale } from '../victory/finale';
import { MissionsPanel, type MissionFocus } from '../victory/missions-panel';
import { usePageVisible } from '../victory/score-effects';
import { CampaignControls } from './campaign-controls';
import { CountrySearch } from './country-search';
import { DraftPanel, DraftStatus, Standings } from './draft-panel';
import { EmpirePanel } from './empire-panel';
import { LobbyPanel } from './lobby-panel';
import { TitlesProvider } from '../victory/title-tokens';
import { CampaignRoomProvider, useResultsHref } from './room-context';
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
/** The desktop's left column, which the rail's buttons open over the map when it's folded. */
const CAMPAIGN_PANEL_ID = 'campaign-panel';

/** What the header's calls to action lead to, most pressing first. */
type ActionKind = 'pick' | 'mission' | 'move' | 'turn' | 'answer';

/**
 * A campaign: the map room, with any page opened over it (an empire's statistics) as `children`,
 * and who holds each title for every player's name in it (`PlayerName`).
 */
export function CampaignScreen({ id, children }: { id: string; children?: ReactNode }) {
  const titles = useCampaign(id).data?.victory?.titles ?? NO_TITLES;
  return (
    <TitlesProvider value={titles}>
      <CampaignScreenInner id={id}>{children}</CampaignScreenInner>
    </TitlesProvider>
  );
}

const NO_TITLES: never[] = [];

function CampaignScreenInner({ id, children }: { id: string; children?: ReactNode }) {
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

  // The host deleted it, or a finished campaign's time ran out, while it was open.
  const [deleted, setDeleted] = useState(false);
  useServerMessages((message) => {
    if (message.type === 'campaign.deleted' && message.campaignId === id) setDeleted(true);
  });

  // A refetch that fails (a slow or dropped connection) keeps the room on what it last read; the
  // next push, focus or reconnect reads it again. Only a campaign that's gone, or one never read, stops it.
  const campaignGone = campaign.error instanceof ApiError && campaign.error.status === 404;
  const error =
    (campaignGone || !campaign.data ? campaign.error : null) ??
    (mapData.data ? null : mapData.error) ??
    (me.data ? null : me.error);
  const notMember = Boolean(campaign.data && user && mapData.data && !model);
  if (deleted) {
    return (
      <CenteredMessage>
        <Notice tone="info">This campaign has been deleted.</Notice>
        <Link href="/campaigns" className="btn btn-ghost mt-4">
          All campaigns
        </Link>
      </CenteredMessage>
    );
  }
  if (error || notMember) {
    const gone = notMember || campaignGone;
    return (
      <CenteredMessage>
        <Notice tone={gone ? 'info' : 'error'}>
          {gone ? 'This campaign does not exist, or you are not part of it.' : errorMessage(error)}
        </Notice>
        <Link href="/campaigns" className="btn btn-ghost mt-4">
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
  // A page open over the map room: an empire's statistics, every empire's compared, or the rules.
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
  // Award ceremonies wait while the clock may be running on the player (until a game's state says otherwise).
  const inLiveGame =
    campaign.rules.war.pace === 'live' &&
    myGames.some((g) => !g.overTheBoard && (g.game === undefined || g.game.status === 'playing'));
  const answers = model.answers.length;
  const unread = useUnread(campaign.id);
  // The campaign's ending, once any ceremony for the points that brought it has played; then the results.
  const [ceremoniesBusy, setCeremoniesBusy] = useState(false);
  const visible = usePageVisible();
  const finale = useFinale(model, !ceremoniesBusy && !inLiveGame && visible);
  const resultsHref = useResultsHref(campaign.id);
  const { leave: leaveFinale } = finale;
  const finaleLeaving = useCallback(() => {
    leaveFinale();
    if (pageSegment !== 'results') router.push(resultsHref);
  }, [leaveFinale, pageSegment, router, resultsHref]);
  const finished = campaign.status === 'finished' && Boolean(campaign.victory?.result);
  // A finished Objectives campaign opens on its results.
  const [side, setSide] = useState<Side>(campaign.status === 'finished' && objectives ? 'missions' : 'main');
  const [diploView, setDiploView] = useState<DiploView>('dispatches');
  // Full screen: the map, or the board. A game opening over the full-screen map fills the screen
  // too, and the map's full screen comes back when it closes.
  const full = useFullscreen<'map' | 'game'>();
  const gameFull = Boolean(panels.gameId) && full.mode !== null;
  const mapFull = !panels.gameId && full.mode === 'map';
  const { exit: exitFull } = full;
  useEffect(() => {
    if (full.mode === 'game' && !panels.gameId) exitFull();
  }, [full.mode, panels.gameId, exitFull]);
  // A page over the map room (the rules, an empire) needs the room around it.
  useEffect(() => {
    if (overPage) exitFull();
  }, [overPage, exitFull]);

  // Desktop: the left column stays open beside the map only while the map keeps its room
  // (`roomLayout`); otherwise it folds into a rail along the edge, whose buttons open it over the map
  // as a drawer. An open game takes the width its board needs, so the board comes first.
  const [roomRef, room] = useElementSize(() =>
    typeof window === 'undefined'
      ? { width: 1440, height: 848 }
      : { width: window.innerWidth, height: window.innerHeight - 52 },
  );
  const layout = roomLayout(room.width, room.height, Boolean(panels.gameId));
  const rail = isDesktop && !layout.campaignColumn;
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Back in columns, the drawer starts closed next time, so a game folding the column leaves the map clear.
  useEffect(() => {
    if (!rail) setDrawerOpen(false);
  }, [rail]);
  const railRef = useRef(rail);
  useLayoutEffect(() => {
    railRef.current = rail;
  });
  /** Shows a section of the left column, opening it over the map if it's folded into the rail. */
  const showSide = useCallback((next: Side) => {
    setSide(next);
    if (railRef.current) setDrawerOpen(true);
  }, []);

  // A conversation or accord in the address (a notification, the back button) opens Diplo on it.
  const { chatWith, accordId } = panels;
  useEffect(() => {
    if (!chatWith) return;
    setDiploView('messages');
    setTab('diplo');
    showSide('diplo');
  }, [chatWith, showSide]);
  useEffect(() => {
    if (!accordId) return;
    setDiploView('accords');
    setTab('diplo');
    showSide('diplo');
  }, [accordId, showSide]);
  const changeDiploView = (view: DiploView) => {
    if (view !== 'messages' && chatWith) panels.set('chat', null);
    if (view !== 'accords' && accordId) panels.set('accord', null);
    setDiploView(view);
  };
  // Leaving Diplo (or closing the drawer it's in, see `closeDrawer`) drops its address, so a
  // notification for the same conversation opens it again. A game folding the column away isn't
  // leaving it: the conversation is still open when the column comes back.
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
    showSide(campaign.status === 'selection' ? 'main' : 'missions');
    panels.set('missions', null);
  }, [missionsLinked, objectives, campaign.status, panels, showSide]);

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

  // Tell the player when their pick comes up, or their turn to declare.
  const wasMyTurn = useRef(model.myTurn);
  useEffect(() => {
    if (model.myTurn && !wasMyTurn.current) {
      setToast('Your pick');
      navigator.vibrate?.(120);
    }
    wasMyTurn.current = model.myTurn;
  }, [model.myTurn]);
  const declareTurn = Boolean(model.turns?.mine);
  const wasDeclareTurn = useRef(declareTurn);
  useEffect(() => {
    if (declareTurn && !wasDeclareTurn.current) {
      setToast('Your turn to declare');
      navigator.vibrate?.(120);
    }
    wasDeclareTurn.current = declareTurn;
  }, [declareTurn]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // The open game's panel, and what had focus when it opened: closing the board puts focus back
  // there (a game card in the war room, say), if it's still there to take it.
  const gameRef = useRef<HTMLElement | null>(null);
  const gameOpener = useRef<HTMLElement | null>(null);
  const closingGame = useRef(false);
  const openGame = useCallback(
    (gameId: string) => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !gameRef.current?.contains(active)) {
        gameOpener.current = active;
      }
      panels.set('game', gameId);
    },
    [panels],
  );
  const closeGame = () => {
    closingGame.current = true;
    panels.set('game', null);
  };
  const { gameId: openGameId } = panels;
  useLayoutEffect(() => {
    if (openGameId) return;
    const opener = gameOpener.current;
    const closed = closingGame.current;
    gameOpener.current = null;
    closingGame.current = false;
    const active = document.activeElement;
    if (!closed || !opener || (active && active !== document.body)) return;
    if (opener.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
  }, [openGameId]);

  // Intel reports: wars declared on me, answers I'm owed, battles starting and ending. Missions
  // scored and titles changing hands play as award ceremonies instead (`AwardCeremonies`), and the
  // campaign won as its ending.
  const modelRef = useRef(model);
  useEffect(() => {
    modelRef.current = model;
  });
  useServerMessages((message) => {
    if (message.type !== 'campaign.events' || message.campaignId !== campaign.id) return;
    const current = modelRef.current;
    const warById = (warId: string) => current.campaign.wars.find((w) => w.id === warId);
    // A raise met at once from reserves is answered in the same change.
    const replied = new Set(message.events.flatMap((e) => (e.type === 'war.reply' ? [e.payload.warId] : [])));
    for (const e of message.events) {
      if (e.type === 'war.declared' && e.payload.defenderId === me) {
        setToast(`War declared on ${countryName(current, e.payload.targetId)}`);
        navigator.vibrate?.([80, 60, 80]);
      } else if (
        e.type === 'war.response' &&
        e.payload.counter &&
        !replied.has(e.payload.warId) &&
        warById(e.payload.warId)?.attackerId === me
      ) {
        setToast('Your attack needs an answer');
      } else if (
        e.type === 'war.reply' &&
        e.payload.reply === 'raise' &&
        !message.events.some(
          (x) => x.type === 'war.reply' && x.payload.warId === e.payload.warId && x.payload.fromReserves,
        ) &&
        (e.payload.by === 'defender'
          ? warById(e.payload.warId)?.attackerId === me
          : warById(e.payload.warId)?.defenderId === me)
      ) {
        setToast(`${playerName(current, e.actorId ?? '')} raised again`);
      } else if (e.type === 'war.recalled' && warById(e.payload.warId)?.defenderId === me) {
        setToast(`${playerName(current, e.actorId ?? '')} called off the attack`);
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
        const mission = missionName({ kind: e.payload.kind }, current.campaign.rules.victory.version);
        setToast(
          e.payload.userId === me
            ? `Claim started: ${mission}`
            : `${playerName(current, e.payload.userId)} claims ${mission}`,
        );
      } else if (e.type === 'claim.interrupted' && e.payload.userId === me) {
        setToast(`Claim lost: ${missionName({ kind: e.payload.kind }, current.campaign.rules.victory.version)}`);
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
  // Peace terms too: only the two players at war hear of them.
  const seenPeace = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(model.peaceToMe.map(({ offer }) => offer.id));
    const fresh = seenPeace.current && model.peaceToMe.find(({ offer }) => !seenPeace.current!.has(offer.id));
    if (fresh) setToast(`${playerName(model, fresh.offer.proposerId)} offers peace`);
    seenPeace.current = ids;
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
        : declareTurn
          ? '(Your turn) '
          : answers > 0
            ? '(Answer needed) '
            : unread.direct > 0
              ? '(New message) '
              : '';
  const page = empireOf
    ? `${model.membersById.get(empireOf)?.name ?? 'Empire'} · `
    : pageSegment === 'rules'
      ? 'Rules · '
      : pageSegment === 'compare'
        ? 'Compare empires · '
        : pageSegment === 'results'
          ? 'Results · '
          : '';
  useDocumentTitle(`${flag}${page}${campaign.name} · Geo Chess`);

  const [initialFrame] = useState(() => model.holdingsByUser.get(me) ?? []);

  // How far down the controls along the map's top reach, and how much of the map the phone's
  // bottom sheet covers, so the map can keep clear of both.
  const [controlsBottom, setControlsBottom] = useState(0);
  const controlsRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(() => setControlsBottom(el.offsetTop + el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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
  /**
   * Calls a mission out on the map, framing its targets; phones switch to the map to show it, and a
   * drawer over the map closes.
   */
  const [fit, setFit] = useState<{ ids: TerritoryId[]; nonce: number } | null>(null);
  const showMission = (focus: MissionFocus) => {
    setMissionFocus(focus);
    setSelected(null);
    if (!isDesktop) setTab('map');
    else if (rail && drawerOpen) closeDrawer();
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
  // The war open beside the map, or the one the open game is fought for: its countries called out.
  const gameWar = panels.gameId ? campaign.wars.find((w) => w.games.some((g) => g.id === panels.gameId)) : undefined;
  const warOnMap = openWar ?? gameWar;
  const mapWarFocus: MapWarFocus | null = useMemo(
    () =>
      warOnMap
        ? { id: warOnMap.id, attacker: warOnMap.stake, defender: [warOnMap.targetId, ...stakedByRaises(warOnMap)] }
        : null,
    [warOnMap],
  );
  // Desktop: the map frames the war that opens, however it was opened (here, a link, the back button, its game).
  const shownWar = useRef<string | null>(null);
  useEffect(() => {
    if (!mapWarFocus) {
      shownWar.current = null;
      return;
    }
    if (!isDesktop || shownWar.current === mapWarFocus.id) return;
    shownWar.current = mapWarFocus.id;
    setFit({ ids: [...mapWarFocus.attacker, ...mapWarFocus.defender], nonce: Date.now() });
  }, [mapWarFocus, isDesktop]);
  const closeWar = () => panels.set('war', null);
  const openChat = (userId: string) => panels.set('chat', userId);
  const closeChat = () => panels.set('chat', null);
  /** From a dispatch: on phones the war opens in the Wars tab. */
  const showWarFromDiplo = (warId: string) => {
    showWar(warId);
    if (!isDesktop) setTab('wars');
  };

  // The header's calls to action take the player to what they name: the draft, the mission options,
  // a game waiting for a move, the war room on their turn to declare, or what needs an answer (the
  // soonest deadline first), which lights up. Pressing again moves on to the next game or answer.
  const [spotlight, setSpotlight] = useState<{ id: string; nonce: number } | null>(null);
  const lastAnswer = useRef<string | null>(null);
  // The light is for that press, not for the next time the war or proposal is opened by hand.
  useEffect(() => {
    if (!spotlight) return;
    const timer = setTimeout(() => setSpotlight(null), 3000);
    return () => clearTimeout(timer);
  }, [spotlight]);
  const act = (kind: ActionKind) => {
    if (kind === 'pick' || kind === 'mission' || kind === 'turn') {
      if (overPage) router.push(`/c/${campaign.id}`);
      if (isDesktop) showSide('main');
      else setTab(kind === 'pick' ? 'draft' : kind === 'mission' ? 'missions' : 'wars');
      return;
    }
    if (kind === 'move') {
      const moves = myGames.filter((g) => g.myMove);
      const next = moves[(moves.findIndex((g) => g.gameId === panels.gameId) + 1) % moves.length];
      if (next) openGame(next.gameId);
      return;
    }
    const next = nextAnswer(model.answers, lastAnswer.current);
    if (!next) return;
    lastAnswer.current = next.id;
    setSpotlight({ id: next.id, nonce: Date.now() });
    if (next.kind === 'accord') {
      // Diplo opens on the accords in this same render, so the proposal is there to light up.
      setDiploView('accords');
      if (isDesktop) showSide('diplo');
      else setTab('diplo');
      panels.set('accord', next.id);
    } else showWarFromDiplo(next.id);
  };
  const actions: HeaderAction[] = model.me.bot
    ? []
    : [
        ...(model.myTurn ? [{ kind: 'pick' as const, label: 'Your pick', title: 'Go to the draft' }] : []),
        ...(mustChoose
          ? [{ kind: 'mission' as const, label: 'Choose mission', title: 'Go to your mission options' }]
          : []),
        ...(myMoves > 0
          ? [{ kind: 'move' as const, label: 'Your move', title: 'Open the next game waiting for your move' }]
          : []),
        ...(declareTurn
          ? [{ kind: 'turn' as const, label: 'Your turn', title: 'Go to the war room to declare war or pass' }]
          : []),
        ...(answers > 0
          ? [{ kind: 'answer' as const, label: 'Answer needed', title: 'Show the next thing waiting for your answer' }]
          : []),
      ];

  const fortifiedIds = useMemo(() => Object.keys(model.campaign.fortified), [model.campaign.fortified]);
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
      spotlight={spotlight?.id === openWar.id ? spotlight.nonce : null}
    />
  );
  const gamePanel = panels.gameId && (
    <GamePanel
      ref={gameRef}
      model={model}
      gameId={panels.gameId}
      onClose={closeGame}
      onOpenWar={showWar}
      fullscreen={gameFull}
      onFullscreen={() => (gameFull ? full.exit() : full.enter('game'))}
    />
  );
  const warRoom = (
    <div className="space-y-6 p-4">
      <WarsPanel model={model} onOpenWar={showWar} onOpenGame={openGame} />
      <Standings model={model} />
      <CampaignControls model={model} />
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
      spotlight={spotlight}
      onSelect={flyTo}
      onOpenWar={showWarFromDiplo}
      // It stays mounted while hidden, but only reads messages (and marks them read) on screen: not
      // in a closed drawer, under a page or a phone's board, or behind a full-screen map or board.
      active={
        diploShown && (!rail || drawerOpen) && !overPage && !mapFull && !gameFull && (isDesktop || !panels.gameId)
      }
    />
  );
  const missionsPanel = objectives && (
    <MissionsPanel model={model} onSelectCountry={flyTo} onShowOnMap={showMission} onOpenWar={showWarFromDiplo} />
  );
  // Badges: amber when something needs the player, plain for unread channel messages and for
  // rivals' claims waiting to score.
  const warsNeedMe =
    new Set([...model.awaitingMe, ...model.peaceToMe.map(({ war }) => war)]).size + myMoves + (declareTurn ? 1 : 0);
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
  const sides: SegmentTab<Side>[] = [
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
  const shownSide: Side = sides.some((s) => s.id === side) ? side : 'main';
  const sideContent: Record<Side, ReactNode> = { main: leftPanel, missions: missionsPanel, diplo: diploPanel };
  const phoneTab = (id: Tab): ReactNode =>
    ({
      map: null,
      lobby: <LobbyPanel model={model} onSelect={flyTo} onShowOnMap={showMission} />,
      // An open war shows in this tab while it's up, and over the map otherwise.
      wars: (tab === 'wars' && warPanel) || warRoom,
      draft: <DraftPanel model={model} onSelect={flyTo} onOpenWar={showWar} />,
      missions: missionsPanel,
      diplo: diploPanel,
      empire: <EmpirePanel model={model} onSelect={flyTo} />,
    })[id];
  // Phones: the sheet over the map, which another tab covers without unmounting it.
  const sheetPanel = tab === 'wars' ? territoryPanel : (warPanel ?? territoryPanel);

  // The left column's sections and the phone's tabs mount the first time they show, then stay
  // mounted, hidden while another shows: a message being written, a form half filled in and a
  // scroll position all survive switching away and back, and opening and closing the drawer.
  const showing = isDesktop ? `side:${shownSide}` : `tab:${tab}`;
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setSeen((s) => (s.has(showing) ? s : new Set(s).add(showing)));
  }, [showing]);
  const mounted = (key: string) => key === showing || seen.has(key);

  // The rail: each button opens its section over the map, or closes it if it's the one open. Opened
  // from the rail, the drawer takes focus; closed, focus goes back to its button.
  const campaignRef = useRef<HTMLElement>(null);
  const railButtons = useRef(new Map<Side, HTMLButtonElement>());
  const drawerTitle = useRef<HTMLHeadingElement>(null);
  const [drawerFocus, setDrawerFocus] = useState(0);
  useEffect(() => {
    if (drawerFocus) drawerTitle.current?.focus({ preventScroll: true });
  }, [drawerFocus]);
  const pickSide = (next: Side) => {
    if (drawerOpen && shownSide === next) {
      closeDrawer();
      return;
    }
    setSide(next);
    setDrawerOpen(true);
    setDrawerFocus((n) => n + 1);
  };
  function closeDrawer() {
    if (campaignRef.current?.contains(document.activeElement)) {
      railButtons.current.get(shownSide)?.focus({ preventScroll: true });
    }
    setDrawerOpen(false);
    // Closing Diplo is leaving it, as switching away is.
    if (shownSide === 'diplo') {
      if (chatWith) panels.set('chat', null);
      if (accordId) panels.set('accord', null);
    }
  }
  const onDrawerKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    closeDrawer();
  };
  // Whatever folds the column away (a game opening beside the map) doesn't lose the keyboard's place:
  // focus goes to the game, or to the rail.
  const campaignHidden = rail && !drawerOpen;
  const focusInCampaign = useRef(false);
  useLayoutEffect(() => {
    if (!campaignHidden || !focusInCampaign.current) return;
    focusInCampaign.current = false;
    const active = document.activeElement;
    if (active && active !== document.body && !campaignRef.current?.contains(active)) return;
    (gameRef.current ?? railButtons.current.get(shownSide))?.focus({ preventScroll: true });
  }, [campaignHidden, shownSide]);

  // A drawer open over the map: framing keeps clear of it, and so do the map's controls (the search
  // on one row and the toggles under it, if need be), unless the map beside it is too narrow for
  // them, when they wait hidden under it.
  const mapWidth = room.width - (rail ? RAIL_WIDTH : CAMPAIGN_WIDTH) - layout.detailsWidth;
  const drawerOverMap = rail && drawerOpen && !mapFull;
  const controlsBeside = drawerOverMap && mapWidth - CAMPAIGN_WIDTH >= 240;
  const controlsHidden = drawerOverMap && !controlsBeside;
  // Another tab or a game covers the map (phones), or the board fills the screen: nothing under it
  // takes focus meanwhile.
  const mapCovered = (!isDesktop && (tab !== 'map' || Boolean(gamePanel))) || gameFull;
  // Full screen, the map or the board covers the columns too.
  const behindFull = mapFull || gameFull;

  return (
    // Clipped, not hidden: a hidden overflow can still be scrolled, and focusing something that
    // overflows it (a visually hidden input) would scroll the whole room off screen. Out of reach
    // while the campaign's ending plays over it.
    <div className="flex h-dvh flex-col overflow-clip" inert={finale.playing}>
      {/* Full screen, the map or the board covers these too: out of reach until it closes. */}
      <div className="contents" inert={behindFull}>
        <CampaignHeader
          model={model}
          connected={connected}
          actions={actions}
          onAct={act}
          results={finished ? { href: resultsHref, open: pageSegment === 'results' } : null}
          back={
            overPage
              ? { href: `/c/${campaign.id}${panels.query ? `?${panels.query}` : ''}`, label: 'Back to the map' }
              : { href: '/campaigns', label: 'All campaigns' }
          }
          rules={{
            // Like links to empire pages, this keeps the query, so a panel open underneath stays as it was.
            href: `/c/${campaign.id}/rules${panels.query ? `?${panels.query}` : ''}`,
            open: pageSegment === 'rules',
          }}
        />
        <StandInBanner model={model} />
      </div>

      <div ref={roomRef} className="relative flex min-h-0 flex-1">
        {rail && (
          <CampaignRail
            sides={sides}
            open={drawerOpen ? shownSide : null}
            onPick={pickSide}
            buttonRef={(id, el) => {
              if (el) railButtons.current.set(id, el);
              else railButtons.current.delete(id);
            }}
            inert={overPage || behindFull}
          />
        )}
        {/* The left column, or the drawer the rail opens over the map: one element either way, so
            folding and unfolding it keeps everything in it as it was. */}
        {isDesktop && (
          <aside
            ref={campaignRef}
            id={CAMPAIGN_PANEL_ID}
            aria-label="Campaign"
            inert={overPage || campaignHidden || behindFull}
            data-open={rail ? drawerOpen : undefined}
            onKeyDown={rail ? onDrawerKey : undefined}
            onFocus={() => {
              focusInCampaign.current = true;
            }}
            onBlur={(e) => {
              if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) focusInCampaign.current = false;
            }}
            className={`flex flex-col pb-[env(safe-area-inset-bottom)] ${
              rail
                ? 'campaign-drawer absolute inset-y-0 z-20 border-r border-line-strong bg-gunmetal shadow-[12px_0_32px_rgba(0,0,0,0.45)]'
                : 'shrink-0 border-r border-line'
            }`}
            style={{ width: CAMPAIGN_WIDTH, left: rail ? RAIL_WIDTH : undefined }}
          >
            {rail ? (
              <div className="flex shrink-0 items-center border-b border-line pl-4">
                <h2
                  ref={drawerTitle}
                  tabIndex={-1}
                  className="min-w-0 flex-1 truncate text-[0.78rem] font-bold tracking-[0.1em] uppercase outline-none"
                >
                  {sides.find((s) => s.id === shownSide)?.label}
                </h2>
                <button
                  type="button"
                  onClick={closeDrawer}
                  aria-label={`Close ${sides.find((s) => s.id === shownSide)?.label ?? 'the panel'}`}
                  title="Close (Esc)"
                  className="flex size-11 shrink-0 items-center justify-center text-lg text-muted hover:text-paper"
                >
                  ✕
                </button>
              </div>
            ) : (
              <SegmentTabs<Side> label="Campaign" value={shownSide} onChange={setSide} tabs={sides} />
            )}
            <div className="relative min-h-0 flex-1">
              {sides.map(
                (s) =>
                  mounted(`side:${s.id}`) && (
                    <div
                      key={s.id}
                      className={`absolute inset-0 ${s.id === 'diplo' ? 'flex flex-col' : 'overflow-y-auto'} ${
                        s.id === shownSide ? '' : 'invisible'
                      }`}
                      inert={s.id !== shownSide}
                    >
                      {sideContent[s.id]}
                    </div>
                  ),
              )}
            </div>
          </aside>
        )}

        {/* A page over the map room leaves it mounted, as it was, but out of reach until it closes. */}
        <main className={mapFull ? 'fixed inset-0 z-30 bg-gunmetal' : 'relative min-w-0 flex-1'} inert={overPage}>
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
            topInset={controlsBottom}
            bottomInset={isDesktop ? 0 : sheetHeight}
            leftInset={drawerOverMap ? CAMPAIGN_WIDTH : 0}
            covered={mapCovered}
            listed={model.draftListOpen ? model.campaign.myDraftList : undefined}
            fortified={fortifiedIds}
            wars={mapWars}
            onSelectWar={showWar}
            preview={preview}
            war={mapWarFocus}
            mission={missionMap?.overlay ?? null}
            fit={fit}
            fullscreen={{
              on: mapFull,
              toggle: () => {
                if (mapFull) return full.exit();
                setTab('map');
                full.enter('map');
              },
            }}
          />

          {/* The search and toggles wrap onto two rows rather than run under the zoom buttons. */}
          <div
            ref={controlsRef}
            className={`pointer-events-none absolute top-3 right-[4.25rem] left-3 flex max-w-lg flex-col gap-2 ${
              controlsHidden ? 'invisible' : ''
            }`}
            style={controlsBeside ? { left: 12 + CAMPAIGN_WIDTH } : undefined}
            inert={mapCovered || controlsHidden}
          >
            <div className="flex flex-wrap items-start gap-2">
              <div className="pointer-events-auto min-w-32 flex-1">
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

          {/* Phones: a sheet over the map for the selected country or war, or the campaign at a glance.
              A country's sheet stays low, so the map above keeps room to show it. Other tabs cover it
              without unmounting it, so a stake being built is still there on the way back. */}
          {!isDesktop && (
            <div
              ref={sheetRef}
              className={`absolute inset-x-0 bottom-0 ${tab === 'map' ? '' : 'invisible'}`}
              inert={mapCovered}
            >
              {sheetPanel ? (
                <div
                  className={`sheet-in overflow-y-auto rounded-t-md border-t border-line-strong bg-panel shadow-[0_-8px_24px_rgba(0,0,0,0.4)] ${
                    sheetPanel === warPanel ? 'max-h-[58dvh]' : 'max-h-[42dvh]'
                  }`}
                >
                  {sheetPanel}
                </div>
              ) : (
                <MapFooter model={model} onOpen={(t) => setTab(t)} />
              )}
            </div>
          )}

          {/* Phones: other tabs cover the map (which stays mounted to keep its zoom), each mounted the
              first time it's opened and kept, hidden, while another is up. */}
          {!isDesktop && (
            <div
              className={`absolute inset-0 bg-gunmetal ${tab === 'map' ? 'invisible' : ''}`}
              inert={tab === 'map' || Boolean(gamePanel)}
            >
              {tabs.map(
                (t) =>
                  t.id !== 'map' &&
                  mounted(`tab:${t.id}`) && (
                    <div
                      key={t.id}
                      className={`absolute inset-0 ${t.id === 'diplo' ? 'flex flex-col' : 'overflow-y-auto'} ${
                        tab === t.id ? '' : 'invisible'
                      }`}
                      inert={tab !== t.id}
                    >
                      {phoneTab(t.id)}
                    </div>
                  ),
              )}
            </div>
          )}

          {/* Desktop, full screen: the selected country or war floats over the map. */}
          {isDesktop && mapFull && (warPanel || territoryPanel) && (
            <div className="sheet-in absolute bottom-3 left-3 flex max-h-[calc(100%-5.5rem)] w-[360px] flex-col overflow-y-auto rounded-md border border-line-strong bg-panel shadow-xl">
              {warPanel ?? territoryPanel}
            </div>
          )}

          {/* Phones: the board fills the screen, opponent's clock above and yours below. */}
          {!isDesktop && gamePanel && (
            <div className={`${gameFull ? FULL_GAME : 'absolute inset-0 z-20'} overflow-y-auto bg-gunmetal`}>
              {gamePanel}
            </div>
          )}
        </main>

        {/* A country, a war or your empire; or the game, as wide as its board needs to fill the height. */}
        {isDesktop && (
          <aside
            className="shrink-0 overflow-y-auto border-l border-line pb-[env(safe-area-inset-bottom)]"
            style={{ width: layout.detailsWidth }}
            aria-label="Details"
            // Full screen, the map covers it; the board, though, fills the screen from inside it.
            inert={overPage || mapFull}
          >
            {mapFull ? (
              <EmpirePanel model={model} onSelect={flyTo} />
            ) : gamePanel ? (
              // Full screen takes the board out of the column without remounting it.
              <div className={gameFull ? `${FULL_GAME} overflow-y-auto bg-gunmetal` : 'contents'}>{gamePanel}</div>
            ) : (
              warPanel || territoryPanel || <EmpirePanel model={model} onSelect={flyTo} />
            )}
          </aside>
        )}

        <CampaignRoomProvider
          value={{ model, showCountry, finale: { pending: finale.pending, replay: finale.replay } }}
        >
          {/* One element either way, so opening and closing a page doesn't remount Next's router below. */}
          <div className={overPage ? 'absolute inset-0 z-40 overflow-y-auto bg-gunmetal' : 'hidden'}>{children}</div>
        </CampaignRoomProvider>

        {/* Intel reports, and under them any award ceremony playing. */}
        <div
          className={`pointer-events-none absolute left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2 ${
            overPage ? 'top-3' : 'top-18'
          }`}
        >
          {toast && (
            <div
              role="status"
              className="sheet-in rounded-[3px] bg-amber px-4 py-2 text-center font-stencil text-xl tracking-wide whitespace-nowrap text-gunmetal shadow-xl"
            >
              {toast}
            </div>
          )}
          {objectives && <AwardCeremonies model={model} hold={inLiveGame} onBusy={setCeremoniesBusy} />}
        </div>
      </div>
      {finale.showing && (
        <Finale key={finale.play} model={model} result={finale.showing} onLeave={finaleLeaving} onDone={finale.done} />
      )}

      {!isDesktop && (
        <nav
          className="grid shrink-0 border-t border-line bg-gunmetal pb-[env(safe-area-inset-bottom)]"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          aria-label="Sections"
          inert={behindFull}
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

const FULL_GAME = 'fixed inset-0 z-30';

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

/** A call to action in the header: something waiting on the player. */
interface HeaderAction {
  kind: ActionKind;
  label: string;
  title: string;
}

/**
 * The left column folded into a strip along the room's edge: a button per section, each opening its
 * section over the map (or closing it), with the same counts as the column's tabs.
 */
function CampaignRail({
  sides,
  open,
  onPick,
  buttonRef,
  inert,
}: {
  sides: SegmentTab<Side>[];
  /** The section open over the map, if any. */
  open: Side | null;
  onPick(side: Side): void;
  buttonRef(side: Side, el: HTMLButtonElement | null): void;
  inert: boolean;
}) {
  return (
    <nav
      aria-label="Campaign"
      inert={inert}
      className="relative z-30 flex shrink-0 flex-col border-r border-line bg-gunmetal pb-[env(safe-area-inset-bottom)]"
      style={{ width: RAIL_WIDTH }}
    >
      {sides.map((s) => {
        const expanded = open === s.id;
        return (
          <button
            key={s.id}
            ref={(el) => buttonRef(s.id, el)}
            type="button"
            aria-expanded={expanded}
            aria-controls={CAMPAIGN_PANEL_ID}
            onClick={() => onPick(s.id)}
            className={`relative flex min-h-16 flex-col items-center justify-center gap-1 border-b border-line px-1 text-[0.66rem] font-bold tracking-[0.06em] uppercase ${
              expanded ? 'bg-panel text-paper' : 'text-faint hover:text-muted'
            }`}
          >
            {expanded && <span className="absolute inset-y-2 right-0 w-0.5 bg-amber" aria-hidden="true" />}
            <span className="max-w-full truncate">{s.label}</span>
            {s.badge ? (
              <span
                className={`min-w-5 rounded-full px-1.5 text-center text-[0.7rem] leading-5 tracking-normal tabular-nums ${
                  s.alert ? 'bg-amber text-gunmetal' : 'bg-raised text-paper'
                }`}
              >
                {s.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function CampaignHeader({
  model,
  connected,
  actions,
  onAct,
  back,
  rules,
  results,
}: {
  model: CampaignModel;
  connected: boolean;
  /**
   * What's waiting on the player, most pressing first: the first is always shown, the rest from
   * tablet width up, so a turn to declare or an answer due isn't hidden behind a move to make.
   */
  actions: HeaderAction[];
  /** Takes the player to whatever the call to action names. */
  onAct(kind: ActionKind): void;
  /** Where the arrow leads: all campaigns, or back to the map from a page over it. */
  back: { href: string; label: string };
  /** The rules page, always a tap away; `open` while it's showing. */
  rules: { href: string; open: boolean };
  /** A finished campaign's results page; `open` while it's showing. */
  results: { href: string; open: boolean } | null;
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
      `Round ${campaign.round}${victory?.lastRound ? ` of ${victory.lastRound}` : ''} · ${model.tokens} war ${
        model.tokens === 1 ? 'token' : 'tokens'
      }` + (victory ? ` · ${myPoints} of ${victory.pointsToWin} VP` : ''),
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
        <span className="shrink-0 text-sm font-bold tracking-wider whitespace-nowrap text-[#ef7b72] uppercase">
          {wars} {wars === 1 ? 'war' : 'wars'} ⚑
        </span>
      )}
      {/* Pressing one goes there. A bot standing in for the player answers and moves for them. */}
      {actions.map((action, i) => (
        <button
          key={action.kind}
          type="button"
          onClick={() => onAct(action.kind)}
          title={action.title}
          className={`group min-h-11 shrink-0 items-center ${i === 0 ? 'flex' : 'hidden md:flex'}`}
        >
          <span
            className={`rounded-[3px] border-2 border-amber px-2 py-0.5 text-sm font-bold tracking-wider whitespace-nowrap uppercase ${
              i === 0
                ? 'bg-amber text-gunmetal group-hover:border-[#efb940] group-hover:bg-[#efb940]'
                : 'text-amber group-hover:bg-amber/15'
            }`}
          >
            {action.label}
          </span>
        </button>
      ))}
      {results && !results.open && (
        <Link
          href={results.href}
          title="The final standings, honors and statistics"
          className="group flex min-h-11 shrink-0 items-center"
        >
          <span className="rounded-[3px] bg-amber px-2 py-1 text-sm font-bold tracking-wider whitespace-nowrap text-gunmetal uppercase group-hover:bg-[#efb940]">
            Results
          </span>
        </Link>
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
  const resultsHref = useResultsHref(campaign.id);
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
          {campaign.status === 'finished' && campaign.victory?.result ? (
            <Link href={resultsHref} className="btn btn-ghost btn-sm shrink-0">
              Results
            </Link>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => onOpen(target)}>
              {label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
