'use client';

import { missionTargets, type TerritoryId } from '@empire/rules';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CampaignModel } from '@/lib/campaign';
import { useMapData, useMe, type MapData } from '@/lib/queries';
import {
  INITIAL_TUTORIAL,
  NUMBERED_STEPS,
  TUTORIAL_DATASET,
  TUTORIAL_DEFENDER,
  TUTORIAL_MISSION,
  TUTORIAL_PLAYER,
  TUTORIAL_STORAGE_KEY,
  TUTORIAL_TARGET,
  colorsOf,
  missionProgress,
  outcomeTransfers,
  ownersAfter,
  restoreTutorial,
  tutorialModel,
  tutorialReducer,
  type TutorialAction,
  type TutorialState,
  type TutorialStep,
} from '@/lib/tutorial';
import { Emblem } from '../app-header';
import { CountrySearch } from '../campaign/country-search';
import { WorldMap, type MapWar, type MapWarFocus, type MissionOverlayProps } from '../map/world-map';
import { Notice, Spinner } from '../ui';
import { BattleStep } from './tutorial-battle';
import {
  EmpireStep,
  FinishStep,
  IntroStep,
  ResultStep,
  StakeStep,
  TargetStep,
  type MapView,
  type StepProps,
} from './tutorial-steps';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The guest tutorial: the landing page's sample campaign, played by the visitor from Ada's turn to
 * declare war to the map changing hands. Nothing leaves the browser: the campaign is built locally,
 * and the place reached is kept in this tab's session storage so a reload picks it up again.
 */
export function TutorialScreen() {
  const map = useMapData(TUTORIAL_DATASET);
  const me = useMe();
  if (!map.data) {
    return (
      <div className="flex min-h-dvh flex-col">
        <TutorialBar state={null} onReset={() => {}} />
        <div className="flex flex-1 items-center justify-center p-4">
          {map.error ? (
            <Notice tone="error">The tutorial’s map didn’t load.</Notice>
          ) : (
            <Spinner label="Loading the map" />
          )}
        </div>
      </div>
    );
  }
  return <Tutorial data={map.data} signedIn={me.data ? me.data.user !== null : null} />;
}

/** The tutorial's state, checked by the rules, and kept in this tab's session storage. */
function useTutorialState(model: CampaignModel) {
  const { board } = model;
  // Unknown until the stored place is read, after the first render (the page is prerendered).
  const [state, setState] = useState<TutorialState | null>(null);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(TUTORIAL_STORAGE_KEY);
    } catch {
      // Storage blocked: the tutorial still works, it just starts afresh on a reload.
    }
    setState(restoreTutorial(stored, board));
  }, [board]);
  useEffect(() => {
    if (!state) return;
    try {
      window.sessionStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // As above.
    }
  }, [state]);
  const dispatch = useCallback(
    (action: TutorialAction) => setState((s) => tutorialReducer(s ?? INITIAL_TUTORIAL, action, board)),
    [board],
  );
  return [state, dispatch] as const;
}

function Tutorial({ data, signedIn }: { data: MapData; signedIn: boolean | null }) {
  const model = useMemo(() => tutorialModel(data.idx), [data.idx]);
  const [state, dispatch] = useTutorialState(model);
  const [mapView, setMapView] = useState<MapView>('now');
  const [focus, setFocus] = useState<{ id: TerritoryId; nonce: number } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const step = state?.step ?? null;
  // Each step starts with the map as things stand (the result step plays its own change), its top
  // in view, and focus on its heading, so the keyboard and screen readers carry on from there.
  const shownStep = useRef<TutorialStep | null>(null);
  useEffect(() => {
    if (step === null) return;
    const first = shownStep.current === null;
    shownStep.current = step;
    setMapView(
      step === 'result' && !reducedMotion() ? 'before' : step === 'result' || step === 'finish' ? 'win' : 'now',
    );
    if (first) return;
    scrollRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);
  // The change of hands, played once: the map before the war, then after it.
  useEffect(() => {
    if (step !== 'result' || reducedMotion()) return;
    const timer = setTimeout(() => setMapView((v) => (v === 'before' ? 'win' : v)), 1400);
    return () => clearTimeout(timer);
  }, [step]);

  const reset = useCallback(() => {
    if (state && state.step !== 'intro' && !window.confirm('Start the tutorial again from the beginning?')) return;
    dispatch({ type: 'reset' });
  }, [state, dispatch]);

  if (!state) {
    return (
      <div className="flex min-h-dvh flex-col">
        <TutorialBar state={null} onReset={reset} />
        <div className="flex flex-1 items-center justify-center p-4">
          <Spinner label="Loading the tutorial" />
        </div>
      </div>
    );
  }

  /** A country picked from a list or by name: shown on the map too. */
  const pick = (id: TerritoryId) => {
    dispatch({ type: 'select', id });
    setFocus((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }));
  };
  const props: StepProps = {
    model,
    state,
    dispatch,
    headingRef,
    pick,
    mapView,
    setMapView,
    signedIn,
    onReset: () => dispatch({ type: 'reset' }),
  };
  const battle = state.step === 'battle';

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TutorialBar state={state} onReset={reset} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          className={`relative min-h-0 shrink-0 basis-[40%] border-b border-line bg-sea lg:basis-auto lg:flex-1 lg:border-b-0 ${
            battle ? 'max-lg:hidden' : ''
          }`}
        >
          <TutorialMap
            topo={data.topo}
            model={model}
            state={state}
            mapView={mapView}
            focus={focus}
            pick={pick}
            dispatch={dispatch}
          />
        </div>
        <aside
          aria-label="Tutorial"
          className={`flex min-h-0 flex-1 flex-col bg-panel lg:flex-none lg:border-l lg:border-line ${
            battle ? 'lg:w-auto lg:max-w-[calc(100vw-20rem)]' : 'lg:w-[26rem] xl:w-[28rem]'
          }`}
        >
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <StepBody {...props} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function StepBody(props: StepProps) {
  switch (props.state.step) {
    case 'intro':
      return <IntroStep {...props} />;
    case 'empire':
      return <EmpireStep {...props} />;
    case 'target':
      return <TargetStep {...props} />;
    case 'stake':
      return <StakeStep {...props} />;
    case 'battle':
      return <BattleStep {...props} />;
    case 'result':
      return <ResultStep {...props} />;
    case 'finish':
      return <FinishStep {...props} />;
  }
}

/** The tutorial's own header: what this is, the steps and where you are in them, starting over and leaving. */
function TutorialBar({ state, onReset }: { state: TutorialState | null; onReset(): void }) {
  const at = state ? NUMBERED_STEPS.findIndex((s) => s.step === state.step) : -1;
  const done = state?.step === 'finish';
  return (
    <header className="shrink-0 border-b border-line bg-gunmetal pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Geo Chess home page">
          <Emblem />
        </Link>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="font-stencil text-lg tracking-[0.08em]">TUTORIAL</span>
          {/* Narrow phones have no room for it here: the map's caption and each step carry it instead. */}
          <span className="stamp stamp-sm max-[419px]:hidden" title="Sample data, not a real campaign">
            Sample
          </span>
        </div>
        <div className="flex-1" />
        {state && state.step !== 'intro' && (
          <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={onReset}>
            Start over
          </button>
        )}
        <Link href="/" className="btn btn-ghost btn-sm min-h-11">
          Exit
        </Link>
      </div>
      {state && state.step !== 'intro' && (
        <nav aria-label="Tutorial progress" className="px-3 pb-2 sm:px-4">
          <ol className="flex gap-1.5">
            {NUMBERED_STEPS.map((s, i) => {
              const current = i === at;
              const past = done || i < at;
              return (
                <li key={s.step} aria-current={current ? 'step' : undefined} className="min-w-0 flex-1">
                  <span
                    aria-hidden="true"
                    className={`block h-1 rounded-full ${current ? 'bg-amber' : past ? 'bg-paper/70' : 'bg-line-strong'}`}
                  />
                  <span
                    className={`mt-1 block truncate text-[0.7rem] font-bold tracking-[0.12em] uppercase max-sm:sr-only ${
                      current ? 'text-paper' : 'text-faint'
                    }`}
                  >
                    {i + 1}. {s.label}
                    {past && <span className="sr-only"> (done)</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          {/* Phones have no room for every label: the current step's goes on a line of its own. */}
          <p
            aria-hidden="true"
            className="mt-1 text-[0.7rem] font-bold tracking-[0.12em] text-paper uppercase sm:hidden"
          >
            {done ? 'All done' : `Step ${at + 1} of ${NUMBERED_STEPS.length} · ${NUMBERED_STEPS[at]?.label ?? ''}`}
          </p>
        </nav>
      )}
    </header>
  );
}

/**
 * The campaign map as each step needs it: your empire and mission, the countries you could attack,
 * the stake, the war, and what changes hands, all on the production map.
 */
function TutorialMap({
  topo,
  model,
  state,
  mapView,
  focus,
  pick,
  dispatch,
}: {
  topo: MapData['topo'];
  model: CampaignModel;
  state: TutorialState;
  mapView: MapView;
  focus: { id: TerritoryId; nonce: number } | null;
  pick(id: TerritoryId): void;
  dispatch(action: TutorialAction): void;
}) {
  const { step } = state;
  const stake = useMemo(() => state.stake?.stake ?? [], [state.stake]);
  const owners = useMemo(() => {
    if (mapView === 'win') return ownersAfter(model.owners, outcomeTransfers(stake, 'attacker'));
    if (mapView === 'lose') return ownersAfter(model.owners, outcomeTransfers(stake, 'defender'));
    return model.owners;
  }, [model, mapView, stake]);
  const colors = useMemo(() => colorsOf(model, owners), [model, owners]);

  // Where each step looks.
  const [fit, setFit] = useState<{ ids: readonly TerritoryId[]; nonce: number } | null>(null);
  useEffect(() => {
    setFit((f) => ({ ids: frameFor(model, step), nonce: (f?.nonce ?? 0) + 1 }));
  }, [model, step]);

  const changed = useMemo(() => {
    if (mapView === 'win') return new Set([TUTORIAL_TARGET]);
    if (mapView === 'lose') return new Set(stake);
    return null;
  }, [mapView, stake]);
  const highlighted = step === 'target' ? model.targets : changed;

  const mission: MissionOverlayProps | null = useMemo(() => {
    if (step !== 'empire' && step !== 'result' && step !== 'finish') return null;
    return {
      targets: missionTargets(TUTORIAL_MISSION.spec),
      held: missionProgress(model.idx, owners).evidence.territories,
      path: null,
    };
  }, [model.idx, owners, step]);

  const launchId = state.stake?.launchId ?? null;
  const fighting = step === 'battle' || (step === 'result' && mapView === 'before');
  const wars: MapWar[] = useMemo(
    () =>
      fighting && launchId
        ? [{ id: 'tutorial-war', from: launchId, to: TUTORIAL_TARGET, threat: false, mine: true }]
        : [],
    [fighting, launchId],
  );
  const war: MapWarFocus | null = useMemo(
    () => (fighting ? { id: 'tutorial-war', attacker: stake, defender: [TUTORIAL_TARGET] } : null),
    [fighting, stake],
  );
  const preview =
    step === 'stake' && mapView === 'now' && state.stake
      ? { launchId: state.stake.launchId, targetId: TUTORIAL_TARGET, stake: state.stake.stake }
      : null;
  const selectable = step === 'empire' || step === 'target';
  const onSelect = useCallback(
    (id: TerritoryId | null) => {
      if (selectable) dispatch({ type: 'select', id });
    },
    [selectable, dispatch],
  );
  const initialFrame = useMemo(() => frameFor(model, step), [model, step]);
  const search = step === 'target';

  return (
    <div className="absolute inset-0">
      <WorldMap
        topo={topo}
        dataset={model.idx.dataset}
        owners={colors}
        selectedId={selectable ? state.selected : null}
        highlighted={highlighted}
        showValues
        onSelect={onSelect}
        focus={focus}
        fit={fit}
        initialFrame={initialFrame}
        topInset={search ? 64 : 0}
        wars={wars}
        preview={preview}
        war={war}
        mission={mission}
      />
      {search && (
        <div className="absolute top-3 left-3 w-[min(18rem,calc(100%-5rem))]">
          <CountrySearch idx={model.idx} onPick={pick} />
        </div>
      )}
      <MapCaption model={model} step={step} mapView={mapView} stake={stake} />
    </div>
  );
}

/** What each step frames on the map. */
function frameFor(model: CampaignModel, step: TutorialStep): readonly TerritoryId[] {
  switch (step) {
    case 'intro':
    case 'empire':
      return model.holdingsByUser.get(TUTORIAL_PLAYER) ?? [];
    case 'target':
      // Close enough round Italy to tap it on a phone.
      return ['ITA', 'FRA', 'AUT', 'HRV', 'GRC', 'TUN'];
    case 'stake':
    case 'battle':
      return ['FRA', 'ITA', 'ESP', 'DEU', 'TUN', 'GRC'];
    case 'result':
      return ['ITA', 'FRA', 'AUT', 'TUN', 'GRC'];
    case 'finish':
      return missionTargets(TUTORIAL_MISSION.spec);
  }
}

/** The map's label: sample data, and what the map shows when it isn't the campaign as it stands. */
function MapCaption({
  model,
  step,
  mapView,
  stake,
}: {
  model: CampaignModel;
  step: TutorialStep;
  mapView: MapView;
  stake: readonly TerritoryId[];
}) {
  const name = (id: TerritoryId) => model.idx.byId.get(id)?.name ?? id;
  const me = model.membersById.get(TUTORIAL_PLAYER)!;
  const defender = model.membersById.get(TUTORIAL_DEFENDER)!;
  // Phones keep the map clear: the stamp says it's a sample, and words only come when the map shows a change.
  let text: ReactNode = <span className="max-sm:sr-only">Round {model.campaign.round} · sample campaign</span>;
  if (step === 'result' && mapView === 'before') text = 'Before the battle';
  else if ((step === 'result' || step === 'finish') && mapView === 'win')
    text = (
      <>
        {name(TUTORIAL_TARGET)}: {defender.name} <span aria-hidden="true">→</span>
        <span className="sr-only">to</span> {me.name}
      </>
    );
  else if (step === 'stake' && mapView === 'win') text = `If you win: ${name(TUTORIAL_TARGET)} is yours`;
  else if (step === 'stake' && mapView === 'lose')
    text = `If ${defender.name} wins: ${stake.map(name).join(' and ')} go to ${defender.name}`;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-3 rounded-[3px] bg-gunmetal/90 py-1.5 pr-3 pl-2.5"
    >
      <span className="stamp stamp-sm">Sample</span>
      <span className="truncate text-sm font-bold tracking-wider text-paper uppercase">{text}</span>
    </div>
  );
}
