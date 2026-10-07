'use client';

import {
  ACCORD_MAX_ROUNDS,
  ACCORD_MIN_ROUNDS,
  PEACE_MAX_TOKENS,
  PEACE_REJECTION_MESSAGES,
  attackerRaiseMore,
  attackerRaiseRange,
  attackerRaised,
  canRaise,
  canRaiseAgain,
  counterCost,
  declaredStake,
  defenderAnswerOptions,
  matchedRaiseRange,
  peaceCountries,
  peaceIssue,
  owedByDefender,
  raiseAnswerer,
  raiseDemand,
  raiseOptions,
  redirectOptions,
  tributeOptions,
  valueOf,
  waitingOn,
  type PeaceOfferView,
  type PeaceTerms,
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
  raiseLines,
  resultText,
  stakedByRaises,
  termsText,
  timeLeft,
  tokensText,
  warStatusText,
} from '@/lib/wars';
import { Notice, Spotlight } from '../ui';
import { PlayerName } from './player-name';
import { useEmpireHref } from './room-context';
import { StakeBuilder, initialStake, stakeProblem, type StakeDraft, type StakeOptions } from './stake-builder';
import { WarOutcomes, WarStakesNote } from './war-outcomes';

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
  spotlight,
}: {
  model: CampaignModel;
  war: WarView;
  onSelectCountry(id: TerritoryId): void;
  /** Shows a country on the map without leaving the war, e.g. a redirect or tribute option. */
  onFocusCountry(id: TerritoryId): void;
  onOpenGame(gameId: string): void;
  onClose(): void;
  onPreview(preview: StakePreview | null): void;
  /** Set a new nonce to call out what the viewer must answer: their answer, or peace terms to them. */
  spotlight?: number | null;
}) {
  const { idx } = model;
  const target = idx.byId.get(war.targetId);
  const me = model.me.userId;
  const game = currentGame(war);
  const empireHref = useEmpireHref(model.campaign.id);
  const rules = model.campaign.rules.war;
  const added = stakedByRaises(war);
  const raises = raiseLines(model, war);
  const pending = war.status === 'declared' || war.status === 'countered';
  const party = war.attackerId === me || war.defenderId === me;
  const answering = waitingOn(war) === me;

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
          <dd className="flex flex-wrap gap-1.5">
            {country(war.targetId)}
            {added.length > 0 && (
              <>
                <span className="self-center text-sm text-muted">
                  and, put in by {added.length === 1 ? 'the raise' : 'raises'},
                </span>
                {added.map((id) => (
                  <span key={id}>{country(id)}</span>
                ))}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="label mb-1">Stake · worth {valueOf(idx, war.stake)}</dt>
          <dd className="flex flex-wrap gap-1.5">
            {war.stake.map((id) => (
              <span key={id}>{country(id)}</span>
            ))}
          </dd>
        </div>
        {raises.length > 0 && (
          <div>
            <dt className="label mb-1">Raises</dt>
            <dd>
              <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted">
                {raises.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            </dd>
          </div>
        )}
        {pending && war.reserves.length > 0 && (
          <div>
            <dt className="label mb-1">In reserve to meet a raise · worth {valueOf(idx, war.reserves)}</dt>
            <dd className="flex flex-wrap gap-1.5">
              {war.reserves.map((id) => (
                <span key={id}>{country(id)}</span>
              ))}
            </dd>
          </div>
        )}
      </dl>

      <p className="text-[0.95rem]">
        {warStatusText(model, war)}.
        <WarStakesNote model={model} war={war} className="block" />
      </p>

      {war.status !== 'resolved' && !(answering && war.attackerId === me && war.counter?.kind === 'raise') && (
        <WarOutcomes model={model} war={war} />
      )}

      {war.status === 'declared' && war.defenderId === me && (
        <Spotlight nonce={spotlight} label="Your answer">
          <DefenderAnswer model={model} war={war} onFocusCountry={onFocusCountry} />
        </Spotlight>
      )}
      {war.status === 'declared' && war.attackerId === me && rules.recall && <Recall model={model} war={war} />}
      {war.status === 'countered' && (
        <>
          <Notice tone="amber">{counterText(model, war)}</Notice>
          {answering && war.attackerId === me && (
            <Spotlight nonce={spotlight} label="Your answer">
              <AttackerReply model={model} war={war} onPreview={onPreview} />
            </Spotlight>
          )}
          {answering && war.defenderId === me && (
            <Spotlight nonce={spotlight} label="Your answer">
              <DefenderReply model={model} war={war} onFocusCountry={onFocusCountry} />
            </Spotlight>
          )}
        </>
      )}
      {pending && war.respondBy && <Deadline war={war} model={model} />}

      {rules.peaceTerms && party && war.status !== 'resolved' && (
        <PeacePanel model={model} war={war} onFocusCountry={onFocusCountry} spotlight={answering ? null : spotlight} />
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
                        ? war.outcome === 'settled'
                          ? 'Called off: the war ended in peace'
                          : 'Called off: the campaign ended first'
                        : g.status === 'waiting'
                          ? model.turns?.current
                            ? 'Waiting for declaring to end'
                            : 'Waiting for both players to be free'
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
  const answerer = waitingOn(war) ?? war.attackerId;
  const counter = war.counter;
  const silence =
    war.status === 'declared'
      ? 'the war goes ahead as declared'
      : counter?.kind === 'tribute'
        ? 'the tribute is accepted'
        : counter && raiseAnswerer(counter) === 'defender'
          ? `${playerName(model, war.defenderId)} backs down and ${countryName(model, war.targetId)} goes to ${playerName(model, war.attackerId)}`
          : attackerRaised(counter)
            ? `${playerName(model, war.attackerId)} backs down and the stake as declared goes to ${playerName(model, war.defenderId)}`
            : 'the attack is called off';
  return (
    <p className="text-sm text-muted">
      {answerer === model.me.userId ? 'You have' : `${playerName(model, answerer)} has`}{' '}
      <strong className="text-paper tabular-nums">{timeLeft(left)}</strong> to answer. Without an answer, {silence}.
    </p>
  );
}

function Outcome({ model, war }: { model: CampaignModel; war: WarView }) {
  const event = [...model.campaign.events]
    .reverse()
    .find((e) => e.type === 'war.resolved' && e.payload.warId === war.id);
  const payload = event?.type === 'war.resolved' ? event.payload : null;
  const transfers = payload?.transfers ?? [];
  if (payload?.terms) {
    return (
      <div className="space-y-2 border-l-2 border-grease/70 pl-3">
        <p className="font-semibold">{outcomeText(model, war)}.</p>
        <p className="text-sm text-muted">{termsText(model, war, payload.terms)}.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 border-l-2 border-grease/70 pl-3">
      <p className="font-semibold">{outcomeText(model, war)}.</p>
      {transfers.length > 0 && (
        <p className="text-sm text-muted">
          {transfers.map((t) => countryName(model, t.territoryId)).join(', ')} went to{' '}
          {playerName(model, transfers[0]!.to)}.
        </p>
      )}
      {payload?.tokens ? <p className="text-sm text-muted">{tokensText(payload.tokens)} changed hands.</p> : null}
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
  const rules = model.campaign.rules.war;
  const [mode, setMode] = useState<'raise' | 'redirect' | 'tribute' | null>(null);
  const respond = useWarAction(model, (input: WarResponse) => api.respondToWar(model.campaign.id, war.id, input));
  const active = model.board.wars.find((w) => w.id === war.id);
  const target = model.idx.byId.get(war.targetId)!;
  const attacker = playerName(model, war.attackerId);
  const raiseCost = counterCost(model.campaign.rules, 'raise');
  const redirectCost = counterCost(model.campaign.rules, 'redirect');
  const raisable = active ? canRaise(model.board, active) : false;
  const raiseChoices = active && rules.raise === 'matched' ? raiseOptions(model.board, active) : [];
  const raiseTo = active && rules.raise !== 'matched' ? raiseDemand(model.board, active) : 0;
  const range = matchedRaiseRange(target.value);
  const redirects = active ? redirectOptions(model.board, active) : [];
  const tributes = active ? tributeOptions(model.board, active) : [];
  const shortOf = (cost: number) => model.tokens < cost;
  const reserves =
    war.reserves.length > 0
      ? ` ${attacker} has set ${valueOf(model.idx, war.reserves)} aside to meet one at once.`
      : '';

  const raiseLine = (() => {
    switch (rules.raise) {
      case 'matched':
        return raisable
          ? `put one of your countries worth ${range.min} to ${range.max} into the war. ${attacker} must add at least as much to the stake or withdraw, and if they win they take it too.` +
              (rules.raises > 1
                ? ` They may raise again, up to ${rules.raises} raises in all; once you have raised, backing down yields ${target.name}.`
                : '') +
              reserves
          : `not available: none of your free countries is worth ${range.min} to ${range.max} and within what ${attacker} could still add.`;
      case 'token':
        if (!raisable) return 'not available: the stake already meets what a raise would demand.';
        if (shortOf(raiseCost)) return `not available: it costs ${tokensText(raiseCost)}, and you have none.`;
        return `demand a stake worth at least ${raiseTo}, for ${tokensText(raiseCost)}, which ${attacker} gets if they raise the stake. If they won't, the war is off and both tokens are spent.${reserves}`;
      case 'free':
        return raisable
          ? `demand a stake worth at least ${raiseTo}. If ${attacker} won't, the war is off and the token is lost.`
          : 'not available: the stake already meets what a raise would demand.';
      case 'off':
        return null;
    }
  })();
  const redirectLine =
    redirects.length === 0
      ? rules.redirect === 'nearby'
        ? `not available: none of your countries worth ${target.value} borders both ${target.name} and ${attacker}, free of other wars.`
        : `not available: none of your countries worth ${target.value} borders ${attacker} and is free.`
      : shortOf(redirectCost)
        ? `not available: it costs ${tokensText(redirectCost)}, and you have none.`
        : `offer another country worth ${target.value}${rules.redirect === 'nearby' ? ` next to ${target.name}` : ''} that borders ${attacker}. They fight for it or withdraw.` +
          (rules.redirect === 'nearby' ? ` The war keeps ${target.name}'s clock.` : '') +
          (redirectCost > 0 ? ` Costs ${tokensText(redirectCost)}, which ${attacker} gets if they fight on.` : '');

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
        {rules.raise !== 'off' && (
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={rules.raise === 'matched' ? mode === 'raise' : undefined}
            disabled={respond.isPending || !raisable || shortOf(raiseCost)}
            onClick={() =>
              rules.raise === 'matched'
                ? setMode(mode === 'raise' ? null : 'raise')
                : respond.mutate({ response: 'raise' })
            }
          >
            Raise
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={mode === 'redirect'}
          disabled={redirects.length === 0 || shortOf(redirectCost)}
          onClick={() => setMode(mode === 'redirect' ? null : 'redirect')}
        >
          Redirect
        </button>
        {!rules.peaceTerms && (
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={mode === 'tribute'}
            disabled={tributes.length === 0 && model.tokens === 0}
            onClick={() => setMode(mode === 'tribute' ? null : 'tribute')}
          >
            Pay tribute
          </button>
        )}
      </div>
      <ul className="space-y-1 text-sm text-muted">
        <li>
          <strong className="text-paper">Accept:</strong> play for {target.name}. Win and you take the stake.
        </li>
        {raiseLine && (
          <li>
            <strong className="text-paper">Raise:</strong> {raiseLine}
          </li>
        )}
        <li>
          <strong className="text-paper">Redirect:</strong> {redirectLine}
        </li>
        {rules.peaceTerms ? (
          <li>
            <strong className="text-paper">Peace terms:</strong> offer them below, now or at any time until the game
            ends. Meanwhile this answer is still due.
          </li>
        ) : (
          <li>
            <strong className="text-paper">Pay tribute:</strong> offer a country worth less than {target.value}, or
            tokens. {attacker} can take it or refuse and fight.
          </li>
        )}
      </ul>
      {mode === 'raise' && (
        <ChoiceForm
          label="Put into the war"
          options={raiseChoices.map((id) => ({
            id,
            label: `${countryName(model, id)} (${model.idx.byId.get(id)?.value})`,
          }))}
          submit="Raise"
          pending={respond.isPending}
          onPreview={onFocusCountry}
          onSubmit={(territoryId) => respond.mutate({ response: 'raise', territoryId })}
        />
      )}
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

/** The attacker calls a declaration off before the defender answers. */
function Recall({ model, war }: { model: CampaignModel; war: WarView }) {
  const recall = useWarAction(model, () => api.recallWar(model.campaign.id, war.id));
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[3px] border border-line px-3 py-2">
      <p className="min-w-0 flex-1 text-sm text-muted">
        Until {playerName(model, war.defenderId)} answers, you can call the attack off. Your war token stays spent, and
        no truce follows.
      </p>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={recall.isPending}
        onClick={() => {
          if (confirm('Call off the attack? Your war token stays spent.')) recall.mutate(undefined);
        }}
      >
        Call off
      </button>
      {recall.error && <Notice tone="error">{errorMessage(recall.error)}</Notice>}
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

/** The defender answers the attacker's raise: meet it, raise again, or back down. */
function DefenderReply({
  model,
  war,
  onFocusCountry,
}: {
  model: CampaignModel;
  war: WarView;
  onFocusCountry(id: TerritoryId): void;
}) {
  const reply = useWarAction(model, (input: WarReply) => api.replyToWar(model.campaign.id, war.id, input));
  const [mode, setMode] = useState<'meet' | 'raise' | null>(null);
  const counter = war.counter!;
  const active = model.board.wars.find((w) => w.id === war.id);
  const options = active ? defenderAnswerOptions(model.board, active, counter) : { meet: [], raise: [] };
  const again = canRaiseAgain(model.campaign.rules, counter);
  const owed = owedByDefender(counter);
  const target = countryName(model, war.targetId);
  const attacker = playerName(model, war.attackerId);
  const label = (id: TerritoryId) => `${countryName(model, id)} (${model.idx.byId.get(id)?.value})`;
  return (
    <div className="space-y-3 rounded-[3px] border border-amber/70 bg-amber/5 p-3">
      <div className="font-stencil text-xl tracking-wide text-amber">Your answer</div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn btn-primary"
          aria-expanded={mode === 'meet'}
          disabled={reply.isPending || options.meet.length === 0}
          onClick={() => setMode(mode === 'meet' ? null : 'meet')}
        >
          Meet the raise
        </button>
        {again && (
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={mode === 'raise'}
            disabled={reply.isPending || options.raise.length === 0}
            onClick={() => setMode(mode === 'raise' ? null : 'raise')}
          >
            Raise again
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={reply.isPending}
          onClick={() => {
            if (confirm(`Back down? ${target} goes to ${attacker} without a game.`))
              reply.mutate({ reply: 'withdraw' });
          }}
        >
          Back down
        </button>
      </div>
      <ul className="space-y-1 text-sm text-muted">
        <li>
          <strong className="text-paper">Meet the raise:</strong>{' '}
          {options.meet.length > 0
            ? `put in a country worth at least ${owed}, and play for everything at stake. If ${attacker} wins, they take it too.`
            : `not available: none of your free countries is worth ${owed} or more.`}
        </li>
        {again && (
          <li>
            <strong className="text-paper">Raise again:</strong>{' '}
            {options.raise.length > 0
              ? `put in a country worth ${owed + matchedRaiseRange(model.idx.byId.get(war.targetId)?.value ?? 0).min} or more: ${attacker} must add what it's worth over ${owed} to the stake, or back down and hand you their stake as declared.`
              : `not available: none of your free countries is worth enough more than ${owed}, within what ${attacker} could still add.`}
          </li>
        )}
        <li>
          <strong className="text-paper">Back down:</strong> you raised, so {target} goes to {attacker} without a game.
          The countries you put in stay yours.
        </li>
      </ul>
      {mode === 'meet' && (
        <ChoiceForm
          label="Put into the war"
          options={options.meet.map((id) => ({ id, label: label(id) }))}
          submit="Meet the raise"
          pending={reply.isPending}
          onPreview={onFocusCountry}
          onSubmit={(territoryId) => reply.mutate({ reply: 'accept', territoryId })}
        />
      )}
      {mode === 'raise' && (
        <ChoiceForm
          label="Put into the war"
          options={options.raise.map((id) => ({ id, label: label(id) }))}
          submit="Raise again"
          pending={reply.isPending}
          onPreview={onFocusCountry}
          onSubmit={(territoryId) => reply.mutate({ reply: 'raise', territoryId })}
        />
      )}
      {reply.error && <Notice tone="error">{errorMessage(reply.error)}</Notice>}
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
  const active = model.board.wars.find((w) => w.id === war.id);
  const range = active ? attackerRaiseRange(model.board, active, counter) : null;
  const backDown = attackerRaised(counter);
  const defender = playerName(model, war.defenderId);
  const [draft, setDraft] = useState<StakeDraft | null>(() =>
    counter.kind === 'raise' ? initialStake(model, war.targetId, opts) : null,
  );
  useEffect(() => {
    if (counter.kind !== 'raise') return;
    onPreview(draft ? { targetId: war.targetId, ...draft } : null);
    return () => onPreview(null);
  }, [draft, counter.kind, war.targetId, onPreview]);
  const earns =
    counter.kind !== 'tribute' && counter.tokens ? (
      <p className="text-sm text-muted">
        {playerName(model, war.defenderId)} paid {tokensText(counter.tokens)} for this: fight on and it&apos;s yours.
      </p>
    ) : null;

  const lost = declaredStake(war)
    .map((id) => countryName(model, id))
    .join(', ');
  const withdraw = backDown ? (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={reply.isPending}
      onClick={() => {
        if (confirm(`Back down? ${defender} takes your stake as declared (${lost}) without a game.`)) {
          reply.mutate({ reply: 'withdraw' });
        }
      }}
    >
      Back down
    </button>
  ) : (
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
  const value = draft ? valueOf(model.idx, draft.stake) : 0;
  const raiseFrom = counter.kind === 'raise' && range ? counter.minValue + range.min : null;

  return (
    <div className="space-y-3 rounded-[3px] border border-amber/70 bg-amber/5 p-3">
      <div className="font-stencil text-xl tracking-wide text-amber">Your answer</div>
      {earns}
      {counter.kind === 'raise' &&
        (draft ? (
          <>
            <StakeBuilder model={model} targetId={war.targetId} opts={opts} draft={draft} onChange={setDraft} />
            <WarOutcomes model={model} war={war} stake={draft.stake} heading="What this stake could change" />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-war"
                disabled={reply.isPending || stakeProblem(model, war.targetId, draft, opts) !== null}
                onClick={() => reply.mutate({ reply: 'accept', stake: draft.stake })}
              >
                Meet the raise
              </button>
              {range && raiseFrom !== null && (
                <button
                  type="button"
                  className="btn btn-amber"
                  disabled={
                    reply.isPending ||
                    value < raiseFrom ||
                    stakeProblem(model, war.targetId, draft, { ...opts, minValue: raiseFrom }) !== null
                  }
                  onClick={() => reply.mutate({ reply: 'raise', stake: draft.stake })}
                >
                  Raise again
                </button>
              )}
              {withdraw}
            </div>
            {range && raiseFrom !== null && (
              <p className="text-sm text-muted">
                <strong className="text-paper">Raise again:</strong> stake {raiseFrom} or more. {defender} must then put
                in a country worth what you stake over {counter.kind === 'raise' ? counter.minValue : 0} (up to{' '}
                {range.max}), or back down and yield {countryName(model, war.targetId)}.
                {value >= raiseFrom
                  ? ` As it stands they must put in ${attackerRaiseMore(range, counter.kind === 'raise' ? counter.minValue : 0, value)}.`
                  : ''}{' '}
                Once you raise, backing down hands {defender} your stake as declared.
              </p>
            )}
            {backDown && (
              <p className="text-sm text-muted">
                <strong className="text-paper">Back down:</strong> you raised, so {defender} takes your stake as
                declared ({lost}) without a game.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-[0.95rem]">
              Your countries connected to {countryName(model, war.launchId)} can&apos;t reach {counter.minValue}.
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

// ---------------------------------------------------------------------------------------------
// Peace terms

/** Terms offered to or by the viewer in this war, and a form to offer new ones. */
function PeacePanel({
  model,
  war,
  onFocusCountry,
  spotlight,
}: {
  model: CampaignModel;
  war: WarView;
  onFocusCountry(id: TerritoryId): void;
  /** Calls out terms offered to the viewer. */
  spotlight: number | null | undefined;
}) {
  const me = model.me.userId;
  const other = playerName(model, war.attackerId === me ? war.defenderId : war.attackerId);
  const open = war.peace.filter((o) => o.status === 'proposed');
  const mine = open.find((o) => o.proposerId === me);
  const theirs = open.find((o) => o.recipientId === me);
  const lastMine = war.peace.find((o) => o.proposerId === me && o.status !== 'proposed' && o.status !== 'accepted');
  const [composing, setComposing] = useState(false);

  return (
    <section aria-label="Peace terms" className="space-y-3 rounded-[3px] border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="label">Peace terms</h3>
        {!composing && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setComposing(true)}>
            {mine ? 'Change your offer' : 'Offer terms'}
          </button>
        )}
      </div>
      {theirs && (
        <Spotlight nonce={spotlight} label="Peace terms offered to you">
          <OfferToMe model={model} war={war} offer={theirs} />
        </Spotlight>
      )}
      {mine && <MyOffer model={model} war={war} offer={mine} other={other} />}
      {!mine && lastMine && (
        <p className="text-sm text-muted">
          Your last offer was{' '}
          {{ declined: 'turned down', withdrawn: 'withdrawn', lapsed: 'left unanswered' }[
            lastMine.status as 'declined' | 'withdrawn' | 'lapsed'
          ] ?? lastMine.status}
          .
        </p>
      )}
      {!theirs && !mine && !composing && (
        <p className="text-sm text-muted">
          Either of you can offer terms until the game ends: countries or war tokens either way, or nothing at all, and
          an accord. Nobody else learns of an offer unless it&apos;s accepted.
        </p>
      )}
      {composing && (
        <PeaceForm model={model} war={war} onFocusCountry={onFocusCountry} onDone={() => setComposing(false)} />
      )}
    </section>
  );
}

function OfferToMe({ model, war, offer }: { model: CampaignModel; war: WarView; offer: PeaceOfferView }) {
  const now = useNow(1000);
  const answer = useWarAction(model, (a: 'accept' | 'decline') =>
    api.answerPeace(model.campaign.id, war.id, offer.id, a),
  );
  const proposer = playerName(model, offer.proposerId);
  return (
    <div className="space-y-2 rounded-[3px] border border-amber/70 bg-amber/5 p-3">
      <p className="text-[0.95rem]">
        <strong>{proposer} offers peace:</strong> {termsText(model, war, offer.terms)}.
      </p>
      <p className="text-sm text-muted">
        {war.status === 'playing' ? 'Your next move in the game turns it down. ' : ''}
        {offer.respondBy ? `It lapses in ${timeLeft(Date.parse(offer.respondBy) - now)}.` : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={answer.isPending}
          onClick={() => {
            if (confirm('Accept these terms? The war ends on them at once.')) answer.mutate('accept');
          }}
        >
          Accept terms
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={answer.isPending}
          onClick={() => answer.mutate('decline')}
        >
          Turn down
        </button>
      </div>
      {answer.error && <Notice tone="error">{errorMessage(answer.error)}</Notice>}
    </div>
  );
}

function MyOffer({
  model,
  war,
  offer,
  other,
}: {
  model: CampaignModel;
  war: WarView;
  offer: PeaceOfferView;
  other: string;
}) {
  const withdraw = useWarAction(model, () => api.withdrawPeace(model.campaign.id, war.id, offer.id));
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="min-w-0 flex-1 text-[0.95rem]">
        <strong>You offered:</strong> {termsText(model, war, offer.terms)}. Waiting for {other}.
      </p>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={withdraw.isPending}
        onClick={() => withdraw.mutate(undefined)}
      >
        Withdraw
      </button>
      {withdraw.error && <Notice tone="error">{errorMessage(withdraw.error)}</Notice>}
    </div>
  );
}

/**
 * Composes peace terms: staked countries from the attacker; the target (and a country a raise put
 * in), or one cheaper country instead, from the defender; tokens one way; and an accord.
 */
function PeaceForm({
  model,
  war,
  onFocusCountry,
  onDone,
}: {
  model: CampaignModel;
  war: WarView;
  onFocusCountry(id: TerritoryId): void;
  onDone(): void;
}) {
  const me = model.me.userId;
  const attacking = war.attackerId === me;
  const otherId = attacking ? war.defenderId : war.attackerId;
  const other = playerName(model, otherId);
  const active = model.board.wars.find((w) => w.id === war.id);
  const allowed = useMemo(
    () => (active ? peaceCountries(model.board, active) : { fromAttacker: [], fromDefender: [], tribute: [] }),
    [active, model.board],
  );
  const [toDefender, setToDefender] = useState<TerritoryId[]>([]);
  const [fromDefender, setFromDefender] = useState<TerritoryId[]>([]);
  const [tribute, setTribute] = useState<TerritoryId | ''>('');
  // Positive: the viewer pays; negative: the viewer asks.
  const [tokens, setTokens] = useState(0);
  const [accord, setAccord] = useState<number | null>(null);
  const offer = useWarAction(model, (terms: PeaceTerms) => api.offerPeace(model.campaign.id, war.id, terms));
  const tokensOf = (userId: string) => model.membersById.get(userId)?.tokens ?? 0;
  const mineTokens = Math.min(tokensOf(me), PEACE_MAX_TOKENS);
  const theirTokens = Math.min(tokensOf(otherId), PEACE_MAX_TOKENS);

  const pays = tokens > 0 ? tokens : 0;
  const asks = tokens < 0 ? -tokens : 0;
  const terms: PeaceTerms = {
    toAttacker: tribute ? [tribute] : fromDefender,
    toDefender,
    tokensToAttacker: attacking ? asks : pays,
    tokensToDefender: attacking ? pays : asks,
    accordRounds: accord,
  };
  const issue = active
    ? peaceIssue(model.board, active, terms, { attacker: tokensOf(war.attackerId), defender: tokensOf(war.defenderId) })
    : 'off';
  const toggle = (list: TerritoryId[], id: TerritoryId) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  const label = (id: TerritoryId) => `${countryName(model, id)} (${model.idx.byId.get(id)?.value})`;
  const attackerName = attacking ? 'You' : playerName(model, war.attackerId);
  const defenderName = attacking ? other : 'You';
  const tokensId = useId();
  const accordId = useId();
  const tributeId = useId();

  const checkbox = (id: TerritoryId, checked: boolean, onChange: () => void) => (
    <label key={id} className="flex min-h-11 cursor-pointer items-center gap-2">
      <input type="checkbox" className="size-4 accent-amber" checked={checked} onChange={onChange} />
      <span>{label(id)}</span>
      <button type="button" className="text-sm text-muted underline" onClick={() => onFocusCountry(id)}>
        Show
      </button>
    </label>
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (issue) return;
        offer.mutate(terms, { onSuccess: onDone });
      }}
    >
      <fieldset>
        <legend className="label mb-1">
          {attackerName} hand{attacking ? '' : 's'} over, from the stake
        </legend>
        {allowed.fromAttacker.map((id) =>
          checkbox(id, toDefender.includes(id), () => setToDefender(toggle(toDefender, id))),
        )}
      </fieldset>
      <fieldset>
        <legend className="label mb-1">
          {defenderName} hand{attacking ? 's' : ''} over
        </legend>
        {allowed.fromDefender.map((id) =>
          checkbox(id, !tribute && fromDefender.includes(id), () => {
            setTribute('');
            setFromDefender(toggle(fromDefender, id));
          }),
        )}
        {allowed.tribute.length > 0 && (
          <label className="mt-1 block" htmlFor={tributeId}>
            <span className="text-sm text-muted">
              or instead one country worth less than {countryName(model, war.targetId)}:
            </span>
            <select
              id={tributeId}
              className="input mt-1"
              value={tribute}
              onChange={(e) => {
                setTribute(e.target.value);
                setFromDefender([]);
                if (e.target.value) onFocusCountry(e.target.value);
              }}
            >
              <option value="">None</option>
              {allowed.tribute.map((id) => (
                <option key={id} value={id}>
                  {label(id)}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <label htmlFor={tokensId}>
          <span className="label mb-1 block">War tokens</span>
          <select id={tokensId} className="input" value={tokens} onChange={(e) => setTokens(Number(e.target.value))}>
            <option value={0}>None</option>
            {Array.from({ length: mineTokens }, (_, i) => i + 1).map((n) => (
              <option key={`pay${n}`} value={n}>
                You pay {n}
              </option>
            ))}
            {Array.from({ length: theirTokens }, (_, i) => i + 1).map((n) => (
              <option key={`ask${n}`} value={-n}>
                {other} pays {n}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={accordId}>
          <span className="label mb-1 block">Accord</span>
          <select
            id={accordId}
            className="input"
            value={accord ?? 0}
            onChange={(e) => setAccord(Number(e.target.value) || null)}
          >
            <option value={0}>None</option>
            {Array.from({ length: ACCORD_MAX_ROUNDS - ACCORD_MIN_ROUNDS + 1 }, (_, i) => i + ACCORD_MIN_ROUNDS).map(
              (n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'round' : 'rounds'}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <p className="text-[0.95rem]">
        <span className="label mr-2">Terms</span>
        {termsText(model, war, terms)}.
      </p>
      {issue && issue !== 'off' && <p className="text-sm text-amber">{PEACE_REJECTION_MESSAGES[issue]}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-amber" disabled={issue !== null || offer.isPending}>
          Offer these terms
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
      {offer.error && <Notice tone="error">{errorMessage(offer.error)}</Notice>}
    </form>
  );
}
