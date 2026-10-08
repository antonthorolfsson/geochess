'use client';

import { TURN_WINDOW_TEXT, lastRoundOf, missionRules, type RoundReadiness, type WarView } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys } from '@/lib/queries';
import {
  finalRoundText,
  nextRoundQuestion,
  pauseQuestion,
  readinessOf,
  readinessText,
  resumeQuestion,
  roundClock,
  roundEndText,
  type ReadinessItem,
} from '@/lib/readiness';
import { perMoveText } from '@/lib/rules-text';
import { useMyGames } from '@/lib/use-my-games';
import { useNow } from '@/lib/use-now';
import { countryName, playerName, timeLeft, warStatusText } from '@/lib/wars';
import { EmpireSwatch } from '../hatch';
import { NotificationsToggle } from '../notifications';
import { Notice } from '../ui';
import { WarStakesNote } from './war-outcomes';

/** Round, tokens and every war: what needs an answer, games to play, and the rest. */
export function WarsPanel({
  model,
  onOpenWar,
  onOpenGame,
}: {
  model: CampaignModel;
  onOpenWar(warId: string): void;
  onOpenGame(gameId: string): void;
}) {
  // Declarations and counters to answer, and peace terms offered to me.
  const waiting = model.activeWars.filter(
    (w) => model.awaitingMe.includes(w) || model.peaceToMe.some(({ war }) => war.id === w.id),
  );
  const others = model.activeWars.filter((w) => !waiting.includes(w));
  return (
    <div className="space-y-6">
      <RoundStatus model={model} />
      <Declaring model={model} />
      {waiting.length > 0 && (
        <section>
          <h2 className="label mb-2 text-amber">Waiting for your answer</h2>
          <WarList model={model} wars={waiting} onOpenWar={onOpenWar} highlight />
        </section>
      )}
      <YourGames model={model} onOpenGame={onOpenGame} />
      <section>
        <h2 className="label mb-2">Wars underway</h2>
        {others.length > 0 ? (
          <WarList model={model} wars={others} onOpenWar={onOpenWar} />
        ) : (
          <p className="text-[0.95rem] text-muted">
            {model.targets.size > 0 && !model.turnRejection
              ? `No wars underway. ${model.targets.size} enemy ${model.targets.size === 1 ? 'country borders' : 'countries border'} your empire: pick one on the map to declare war.`
              : 'No wars underway.'}
          </p>
        )}
      </section>
      {model.pastWars.length > 0 && (
        <section>
          <h2 className="label mb-2">Recent wars</h2>
          <WarList model={model} wars={model.pastWars.slice(0, 12)} onOpenWar={onOpenWar} />
        </section>
      )}
    </div>
  );
}

function RoundStatus({ model }: { model: CampaignModel }) {
  const { campaign, isHost } = model;
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) });
  // Naming the round to end, so a press that crosses a scheduled start doesn't end the new one too.
  const next = useMutation({ mutationFn: () => api.nextRound(campaign.id, campaign.round), onSettled: refresh });
  const pause = useMutation({ mutationFn: () => api.pauseSchedule(campaign.id, campaign.round), onSettled: refresh });
  const resume = useMutation({
    mutationFn: () => api.resumeSchedule(campaign.id, campaign.round),
    onSettled: refresh,
  });
  const active = campaign.status === 'active';
  const now = useNow(1000, active);
  // Who can still take a turn is worked out over the whole map, so only as the campaign changes, or
  // each minute for a claim's holding time; the countdowns tick every second.
  const minute = Math.floor(now / 60_000);
  const readiness = useMemo(() => readinessOf(model, minute * 60_000), [model, minute]);
  const { rules } = campaign;
  const pace =
    rules.war.pace === 'live'
      ? `Live ${rules.war.liveClock}`
      : `Correspondence · ${perMoveText(rules.war.hoursPerMove)}`;
  const cap = Math.max(rules.war.tokenCap, model.tokens);
  const last = lastRoundOf(rules);
  const final = last !== null && campaign.round >= last;
  const clock = roundClock(model);
  const busy = next.isPending || pause.isPending || resume.isPending;
  const error = next.error ?? pause.error ?? resume.error;
  return (
    <section className="space-y-3">
      <div>
        <div className="label">
          Round {campaign.round}
          {last !== null && ` of ${last}`}
        </div>
        <p className="text-sm text-muted">{pace}</p>
        {active && <p className="text-sm">{roundEndText(model, now)}</p>}
        {final && active && (
          <p className="text-sm text-amber">
            {finalRoundText(model, missionRules(rules.victory.version).points.toWin)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="label">War tokens</span>
        <span className="flex gap-1" aria-label={`${model.tokens} war ${model.tokens === 1 ? 'token' : 'tokens'}`}>
          {Array.from({ length: cap }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`size-3.5 rounded-full border ${i < model.tokens ? 'border-grease bg-grease' : 'border-line-strong'}`}
            />
          ))}
        </span>
        <span className="text-sm text-muted tabular-nums">{model.tokens}</span>
      </div>
      {active && <Readiness model={model} readiness={readiness} now={now} />}
      {isHost && active && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                if (confirm(nextRoundQuestion(model, readiness))) next.mutate();
              }}
            >
              {final ? 'End the campaign' : 'Next round'}
            </button>
            {clock.kind === 'scheduled' && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => {
                  if (confirm(pauseQuestion(model, now))) pause.mutate();
                }}
              >
                Pause schedule
              </button>
            )}
            {clock.kind === 'paused' && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => {
                  if (confirm(resumeQuestion(model, now))) resume.mutate();
                }}
              >
                Resume schedule
              </button>
            )}
          </div>
          {error && <Notice tone="error">{errorMessage(error)}</Notice>}
        </div>
      )}
      <NotificationsToggle />
    </section>
  );
}

/**
 * What the round is waiting for (turns still to be taken; in the last round, wars and claims its
 * end cuts short), the wars that carry on into the next, claims waiting to score, and what the
 * round's end does to turns not taken.
 */
function Readiness({ model, readiness, now }: { model: CampaignModel; readiness: RoundReadiness; now: number }) {
  const text = readinessText(model, readiness, now);
  return (
    <section aria-label={text.heading} className="space-y-1.5 rounded-[3px] border border-line px-3 py-2">
      <h2 className="label">{text.heading}</h2>
      <p className={`text-[0.95rem] ${readiness.ready ? 'text-muted' : 'text-amber'}`}>{text.summary}</p>
      {text.checklist.length > 0 && <ReadinessList items={text.checklist} />}
      {text.boundary && <p className="text-sm text-muted">{text.boundary}</p>}
      {text.carries && <p className="text-sm text-muted">{text.carries}</p>}
      {text.claims.length > 0 && (
        <>
          <h3 className="label pt-1">Claims waiting to score</h3>
          <ReadinessList items={text.claims} />
        </>
      )}
    </section>
  );
}

function ReadinessList({ items }: { items: ReadinessItem[] }) {
  return (
    <ul className="space-y-0.5 text-sm">
      {items.map((item, i) => (
        <li key={i} className={`flex gap-1.5 ${item.state === 'done' ? 'text-muted' : ''}`}>
          <span
            aria-hidden="true"
            className={`w-3 shrink-0 text-center ${
              item.state === 'done' ? 'text-amber' : item.state === 'waiting' ? 'text-[#ef7b72]' : 'text-faint'
            }`}
          >
            {item.state === 'done' ? '✓' : item.state === 'waiting' ? '○' : '·'}
          </span>
          <span className="min-w-0">
            {item.text}
            {item.state !== 'note' && <span className="sr-only">{item.state === 'done' ? ' Done.' : ' Not yet.'}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Declaring in turns: the round's order, whose turn it is and for how long, and passing. */
function Declaring({ model }: { model: CampaignModel }) {
  const { campaign, turns, isHost } = model;
  const queryClient = useQueryClient();
  const pass = useMutation({
    mutationFn: (userId: string) => api.passTurn(campaign.id, userId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) }),
  });
  const now = useNow(1000, Boolean(turns?.deadline));
  if (!turns) return null;
  const { current } = turns;
  const left = turns.deadline ? timeLeft(Date.parse(turns.deadline) - now) : null;
  const { fortify, pace } = campaign.rules.war;
  const actions = fortify ? 'Declare war on a country, fortify one of yours, or pass' : 'Declare war, or pass';
  const me = model.me.userId;
  const nothingToDo =
    model.tokens < 1 ? 'You have no war tokens left' : 'You have nothing to declare war on or fortify';
  const mine = turns.passed.has(me)
    ? "You're done declaring for this round."
    : !turns.canAct
      ? `${nothingToDo}, so your turns are passed over.`
      : turns.before === 1
        ? "You're next."
        : turns.before
          ? `${turns.before} turns before yours.`
          : '';
  const passMine = () => {
    const question =
      model.tokens > 0
        ? `Pass? You're done declaring war${fortify ? ' and fortifying' : ''} for this round. Unused tokens carry over, up to ${campaign.rules.war.tokenCap}.`
        : "Pass? You're done declaring for this round.";
    if (confirm(question)) pass.mutate(me);
  };
  const passFor = (userId: string, name: string) => {
    if (confirm(`Pass ${name}'s turn? They're done declaring for this round.`)) pass.mutate(userId);
  };
  return (
    <section className="space-y-3" aria-label="Declaring">
      <h2 className="label">Declaring in turns</h2>
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Order of turns">
        {turns.order.map((m, i) => {
          const done = turns.passed.has(m.userId);
          const up = current?.userId === m.userId;
          return (
            <li key={m.userId} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden="true" className="text-faint">
                  ›
                </span>
              )}
              <span
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-[3px] border px-2 text-sm ${
                  up ? 'border-amber bg-amber/10 font-bold' : done ? 'border-line text-faint' : 'border-line-strong'
                }`}
                aria-current={up ? 'step' : undefined}
              >
                <EmpireSwatch color={m.color} size={12} />
                <span className={done ? 'line-through' : ''}>{m.userId === me ? 'You' : m.name}</span>
                {done && <span className="sr-only">(passed)</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {turns.mine ? (
        <div className="space-y-2 rounded-[3px] border border-amber/70 bg-amber/10 px-3 py-2">
          <div className="font-stencil text-xl tracking-wide text-amber">Your turn</div>
          <p className="text-[0.95rem]">
            {turns.canAct ? `${actions}.` : `${nothingToDo}, so pass to let the next player go.`}{' '}
            {left && (
              <>
                <strong className="tabular-nums">{left}</strong> left, then your turn passes.
              </>
            )}
          </p>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pass.isPending} onClick={passMine}>
            Pass
          </button>
        </div>
      ) : current ? (
        <div className="space-y-2">
          <p className="text-[0.95rem] text-muted">
            <strong className="text-paper">{current.name}</strong> is declaring
            {left && (
              <>
                {' '}
                · <span className="tabular-nums">{left}</span> left
              </>
            )}
            . {mine}
          </p>
          {isHost && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={pass.isPending}
              onClick={() => passFor(current.userId, current.name)}
            >
              Pass for {current.name}
            </button>
          )}
        </div>
      ) : (
        <p className="text-[0.95rem] text-muted">
          Declaring is over for this round. Answers and games carry on; the next round brings new turns.
        </p>
      )}
      {pass.error && <Notice tone="error">{errorMessage(pass.error)}</Notice>}
      {(turns.mine || current) && (
        <p className="text-sm text-muted">
          One declaration{fortify ? ' or fortification' : ''} a turn, round the table; passing ends your declaring for
          the round. Each turn lasts up to {TURN_WINDOW_TEXT[pace]}.
        </p>
      )}
    </section>
  );
}

function WarList({
  model,
  wars,
  onOpenWar,
  highlight = false,
}: {
  model: CampaignModel;
  wars: WarView[];
  onOpenWar(warId: string): void;
  highlight?: boolean;
}) {
  return (
    <ul className="space-y-1.5">
      {wars.map((war) => {
        const attacker = model.membersById.get(war.attackerId);
        const target = model.idx.byId.get(war.targetId);
        return (
          <li key={war.id}>
            <button
              type="button"
              onClick={() => onOpenWar(war.id)}
              className={`flex min-h-12 w-full items-center gap-2 rounded-[3px] border px-3 py-2 text-left hover:bg-raised ${
                highlight ? 'border-amber/70 bg-amber/5' : 'border-line'
              }`}
            >
              {attacker && <EmpireSwatch color={attacker.color} size={14} className="shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.95rem] font-semibold">
                  {playerName(model, war.attackerId)} <span className="text-grease">⟶</span> {target?.name}{' '}
                  <span className="font-normal text-muted tabular-nums">({target?.value})</span>
                </span>
                <span className="block truncate text-sm text-muted">{warStatusText(model, war)}</span>
                {war.status !== 'resolved' && <WarStakesNote model={model} war={war} className="block text-sm" />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** My games underway, with the ones waiting for my move first. */
function YourGames({ model, onOpenGame }: { model: CampaignModel; onOpenGame(gameId: string): void }) {
  const me = model.me.userId;
  const mine = useMyGames(model);
  const now = useNow(1000, mine.length > 0);
  if (mine.length === 0) return null;
  const rows = mine
    .map(({ war, gameId, game, myMove, overTheBoard }) => {
      const left = game?.deadline
        ? Date.parse(game.deadline) - Date.parse(game.serverNow) - (now - game.receivedAt)
        : null;
      const label = overTheBoard
        ? myMove
          ? 'Confirm result'
          : 'Over the board'
        : game?.overTheBoardOfferBy && game.overTheBoardOfferBy !== me
          ? 'Over the board?'
          : myMove
            ? 'Your move'
            : 'Their move';
      return { war, gameId, myMove, left, label };
    })
    .sort((a, b) => Number(b.myMove) - Number(a.myMove));
  return (
    <section>
      <h2 className="label mb-2">Your games</h2>
      <ul className="space-y-1.5">
        {rows.map(({ war, gameId, myMove, left, label }) => (
          <li key={gameId}>
            <button
              type="button"
              onClick={() => onOpenGame(gameId)}
              className={`flex min-h-12 w-full items-center gap-2 rounded-[3px] border px-3 py-2 text-left hover:bg-raised ${
                myMove ? 'border-amber/70 bg-amber/5' : 'border-line'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.95rem] font-semibold">
                  Battle for {countryName(model, war.targetId)}
                </span>
                <span className="block truncate text-sm text-muted">
                  vs {playerName(model, war.attackerId === me ? war.defenderId : war.attackerId)}
                </span>
                <WarStakesNote model={model} war={war} className="block text-sm" />
              </span>
              <span className={`text-sm font-bold ${myMove ? 'text-amber' : 'text-muted'}`}>
                {label}
                {left !== null && model.campaign.rules.war.pace === 'correspondence' && (
                  <span className="block text-right font-normal tabular-nums">{timeLeft(left)}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
