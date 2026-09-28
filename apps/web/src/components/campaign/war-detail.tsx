'use client';

import {
  RESPONSE_WINDOW_MS,
  canRaise,
  raiseFloor,
  redirectOptions,
  tributeOptions,
  valueOf,
  type TerritoryId,
  type WarReply,
  type WarResponse,
  type WarView,
} from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys } from '@/lib/queries';
import { useNow } from '@/lib/use-now';
import {
  counterText,
  countryName,
  currentGame,
  outcomeText,
  playerName,
  resultText,
  timeLeft,
  warStatusText,
} from '@/lib/wars';
import { Notice, ValueBadge } from '../ui';
import { PlayerName } from './player-name';
import { useEmpireHref } from './room-context';
import { StakeBuilder, initialStake, stakeProblem, type StakeDraft, type StakeOptions } from './stake-builder';

export interface StakePreview {
  targetId: TerritoryId;
  launchId: TerritoryId;
  stake: TerritoryId[];
}

/** One war: who, what's at stake, where it stands, and the answer it needs from the viewer. */
export function WarDetail({
  model,
  war,
  onSelectCountry,
  onFocusCountry,
  onOpenGame,
  onClose,
  onPreview,
}: {
  model: CampaignModel;
  war: WarView;
  onSelectCountry(id: TerritoryId): void;
  /** Shows a country on the map without leaving the war, e.g. a redirect or tribute option. */
  onFocusCountry(id: TerritoryId): void;
  onOpenGame(gameId: string): void;
  onClose(): void;
  onPreview(preview: StakePreview | null): void;
}) {
  const { idx } = model;
  const target = idx.byId.get(war.targetId);
  const me = model.me.userId;
  const game = currentGame(war);
  const empireHref = useEmpireHref(model.campaign.id);

  const country = (id: TerritoryId) => (
    <button
      type="button"
      onClick={() => onSelectCountry(id)}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-[3px] border border-line-strong px-2 text-[0.95rem] hover:bg-raised"
    >
      {countryName(model, id)} <span className="text-muted tabular-nums">{idx.byId.get(id)?.value}</span>
    </button>
  );

  return (
    <section aria-label={`War for ${target?.name}`} className="space-y-5 p-4">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="label">War · declared in round {war.declaredRound}</div>
          <h2 className="font-stencil text-[1.7rem] leading-tight tracking-wide text-[#ef7b72]">
            {war.games.at(-1)?.armageddon ? 'Armageddon' : 'War'} for {target?.name ?? war.targetId}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center text-2xl text-muted hover:text-paper"
        >
          ×
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <PlayerName
          member={model.membersById.get(war.attackerId)}
          you={war.attackerId === me}
          href={empireHref(war.attackerId)}
        />
        <span className="text-grease" aria-label="attacks">
          ⟶
        </span>
        <PlayerName
          member={model.membersById.get(war.defenderId)}
          you={war.defenderId === me}
          href={empireHref(war.defenderId)}
        />
      </div>

      <dl className="space-y-3">
        <div>
          <dt className="label mb-1">
            Target{war.redirectedFrom ? ` (redirected from ${countryName(model, war.redirectedFrom)})` : ''}
          </dt>
          <dd>{country(war.targetId)}</dd>
        </div>
        <div>
          <dt className="label mb-1">Stake · worth {valueOf(idx, war.stake)}</dt>
          <dd className="flex flex-wrap gap-1.5">
            {war.stake.map((id) => (
              <span key={id}>{country(id)}</span>
            ))}
          </dd>
        </div>
      </dl>

      <p className="text-[0.95rem]">{warStatusText(model, war)}.</p>

      {war.status === 'declared' && war.defenderId === me && (
        <DefenderAnswer model={model} war={war} onFocusCountry={onFocusCountry} />
      )}
      {war.status === 'countered' && (
        <>
          <Notice tone="amber">{counterText(model, war)}</Notice>
          {war.attackerId === me && <AttackerReply model={model} war={war} onPreview={onPreview} />}
        </>
      )}
      {(war.status === 'declared' || war.status === 'countered') && war.respondBy && (
        <Deadline war={war} model={model} />
      )}

      {war.games.length > 0 && (
        <section>
          <h3 className="label mb-2">{war.games.length > 1 ? 'Games' : 'Game'}</h3>
          <ul className="space-y-2">
            {war.games.map((g) => (
              <li key={g.id} className="flex items-center gap-3 rounded-[3px] border border-line px-3 py-2">
                <span className="min-w-0 flex-1 text-[0.95rem]">
                  {g.armageddon ? 'Armageddon: ' : ''}
                  {playerName(model, g.whiteId)} (White) vs {playerName(model, g.blackId)} (Black)
                  <span className="block text-sm text-muted">
                    {g.status === 'finished' && g.result
                      ? resultText(g.result, g.reason)
                      : g.status === 'cancelled'
                        ? 'Called off: the campaign ended first'
                        : g.status === 'waiting'
                          ? 'Waiting for both players to be free'
                          : 'In progress'}
                  </span>
                </span>
                <button
                  type="button"
                  className={`btn btn-sm ${g.id === game?.id && g.status === 'playing' ? 'btn-amber' : 'btn-ghost'}`}
                  onClick={() => onOpenGame(g.id)}
                  disabled={g.status === 'waiting'}
                >
                  {g.status === 'playing'
                    ? model.me.userId === g.whiteId || model.me.userId === g.blackId
                      ? 'Play'
                      : 'Watch'
                    : 'Board'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {war.status === 'resolved' && <Outcome model={model} war={war} />}
    </section>
  );
}

function Deadline({ war, model }: { war: WarView; model: CampaignModel }) {
  const now = useNow(1000);
  const left = Date.parse(war.respondBy!) - now;
  const waitingOn = war.status === 'declared' ? war.defenderId : war.attackerId;
  const silence =
    war.status === 'declared'
      ? 'the war goes ahead as declared'
      : war.counter?.kind === 'tribute'
        ? 'the tribute is accepted'
        : 'the attack is called off';
  return (
    <p className="text-sm text-muted">
      {waitingOn === model.me.userId ? 'You have' : `${playerName(model, waitingOn)} has`}{' '}
      <strong className="text-paper tabular-nums">{timeLeft(left)}</strong> to answer. Without an answer, {silence}.
    </p>
  );
}

function Outcome({ model, war }: { model: CampaignModel; war: WarView }) {
  const event = [...model.campaign.events]
    .reverse()
    .find((e) => e.type === 'war.resolved' && e.payload.warId === war.id);
  const transfers = event?.type === 'war.resolved' ? event.payload.transfers : [];
  return (
    <div className="space-y-2 border-l-2 border-grease/70 pl-3">
      <p className="font-semibold">{outcomeText(model, war)}.</p>
      {transfers.length > 0 && (
        <p className="text-sm text-muted">
          {transfers.map((t) => countryName(model, t.territoryId)).join(', ')} went to{' '}
          {playerName(model, transfers[0]!.to)}.
        </p>
      )}
      {event?.type === 'war.resolved' && event.payload.tokens ? (
        <p className="text-sm text-muted">
          {event.payload.tokens} war {event.payload.tokens === 1 ? 'token' : 'tokens'} changed hands.
        </p>
      ) : null}
    </div>
  );
}

function useWarAction<T>(model: CampaignModel, run: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(model.campaign.id) }),
  });
}

function DefenderAnswer({
  model,
  war,
  onFocusCountry,
}: {
  model: CampaignModel;
  war: WarView;
  onFocusCountry(id: TerritoryId): void;
}) {
  const [mode, setMode] = useState<'redirect' | 'tribute' | null>(null);
  const respond = useWarAction(model, (input: WarResponse) => api.respondToWar(model.campaign.id, war.id, input));
  const active = model.board.wars.find((w) => w.id === war.id);
  const target = model.idx.byId.get(war.targetId)!;
  const raiseTo = raiseFloor(model.campaign.rules, target.value);
  const raisable = active ? canRaise(model.board, active) : false;
  const redirects = active ? redirectOptions(model.board, active) : [];
  const tributes = active ? tributeOptions(model.board, active) : [];
  const attacker = playerName(model, war.attackerId);

  return (
    <div className="space-y-3 rounded-[3px] border border-amber/70 bg-amber/5 p-3">
      <div className="font-stencil text-xl tracking-wide text-amber">Your answer</div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={respond.isPending}
          onClick={() => respond.mutate({ response: 'accept' })}
        >
          Accept
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={respond.isPending || !raisable}
          title={raisable ? undefined : 'The stake already meets what a raise would demand.'}
          onClick={() => respond.mutate({ response: 'raise' })}
        >
          Raise
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={mode === 'redirect'}
          disabled={redirects.length === 0}
          onClick={() => setMode(mode === 'redirect' ? null : 'redirect')}
        >
          Redirect
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={mode === 'tribute'}
          disabled={tributes.length === 0 && model.tokens === 0}
          onClick={() => setMode(mode === 'tribute' ? null : 'tribute')}
        >
          Pay tribute
        </button>
      </div>
      <ul className="space-y-1 text-sm text-muted">
        <li>
          <strong className="text-paper">Accept:</strong> play for {target.name}. Win and you take the stake.
        </li>
        <li>
          <strong className="text-paper">Raise:</strong>{' '}
          {raisable
            ? `demand a stake worth at least ${raiseTo}. If ${attacker} won't, the war is off and the token is lost.`
            : 'not available: the stake already meets what a raise would demand.'}
        </li>
        <li>
          <strong className="text-paper">Redirect:</strong>{' '}
          {redirects.length > 0
            ? `offer another country worth ${target.value} that borders ${attacker}. They fight for it or withdraw.`
            : `not available: none of your countries worth ${target.value} borders ${attacker} and is free.`}
        </li>
        <li>
          <strong className="text-paper">Pay tribute:</strong> offer a country worth less than {target.value}, or
          tokens. {attacker} can take it or refuse and fight.
        </li>
      </ul>
      {mode === 'redirect' && (
        <ChoiceForm
          label="Redirect to"
          options={redirects.map((id) => ({
            id,
            label: `${countryName(model, id)} (${model.idx.byId.get(id)?.value})`,
          }))}
          submit="Redirect"
          pending={respond.isPending}
          onPreview={onFocusCountry}
          onSubmit={(targetId) => respond.mutate({ response: 'redirect', targetId })}
        />
      )}
      {mode === 'tribute' && (
        <TributeForm
          model={model}
          options={tributes}
          pending={respond.isPending}
          onPreview={onFocusCountry}
          onSubmit={(input) => respond.mutate({ response: 'tribute', ...input })}
        />
      )}
      {respond.error && <Notice tone="error">{errorMessage(respond.error)}</Notice>}
    </div>
  );
}

function ChoiceForm({
  label,
  options,
  submit,
  pending,
  onSubmit,
  onPreview,
}: {
  label: string;
  options: { id: string; label: string }[];
  submit: string;
  pending: boolean;
  onSubmit(id: string): void;
  onPreview?(id: string): void;
}) {
  const [choice, setChoice] = useState(options[0]?.id ?? '');
  const selectId = useId();
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (choice) onSubmit(choice);
      }}
    >
      <label className="min-w-0 flex-1" htmlFor={selectId}>
        <span className="label mb-1 block">{label}</span>
        <select
          id={selectId}
          className="input"
          value={choice}
          onChange={(e) => {
            setChoice(e.target.value);
            onPreview?.(e.target.value);
          }}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-amber" disabled={!choice || pending}>
        {submit}
      </button>
    </form>
  );
}

function TributeForm({
  model,
  options,
  pending,
  onSubmit,
  onPreview,
}: {
  model: CampaignModel;
  options: TerritoryId[];
  pending: boolean;
  onSubmit(input: { territoryId?: TerritoryId; tokens?: number }): void;
  onPreview(id: TerritoryId): void;
}) {
  const [kind, setKind] = useState<'country' | 'tokens'>(options.length > 0 ? 'country' : 'tokens');
  const [tokens, setTokens] = useState(1);
  const name = useId();
  return (
    <div className="space-y-2">
      <div className="flex gap-4" role="radiogroup" aria-label="Tribute">
        {(['country', 'tokens'] as const).map((k) => (
          <label key={k} className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={name}
              className="size-4 accent-amber"
              checked={kind === k}
              disabled={k === 'country' ? options.length === 0 : model.tokens === 0}
              onChange={() => setKind(k)}
            />
            {k === 'country' ? 'A country' : 'War tokens'}
          </label>
        ))}
      </div>
      {kind === 'country' ? (
        <ChoiceForm
          label="Cede"
          options={options.map((id) => ({ id, label: `${countryName(model, id)} (${model.idx.byId.get(id)?.value})` }))}
          submit="Offer tribute"
          pending={pending}
          onPreview={onPreview}
          onSubmit={(territoryId) => onSubmit({ territoryId })}
        />
      ) : (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ tokens });
          }}
        >
          <label className="flex-1">
            <span className="label mb-1 block">Tokens (you have {model.tokens})</span>
            <input
              type="number"
              className="input"
              min={1}
              max={model.tokens}
              value={tokens}
              onChange={(e) => setTokens(Math.max(1, Math.min(model.tokens, Number(e.target.value) || 1)))}
            />
          </label>
          <button type="submit" className="btn btn-amber" disabled={pending || model.tokens === 0}>
            Offer tribute
          </button>
        </form>
      )}
    </div>
  );
}

function AttackerReply({
  model,
  war,
  onPreview,
}: {
  model: CampaignModel;
  war: WarView;
  onPreview(preview: StakePreview | null): void;
}) {
  const reply = useWarAction(model, (input: WarReply) => api.replyToWar(model.campaign.id, war.id, input));
  const counter = war.counter!;
  const opts: StakeOptions = useMemo(
    () => ({ minValue: counter.kind === 'raise' ? counter.minValue : 0, exceptWarId: war.id, launchId: war.launchId }),
    [counter, war.id, war.launchId],
  );
  const [draft, setDraft] = useState<StakeDraft | null>(() =>
    counter.kind === 'raise' ? initialStake(model, war.targetId, opts) : null,
  );
  useEffect(() => {
    if (counter.kind !== 'raise') return;
    onPreview(draft ? { targetId: war.targetId, ...draft } : null);
    return () => onPreview(null);
  }, [draft, counter.kind, war.targetId, onPreview]);

  const withdraw = (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={reply.isPending}
      onClick={() => {
        if (confirm('Withdraw? The war is off and your token is lost.')) reply.mutate({ reply: 'withdraw' });
      }}
    >
      Withdraw
    </button>
  );

  return (
    <div className="space-y-3 rounded-[3px] border border-amber/70 bg-amber/5 p-3">
      <div className="font-stencil text-xl tracking-wide text-amber">Your answer</div>
      {counter.kind === 'raise' &&
        (draft ? (
          <>
            <StakeBuilder model={model} targetId={war.targetId} opts={opts} draft={draft} onChange={setDraft} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-war"
                disabled={reply.isPending || stakeProblem(model, war.targetId, draft, opts) !== null}
                onClick={() => reply.mutate({ reply: 'accept', stake: draft.stake })}
              >
                Raise the stake
              </button>
              {withdraw}
            </div>
          </>
        ) : (
          <>
            <p className="text-[0.95rem]">
              Your countries connected to {countryName(model, war.launchId)} can't reach {counter.minValue}.
            </p>
            {withdraw}
          </>
        ))}
      {counter.kind === 'redirect' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-war"
            disabled={reply.isPending}
            onClick={() => reply.mutate({ reply: 'accept' })}
          >
            Fight for {countryName(model, counter.targetId)}
          </button>
          {withdraw}
        </div>
      )}
      {counter.kind === 'tribute' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={reply.isPending}
            onClick={() => reply.mutate({ reply: 'accept' })}
          >
            Accept tribute
          </button>
          <button
            type="button"
            className="btn btn-war"
            disabled={reply.isPending}
            onClick={() => reply.mutate({ reply: 'refuse' })}
          >
            Refuse and fight
          </button>
        </div>
      )}
      {reply.error && <Notice tone="error">{errorMessage(reply.error)}</Notice>}
    </div>
  );
}

/** How long a player has to answer, for help text. */
export const answerWindow = (model: CampaignModel) =>
  RESPONSE_WINDOW_MS[model.campaign.rules.war.pace] >= 3_600_000 ? '24 hours' : '5 minutes';
