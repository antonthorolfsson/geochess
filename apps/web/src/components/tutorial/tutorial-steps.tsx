'use client';

import {
  MAX_VALUE,
  TARGET_REJECTION_MESSAGES,
  checkTarget,
  declarationFloor,
  missionRules,
  missionTargets,
  valueOf,
  type TerritoryId,
} from '@empire/rules';
import Link from 'next/link';
import { useMemo, type ReactNode, type RefObject } from 'react';
import { totalValue, type CampaignModel } from '@/lib/campaign';
import {
  NUMBERED_STEPS,
  TUTORIAL_CLAIM_ROUND,
  TUTORIAL_DEFENDER,
  TUTORIAL_MISSION,
  TUTORIAL_PLAYER,
  TUTORIAL_TARGET,
  canGoOn,
  missionProgress,
  outcomeTransfers,
  ownersAfter,
  type StakeDraft,
  type TutorialAction,
  type TutorialState,
} from '@/lib/tutorial';
import { EmpireSummary } from '../campaign/empire-panel';
import { PlayerName } from '../campaign/player-name';
import { StakeBuilder, stakeProblem, type StakeOptions } from '../campaign/stake-builder';
import { EmpireSwatch } from '../hatch';
import { Notice, ValueBadge } from '../ui';
import { MissionCard, ProgressParts } from '../victory/mission-card';

/**
 * What the map shows: the campaign as it stands, as it would be if the battle went either way, or
 * (on the result step) as it was before the battle.
 */
export type MapView = 'now' | 'win' | 'lose' | 'before';

export interface StepProps {
  model: CampaignModel;
  state: TutorialState;
  dispatch(action: TutorialAction): void;
  /** Each step's heading, which takes focus when the step opens. */
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Selects a country from a list or by name, and shows it on the map. */
  pick(id: TerritoryId): void;
  mapView: MapView;
  setMapView(view: MapView): void;
  /** Whether the visitor is signed in; null until known. */
  signedIn: boolean | null;
  /** Back to the beginning, without asking. */
  onReset(): void;
}

const TEXT_LINK = 'font-semibold text-paper underline decoration-line-strong underline-offset-4 hover:decoration-paper';

const nameOf = (model: CampaignModel, id: TerritoryId) => model.idx.byId.get(id)?.name ?? id;
const memberOf = (model: CampaignModel, userId: string) => model.membersById.get(userId)!;

/** "France and Andorra"; "Austria, Croatia and France". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** A step: its heading (focused when it opens), what it says, and its buttons along the bottom. */
function Step({
  kicker,
  title,
  headingRef,
  children,
  footer,
}: {
  kicker: string;
  title: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-4 p-4">
        <header>
          <p className="label text-amber">{kicker}</p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="mt-1 font-stencil text-[1.7rem] leading-tight tracking-wide text-balance outline-none"
          >
            {title}
          </h2>
        </header>
        {children}
      </div>
      {footer && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-line bg-panel px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      )}
    </div>
  );
}

const kicker = (state: TutorialState) => {
  const at = NUMBERED_STEPS.findIndex((s) => s.step === state.step);
  return `Step ${at + 1} of ${NUMBERED_STEPS.length}`;
};

/** What the player is asked to do now, and whether it's done. */
function Task({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-[3px] border px-3 py-2.5 ${
        done ? 'border-paper/40 bg-paper/5' : 'border-amber/70 bg-amber/10'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-[2px] border text-xs font-bold ${
          done ? 'border-amber bg-amber text-gunmetal' : 'border-amber'
        }`}
      >
        {done ? '✓' : ''}
      </span>
      <p className="min-w-0 flex-1 leading-snug">
        <span className="sr-only">{done ? 'Done: ' : 'To do: '}</span>
        {children}
      </p>
    </div>
  );
}

/** A country picked on the map: its value, who holds it, and what that means for this step. */
function CountryCard({ model, id, children }: { model: CampaignModel; id: TerritoryId; children: ReactNode }) {
  const t = model.idx.byId.get(id);
  if (!t) return null;
  const owner = model.owners.get(id);
  return (
    <section aria-label={t.name} className="space-y-2 rounded-[3px] border border-line-strong bg-gunmetal/40 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="label">{t.subregion}</div>
          <h3 className="text-xl leading-tight font-bold">{t.name}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-center">
          <span className="label">Value</span>
          <ValueBadge value={t.value} className="h-8 min-w-8 text-lg" />
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <span className="label shrink-0">Held by</span>
        {owner && <PlayerName member={memberOf(model, owner)} you={owner === TUTORIAL_PLAYER} size="sm" />}
      </div>
      <div className="text-[0.95rem] leading-snug">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export function IntroStep({ model, dispatch, headingRef }: StepProps) {
  const me = memberOf(model, TUTORIAL_PLAYER);
  const steps = [
    'Look over your empire and your mission.',
    'Choose a country to attack.',
    'Set your stake: what you win, and what you could lose.',
    'Win the battle over the board, or skip it.',
    'Watch the map and your mission change.',
  ];
  return (
    <Step
      kicker="Guest tutorial"
      title="Fight one war"
      headingRef={headingRef}
      footer={
        <button type="button" className="btn btn-amber flex-1 sm:flex-none" onClick={() => dispatch({ type: 'start' })}>
          Start the tutorial
        </button>
      }
    >
      <p className="text-lg leading-relaxed text-pretty">
        Geo Chess in five steps, on a sample campaign: four empires sharing the real world map, in round{' '}
        {model.campaign.round}. You command <PlayerName member={me} size="sm" />.
      </p>
      <ol className="space-y-2">
        {steps.map((text, i) => (
          <li key={NUMBERED_STEPS[i]!.step} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-[3px] border border-amber/70 text-sm font-bold text-amber tabular-nums"
            >
              {i + 1}
            </span>
            <span className="pt-0.5 leading-snug">
              <span className="sr-only">Step {i + 1}: </span>
              {text}
            </span>
          </li>
        ))}
      </ol>
      <Notice tone="amber">
        <strong>Sample data, not a real game.</strong> Nothing you do here is saved to an account or seen by anyone
        else. This browser tab keeps your place until you close it.
      </Notice>
      <p className="text-[0.95rem] leading-relaxed text-muted">
        Everything works by touch, mouse or keyboard: countries can also be picked from lists or found by name, and
        chess moves typed.
      </p>
    </Step>
  );
}

export function EmpireStep({ model, state, dispatch, headingRef, pick }: StepProps) {
  const me = memberOf(model, TUTORIAL_PLAYER);
  const ids = model.holdingsByUser.get(TUTORIAL_PLAYER) ?? [];
  const progress = useMemo(() => missionProgress(model.idx, model.owners), [model]);
  const positions = missionTargets(TUTORIAL_MISSION.spec);
  const toWin = missionRules(model.campaign.rules.victory.version).points.toWin;
  const selected = state.selected;
  const owner = selected ? model.owners.get(selected) : undefined;
  return (
    <Step
      kicker={kicker(state)}
      title="Your empire"
      headingRef={headingRef}
      footer={
        <>
          <button
            type="button"
            className="btn btn-primary flex-1 sm:flex-none"
            disabled={!canGoOn(state, model.board)}
            onClick={() => dispatch({ type: 'next' })}
          >
            Next: choose a target
          </button>
          {!state.inspected && <span className="text-sm text-muted">Select one of your countries first.</span>}
        </>
      }
    >
      <p className="leading-relaxed text-pretty">
        You are <PlayerName member={me} size="sm" />: the countries hatched in your color are yours, {ids.length} of
        them, worth {totalValue(model.idx, ids)} in all. Every country is worth 1 to {MAX_VALUE}, from its economy,
        population and area. The map shows each value beside the name.
      </p>
      <Task done={state.inspected}>
        Select one of your countries: tap it on the map, or choose it from your holdings below.
      </Task>
      {selected && (
        <CountryCard model={model} id={selected}>
          {owner === TUTORIAL_PLAYER ? (
            <p>
              Yours.{' '}
              {positions.includes(selected)
                ? 'It’s one of your mission’s positions, so keep it safe.'
                : 'Any of your countries can be staked in a war, and lost in one.'}
            </p>
          ) : (
            <p>
              {owner ? `${memberOf(model, owner).name} holds this one.` : 'Nobody holds this one.'} Yours are the
              countries hatched like your swatch above.
            </p>
          )}
        </CountryCard>
      )}
      <section aria-labelledby="tutorial-mission" className="space-y-2">
        <h3 id="tutorial-mission" className="label">
          Your mission
        </h3>
        <p className="text-[0.95rem] leading-relaxed text-pretty text-muted">
          Missions score victory points, and the first to {toWin} wins. This one is public: its positions are outlined
          in white on the map. You hold two; a third, won in a war, completes it.
        </p>
        <MissionCard
          model={model}
          mission={TUTORIAL_MISSION}
          onSelectCountry={pick}
          held={new Set(progress.evidence.territories)}
        >
          <ProgressParts parts={progress.parts} label="Progress" />
        </MissionCard>
      </section>
      <section aria-label="Your empire’s figures">
        <EmpireSummary model={model} onSelect={pick} />
      </section>
    </Step>
  );
}

export function TargetStep({ model, state, dispatch, headingRef, pick }: StepProps) {
  const target = model.idx.byId.get(TUTORIAL_TARGET)!;
  const defender = memberOf(model, TUTORIAL_DEFENDER);
  const borders = model.idx
    .neighbors(TUTORIAL_TARGET)
    .filter((id) => model.owners.get(id) === TUTORIAL_PLAYER)
    .map((id) => nameOf(model, id))
    .sort();
  const selected = state.selected;
  return (
    <Step
      kicker={kicker(state)}
      title="Choose a target"
      headingRef={headingRef}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'back' })}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1 sm:flex-none"
            disabled={!canGoOn(state, model.board)}
            onClick={() => dispatch({ type: 'next' })}
          >
            Next: the stake
          </button>
        </>
      }
    >
      <p className="leading-relaxed text-pretty">
        Each round, players take turns to declare war, and each declaration costs a war token. It’s your turn, and you
        have {model.tokens}. You can attack any country that borders your empire, by land or by sea lane: the{' '}
        {model.targets.size} outlined in amber.
      </p>
      <p className="leading-relaxed text-pretty">
        Your mission needs a third position, and {target.name} is one. {defender.name} holds it, and it borders{' '}
        {joinNames(borders)}, all yours.
      </p>
      <Task done={selected === TUTORIAL_TARGET}>
        Select {target.name}: tap it on the map, or find it by name.{' '}
        {selected !== TUTORIAL_TARGET && (
          <button type="button" className={TEXT_LINK} onClick={() => pick(TUTORIAL_TARGET)}>
            Find {target.name}
          </button>
        )}
      </Task>
      {selected && (
        <CountryCard model={model} id={selected}>
          <TargetVerdict model={model} id={selected} onPickTarget={() => pick(TUTORIAL_TARGET)} />
        </CountryCard>
      )}
      {!selected && (
        <p className="text-[0.95rem] text-muted">
          Select any country to see whether you could attack it, and if not, why not.
        </p>
      )}
    </Step>
  );
}

/** Whether a war could be declared on the country, by the war rules. */
function TargetVerdict({ model, id, onPickTarget }: { model: CampaignModel; id: TerritoryId; onPickTarget(): void }) {
  const rejection = checkTarget(model.board, TUTORIAL_PLAYER, id);
  const name = nameOf(model, id);
  if (rejection) return <p>{TARGET_REJECTION_MESSAGES[rejection]}</p>;
  if (id === TUTORIAL_TARGET)
    return (
      <p>
        <strong className="text-amber">You can declare war on {name}.</strong> Next, you choose what to risk for it.
      </p>
    );
  return (
    <p>
      You could declare war on {name} too. For this tutorial, attack {nameOf(model, TUTORIAL_TARGET)}: your mission
      needs it.{' '}
      <button type="button" className={TEXT_LINK} onClick={onPickTarget}>
        Select {nameOf(model, TUTORIAL_TARGET)}
      </button>
    </p>
  );
}

export function StakeStep({ model, state, dispatch, headingRef, mapView, setMapView }: StepProps) {
  const target = model.idx.byId.get(TUTORIAL_TARGET)!;
  const defender = memberOf(model, TUTORIAL_DEFENDER);
  const me = memberOf(model, TUTORIAL_PLAYER);
  const { war } = model.campaign.rules;
  const opts: StakeOptions = useMemo(
    () => ({ minValue: declarationFloor(model.board, TUTORIAL_TARGET) }),
    [model.board],
  );
  const draft = state.stake;
  const won = useMemo(
    () =>
      draft ? missionProgress(model.idx, ownersAfter(model.owners, outcomeTransfers(draft.stake, 'attacker'))) : null,
    [model, draft],
  );
  if (!draft) return null;
  const problem = stakeProblem(model, TUTORIAL_TARGET, draft, opts);
  const stakeNames = joinNames(draft.stake.map((id) => nameOf(model, id)));
  const stakeValue = valueOf(model.idx, draft.stake);
  const outcomes: { view: MapView | null; title: string; color: number | null; text: string }[] = [
    {
      view: 'win',
      title: 'If you win',
      color: me.color,
      text: `You take ${target.name}, worth ${target.value}.${won?.complete ? ' Your mission is complete: three positions, one of them won in a war.' : ''}`,
    },
    {
      view: 'lose',
      title: `If ${defender.name} wins`,
      color: defender.color,
      text: `${defender.name} takes your whole stake: ${stakeNames}, worth ${stakeValue}.`,
    },
    {
      view: null,
      title: 'If it’s a draw',
      color: null,
      text:
        war.draws === 'armageddon'
          ? 'One more game, an Armageddon, decides it.'
          : `${defender.name} holds: nothing changes hands.`,
    },
  ];
  return (
    <Step
      kicker={kicker(state)}
      title="What’s at stake"
      headingRef={headingRef}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'back' })}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-war flex-1 sm:flex-none"
            disabled={problem !== null}
            onClick={() => dispatch({ type: 'declare' })}
          >
            Declare war
          </button>
          <span className="text-sm text-muted">Costs your war token.</span>
        </>
      }
    >
      <p className="leading-relaxed text-pretty">
        A war risks your countries too. Your stake is the country you attack from, plus any of yours connected to it,
        worth at least {war.stakeFloorPct}% of the target, rounded up. {target.name} is worth {target.value}, so your
        stake must be worth at least {opts.minValue}.
      </p>
      <section aria-labelledby="tutorial-outcomes" className="space-y-2">
        <h3 id="tutorial-outcomes" className="label">
          How the war can end
        </h3>
        <ul className="space-y-2">
          {outcomes.map((o) => (
            <li key={o.title} className="flex items-start gap-3 rounded-[3px] border border-line p-3">
              {o.color === null ? (
                <span
                  aria-hidden="true"
                  className="mt-0.5 size-[18px] shrink-0 rounded-[2.5px] border border-line-strong"
                />
              ) : (
                <EmpireSwatch color={o.color} size={18} className="mt-0.5 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <h4 className="font-bold">{o.title}</h4>
                <p className="text-[0.95rem] leading-snug">{o.text}</p>
              </div>
              {o.view && (
                <button
                  type="button"
                  aria-pressed={mapView === o.view}
                  aria-label={`Show on the map: ${o.title.toLowerCase()}`}
                  className={`btn btn-sm shrink-0 ${mapView === o.view ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setMapView(mapView === o.view ? 'now' : o.view!)}
                >
                  {mapView === o.view ? 'Shown' : 'Show'}
                </button>
              )}
            </li>
          ))}
        </ul>
        {mapView !== 'now' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMapView('now')}>
            Show the map as it is
          </button>
        )}
      </section>
      <div className="space-y-4 rounded-[3px] border border-grease/60 p-3">
        <div>
          <div className="font-stencil text-xl tracking-wide text-[#ef7b72]">Declare war on {target.name}</div>
          <p className="text-sm text-muted">
            Stake at least {opts.minValue}: if {defender.name} wins the game, they take the stake. The cheapest stake is
            already in. You can attack from another country or add more, but you don’t need to.
          </p>
        </div>
        <StakeBuilder
          model={model}
          targetId={TUTORIAL_TARGET}
          opts={opts}
          draft={draft}
          onChange={(next: StakeDraft) => dispatch({ type: 'stake', draft: next })}
        />
      </div>
      <p className="text-[0.95rem] leading-relaxed text-pretty text-muted">
        {defender.name} could answer by raising the stakes or redirecting your attack to a country next to {target.name}
        . In this tutorial, {defender.name} accepts.{' '}
        <Link href="/rules#answers" className={TEXT_LINK}>
          How answers work
        </Link>
      </p>
    </Step>
  );
}

export function ResultStep({ model, state, dispatch, headingRef, pick, mapView, setMapView }: StepProps) {
  const me = memberOf(model, TUTORIAL_PLAYER);
  const defender = memberOf(model, TUTORIAL_DEFENDER);
  const target = model.idx.byId.get(TUTORIAL_TARGET)!;
  const stake = state.stake?.stake ?? [];
  const after = useMemo(() => ownersAfter(model.owners, outcomeTransfers(stake, 'attacker')), [model, stake]);
  const before = useMemo(() => missionProgress(model.idx, model.owners), [model]);
  const progress = useMemo(() => missionProgress(model.idx, after), [model, after]);
  const mine = (owners: ReadonlyMap<TerritoryId, string>, userId: string) =>
    [...owners].filter(([, owner]) => owner === userId).map(([id]) => id);
  const rows = [me, defender].map((m) => {
    const was = mine(model.owners, m.userId);
    const now = mine(after, m.userId);
    return {
      member: m,
      countries: [was.length, now.length],
      value: [totalValue(model.idx, was), totalValue(model.idx, now)],
    };
  });
  const points = TUTORIAL_MISSION.points;
  return (
    <Step
      kicker={kicker(state)}
      title={`${target.name} is yours`}
      headingRef={headingRef}
      footer={
        <button
          type="button"
          className="btn btn-primary flex-1 sm:flex-none"
          onClick={() => dispatch({ type: 'next' })}
        >
          Finish
        </button>
      }
    >
      <p className="leading-relaxed text-pretty">
        {state.skipped ? 'The winning line was played for you' : 'Checkmate'}: you won the war, so {target.name} changes
        hands. On the map it now carries your color, and with Germany and Spain, outlined in white, it holds three of
        your mission’s positions.
      </p>
      <div role="group" aria-label="The map" className="flex overflow-hidden rounded-[3px] border border-line-strong">
        {(
          [
            ['before', 'Before the battle'],
            ['win', 'After'],
          ] as const
        ).map(([view, label]) => (
          <button
            key={view}
            type="button"
            aria-pressed={mapView === view}
            onClick={() => setMapView(view)}
            className={`min-h-11 flex-1 px-3 text-sm font-bold tracking-wider uppercase ${
              mapView === view ? 'bg-paper text-gunmetal' : 'text-muted hover:bg-raised hover:text-paper'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <section aria-labelledby="tutorial-changes">
        <h3 id="tutorial-changes" className="label mb-2">
          What changed
        </h3>
        <ul className="divide-y divide-line rounded-[3px] border border-line">
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5">
            <span className="font-bold">{target.name}</span>
            <ValueBadge value={target.value} />
            <span className="flex-1" />
            <PlayerName member={defender} size="sm" showTitles={false} />
            <span aria-hidden="true" className="text-amber">
              →
            </span>
            <span className="sr-only">to</span>
            <PlayerName member={me} you size="sm" showTitles={false} />
          </li>
          {rows.map((r) => (
            <li
              key={r.member.userId}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5 text-[0.95rem]"
            >
              <span className="min-w-0 flex-1">
                <PlayerName member={r.member} you={r.member.userId === TUTORIAL_PLAYER} size="sm" showTitles={false} />
              </span>
              <span className="tabular-nums">
                {r.countries[0]} → <strong>{r.countries[1]}</strong> countries
              </span>
              <span className="tabular-nums">
                value {r.value[0]} → <strong>{r.value[1]}</strong>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="tutorial-mission-after" className="space-y-2">
        <h3 id="tutorial-mission-after" className="label">
          Your mission
        </h3>
        <MissionCard
          model={model}
          mission={TUTORIAL_MISSION}
          onSelectCountry={pick}
          held={new Set(progress.evidence.territories)}
          stamp={progress.complete ? <span className="stamp stamp-sm self-center">Complete</span> : undefined}
        >
          <ProgressParts parts={progress.parts} label="Progress" />
          <p className="text-sm text-muted">
            Before the war: {before.parts.map((p) => `${p.label.toLowerCase()} ${p.have} of ${p.need}`).join(', ')}.
          </p>
        </MissionCard>
        <p className="text-[0.95rem] leading-relaxed text-pretty">
          Complete, so you’ve staked a claim. It scores {points} victory points in round {TUTORIAL_CLAIM_ROUND} if the
          positions are still yours then: your rivals get all of round {TUTORIAL_CLAIM_ROUND - 1}’s turns to take one
          back.{' '}
          <Link href="/rules#claims" className={TEXT_LINK}>
            How claims work
          </Link>
        </p>
      </section>
      <p className="text-[0.95rem] leading-relaxed text-pretty text-muted">
        Had {defender.name} won, {joinNames(stake.map((id) => nameOf(model, id)))} would have gone to {defender.name}{' '}
        instead, and your mission would still be waiting.
      </p>
    </Step>
  );
}

export function FinishStep({ model, headingRef, signedIn, onReset }: StepProps) {
  const toWin = missionRules(model.campaign.rules.victory.version).points.toWin;
  return (
    <Step kicker="Tutorial complete" title="Ready to draw the borders?" headingRef={headingRef}>
      <p className="text-lg leading-relaxed text-pretty">
        That was one war. A campaign is many: you and your friends draft the whole map, then every round brings war
        tokens, declarations, answers and games, until someone reaches {toWin} victory points.
      </p>
      <div className="space-y-2">
        <Link href={signedIn ? '/new' : '/login?next=/new'} className="btn btn-amber w-full">
          Start your own campaign
        </Link>
        <p className="text-[0.95rem] text-muted">
          {signedIn
            ? 'Choose its settings, then send the invite link to your group.'
            : 'Sign in or sign up first, then choose its settings and send the invite link to your group.'}{' '}
          Nothing from the tutorial carries over: your campaign starts with its own draft.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button type="button" className="btn btn-ghost" onClick={onReset}>
          Play the tutorial again
        </button>
        <Link href="/rules" className="btn btn-ghost">
          Read the rules
        </Link>
        <Link href="/" className="btn btn-ghost">
          Back to the home page
        </Link>
      </div>
    </Step>
  );
}
