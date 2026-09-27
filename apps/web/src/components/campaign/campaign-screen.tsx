'use client';

import type { CampaignStatus, TerritoryId } from '@empire/rules';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Topology } from 'topojson-specification';
import { ApiError, errorMessage } from '@/lib/api';
import { buildModel, type CampaignModel } from '@/lib/campaign';
import { useCampaign, useMapData, useMe } from '@/lib/queries';
import { useRealtime, useServerMessages } from '@/lib/realtime';
import { useIsDesktop } from '@/lib/use-media-query';
import { useMyGames } from '@/lib/use-my-games';
import { countryName, outcomeText } from '@/lib/wars';
import { GamePanel } from '../game/game-panel';
import { WorldMap, type MapWar } from '../map/world-map';
import { Notice, Spinner } from '../ui';
import { CountrySearch } from './country-search';
import { Dispatches, DraftPanel, DraftStatus, Standings } from './draft-panel';
import { EmpirePanel } from './empire-panel';
import { LobbyPanel } from './lobby-panel';
import { TerritoryPanel } from './territory-panel';
import { WarDetail, type StakePreview } from './war-detail';
import { WarsPanel } from './wars-panel';

type Tab = 'lobby' | 'map' | 'wars' | 'draft' | 'empire';

const AT_WAR: { id: Tab; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'wars', label: 'Wars' },
  { id: 'draft', label: 'Standings' },
  { id: 'empire', label: 'Empire' },
];

const TABS: Record<CampaignStatus, { id: Tab; label: string }[]> = {
  lobby: [
    { id: 'lobby', label: 'Lobby' },
    { id: 'map', label: 'Map' },
  ],
  draft: [
    { id: 'map', label: 'Map' },
    { id: 'draft', label: 'Draft' },
    { id: 'empire', label: 'Empire' },
  ],
  active: AT_WAR,
  finished: AT_WAR,
};

export function CampaignScreen({ id }: { id: string }) {
  const router = useRouter();
  const me = useMe();
  const campaign = useCampaign(id);
  const mapData = useMapData(campaign.data?.datasetVersion);
  const user = me.data?.user;

  useEffect(() => {
    if (me.data && !me.data.user) router.replace(`/login?next=${encodeURIComponent(`/c/${id}`)}`);
  }, [me.data, router, id]);

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
  return <CampaignRoom model={model} topo={mapData.data.topo} />;
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">{children}</div>;
}

/** Opens and closes panels through the query string (?war=, ?game=), so links and the back button work. */
function usePanelParams() {
  const searchParams = useSearchParams();
  const set = useCallback((key: 'war' | 'game', value: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(key, value);
    else params.delete(key);
    const query = params.toString();
    const url = query ? `?${query}` : window.location.pathname;
    if (value) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, []);
  return { warId: searchParams.get('war'), gameId: searchParams.get('game'), set };
}

function CampaignRoom({ model, topo }: { model: CampaignModel; topo: Topology }) {
  const { campaign } = model;
  const me = model.me.userId;
  const { connected } = useRealtime();
  const isDesktop = useIsDesktop();
  const tabs = TABS[campaign.status];
  const [tab, setTab] = useState<Tab>(tabs[0]!.id);
  const [selected, setSelected] = useState<TerritoryId | null>(null);
  const [focus, setFocus] = useState<{ id: TerritoryId; nonce: number } | null>(null);
  const [showValues, setShowValues] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [preview, setPreview] = useState<StakePreview | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const panels = usePanelParams();
  const openWar = panels.warId ? campaign.wars.find((w) => w.id === panels.warId) : undefined;
  const myGames = useMyGames(model);
  const myMoves = myGames.filter((g) => g.myMove).length;
  const answers = model.awaitingMe.length;

  // Jump to the natural first tab when the campaign moves on (e.g. the host starts the draft).
  const status = campaign.status;
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current !== status) setTab(TABS[status][0]!.id);
    lastStatus.current = status;
  }, [status]);

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
      }
    }
  });
  // Results arrive with a refetch, so the war's outcome is in the model by then.
  const lastResolved = useRef<string | null>(null);
  useEffect(() => {
    const latest = model.pastWars[0];
    if (!latest || latest.id === lastResolved.current) return;
    const fresh = lastResolved.current !== null;
    lastResolved.current = latest.id;
    if (fresh && (latest.attackerId === me || latest.defenderId === me)) setToast(outcomeText(model, latest));
  }, [model, me]);

  useEffect(() => {
    const flag = model.myTurn ? '(Your pick) ' : myMoves > 0 ? '(Your move) ' : answers > 0 ? '(Answer needed) ' : '';
    document.title = `${flag}${campaign.name} · Empire Chess`;
  }, [model.myTurn, myMoves, answers, campaign.name]);

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
  const flyTo = (id: TerritoryId) => {
    selectOnMap(id);
    setFocus({ id, nonce: Date.now() });
    setTab('map');
  };
  const showWar = (warId: string) => {
    setSelected(null);
    if (panels.gameId) panels.set('game', null);
    panels.set('war', warId);
    const war = campaign.wars.find((w) => w.id === warId);
    if (war && isDesktop) setFocus({ id: war.targetId, nonce: Date.now() });
  };
  const closeWar = () => panels.set('war', null);
  const closeGame = () => panels.set('game', null);

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
      <Dispatches model={model} onSelect={flyTo} onOpenWar={showWar} />
    </div>
  );
  const leftPanel =
    campaign.status === 'lobby' ? (
      <LobbyPanel model={model} onSelect={flyTo} />
    ) : atWar ? (
      warRoom
    ) : (
      <DraftPanel model={model} onSelect={flyTo} onOpenWar={showWar} />
    );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <CampaignHeader model={model} connected={connected} myMoves={myMoves} answers={answers} />

      <div className="relative flex min-h-0 flex-1">
        {isDesktop && (
          <aside className="w-[340px] shrink-0 overflow-y-auto border-r border-line" aria-label="Campaign">
            {leftPanel}
          </aside>
        )}

        <main className="relative min-w-0 flex-1">
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
          />

          <div className="pointer-events-none absolute top-3 right-[4.25rem] left-3 flex max-w-lg items-start gap-2">
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

          {toast && (
            <div
              role="status"
              className="sheet-in pointer-events-none absolute top-18 left-1/2 z-30 -translate-x-1/2 rounded-[3px] bg-amber px-4 py-2 text-center font-stencil text-xl tracking-wide whitespace-nowrap text-gunmetal shadow-xl"
            >
              {toast}
            </div>
          )}

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
            <div className="absolute inset-0 overflow-y-auto bg-gunmetal">
              {tab === 'lobby' && <LobbyPanel model={model} onSelect={flyTo} />}
              {tab === 'wars' && (warPanel ?? warRoom)}
              {tab === 'draft' && <DraftPanel model={model} onSelect={flyTo} onOpenWar={showWar} />}
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
          >
            {gamePanel || warPanel || territoryPanel || <EmpirePanel model={model} onSelect={flyTo} />}
          </aside>
        )}
      </div>

      {!isDesktop && (
        <nav
          className="grid shrink-0 border-t border-line bg-gunmetal pb-[env(safe-area-inset-bottom)]"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          aria-label="Sections"
        >
          {tabs.map((t) => {
            const alert = (t.id === 'draft' && model.myTurn) || (t.id === 'wars' && (answers > 0 || myMoves > 0));
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  if (panels.gameId) closeGame();
                }}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`relative min-h-14 text-sm font-bold tracking-[0.12em] uppercase ${
                  tab === t.id ? 'text-paper' : 'text-faint'
                }`}
              >
                {tab === t.id && <span className="absolute inset-x-6 top-0 h-0.5 bg-amber" aria-hidden="true" />}
                {t.label}
                {alert && tab !== t.id && (
                  <span className="absolute top-3 ml-1 size-2 rounded-full bg-amber" aria-label="needs you" />
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
}: {
  model: CampaignModel;
  connected: boolean;
  myMoves: number;
  answers: number;
}) {
  const { campaign } = model;
  const statusLine = {
    lobby: `Lobby · ${campaign.members.length} of ${campaign.rules.maxPlayers} players`,
    draft: campaign.draft ? `Draft · Round ${campaign.draft.round} of ${model.totalRounds}` : 'Draft',
    active: `Round ${campaign.round} · ${model.tokens} war ${model.tokens === 1 ? 'token' : 'tokens'}`,
    finished: 'Finished',
  }[campaign.status];
  const wars = model.activeWars.length;
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-line bg-gunmetal px-2 pt-[env(safe-area-inset-top)]">
      <Link
        href="/"
        aria-label="All campaigns"
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
      {(model.myTurn || myMoves > 0 || answers > 0) && (
        <span className="mr-1 rounded-[3px] bg-amber px-2 py-1 text-sm font-bold tracking-wider whitespace-nowrap text-gunmetal uppercase">
          {model.myTurn ? 'Your pick' : myMoves > 0 ? 'Your move' : 'Answer needed'}
        </span>
      )}
    </header>
  );
}

function MapFooter({ model, onOpen }: { model: CampaignModel; onOpen(tab: Tab): void }) {
  const { campaign } = model;
  const atWar = campaign.status === 'active' || campaign.status === 'finished';
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
          <button
            type="button"
            className="btn btn-ghost btn-sm shrink-0"
            onClick={() => onOpen(atWar ? 'wars' : 'draft')}
          >
            {atWar ? 'Wars' : 'Draft board'}
          </button>
        </div>
      )}
    </div>
  );
}
