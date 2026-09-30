'use client';

import {
  ACCORD_DEFAULT_ROUNDS,
  ACCORD_MAX_ROUNDS,
  ACCORD_MIN_ROUNDS,
  ACCORD_TERMS_MAX,
  PROPOSAL_REJECTION_MESSAGES,
  REPUTATION_BROKEN,
  accordEndsRound,
  checkProposal,
  cleanText,
  diplomacyOpen,
  firstSignedRound,
  isPartyTo,
  partnerIn,
  renunciationAgainst,
  reputationForKeeping,
  truceBetween,
  type AccordView,
} from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys } from '@/lib/queries';
import { useNow } from '@/lib/use-now';
import { playerName, timeLeft } from '@/lib/wars';
import { PlayerName } from '../campaign/player-name';
import { useEmpireHref } from '../campaign/room-context';
import { Notice, useSpotlight } from '../ui';

const roundsText = (n: number) => `${n} ${n === 1 ? 'round' : 'rounds'}`;

/** What keeping an accord of `rounds` with `partnerId`, signed now, earns each of you, in words. */
function keepingText(model: CampaignModel, rounds: number, partnerId: string | null): string {
  const inForce = partnerId ? model.accordWith.get(partnerId) : undefined;
  const since = inForce ? firstSignedRound(inForce, model.campaign.accords) : null;
  const earns = reputationForKeeping(model.campaign.round, rounds, since);
  return earns > 0
    ? `Kept to the end, it earns you both ${earns} reputation.`
    : 'It earns no reputation: that comes with each whole round an accord holds.';
}

/** Accords: proposals to answer, the viewer's accords and proposals, a way to propose, and every empire's standing. */
export function AccordsView({
  model,
  focusId,
  spotlight,
  onOpenChat,
}: {
  model: CampaignModel;
  /** An accord to bring into view, e.g. from a notification. */
  focusId: string | null;
  /** A proposal to call out, with a new nonce each time. */
  spotlight?: { id: string; nonce: number } | null;
  onOpenChat(userId: string): void;
}) {
  const { campaign } = model;
  const me = model.me.userId;
  const open = diplomacyOpen(campaign.status);
  const [partner, setPartner] = useState('');
  const formRef = useRef<HTMLElement>(null);
  const propose = (userId: string) => {
    setPartner(userId);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const myAccords = [...model.accordWith.values()];
  const myProposals = campaign.accords.filter((a) => a.status === 'proposed' && a.proposerId === me);
  // Proposals of mine turned down this round, so I can see how they were answered.
  const turnedDown = campaign.accords.filter(
    (a) => a.proposerId === me && (a.status === 'declined' || a.status === 'lapsed') && a.endedRound === campaign.round,
  );
  const others = model.accordsInForce.filter((a) => !isPartyTo(a, me));

  return (
    <div className="h-full space-y-6 overflow-y-auto p-4">
      {!open && (
        <Notice>
          {campaign.status === 'lobby'
            ? 'Accords open once the draft begins. Until then, talk it over in Dispatches or Messages.'
            : 'The campaign is over, so no more accords can be signed.'}
        </Notice>
      )}

      {model.proposalsToMe.length > 0 && (
        <section className="space-y-2">
          <h2 className="label text-amber">Waiting for your answer</h2>
          {model.proposalsToMe.map((a) => (
            <Focusable
              key={a.id}
              focused={a.id === focusId}
              spotlight={spotlight?.id === a.id ? spotlight.nonce : null}
              label={`${playerName(model, a.proposerId)}’s proposal`}
            >
              <ProposalToMe model={model} accord={a} />
            </Focusable>
          ))}
        </section>
      )}

      {myAccords.length > 0 && (
        <section className="space-y-2">
          <h2 className="label">Your accords</h2>
          {myAccords.map((a) => (
            <Focusable key={a.id} focused={a.id === focusId}>
              <MyAccord
                model={model}
                accord={a}
                renewing={model.proposalWith.has(partnerIn(a, me))}
                onRenew={() => propose(partnerIn(a, me))}
              />
            </Focusable>
          ))}
        </section>
      )}

      {(myProposals.length > 0 || turnedDown.length > 0) && (
        <section className="space-y-2">
          <h2 className="label">Your proposals</h2>
          {myProposals.map((a) => (
            <Focusable key={a.id} focused={a.id === focusId}>
              <MyProposal model={model} accord={a} />
            </Focusable>
          ))}
          {turnedDown.map((a) => (
            <p key={a.id} className="text-[0.95rem] text-muted">
              {a.status === 'declined'
                ? `${playerName(model, a.recipientId)} declined your proposal.`
                : `${playerName(model, a.recipientId)} didn't answer your proposal in time.`}
            </p>
          ))}
        </section>
      )}

      {open && (
        <section ref={formRef}>
          <h2 className="label mb-2">Propose an accord</h2>
          <ProposeForm model={model} partner={partner} onPartner={setPartner} />
        </section>
      )}

      <Empires model={model} onMessage={onOpenChat} onPropose={open ? propose : undefined} />

      {others.length > 0 && (
        <section>
          <h2 className="label mb-2">Other accords in force</h2>
          <ul className="space-y-1.5">
            {others.map((a) => (
              <li key={a.id} className="rounded-[3px] border border-line px-3 py-2 text-[0.95rem]">
                <Focusable focused={a.id === focusId}>
                  <span className="font-semibold">
                    {playerName(model, a.proposerId)} and {playerName(model, a.recipientId)}
                  </span>
                  <span className="text-muted"> · no war until round {a.endsRound}</span>
                  {a.terms && <Terms>{a.terms}</Terms>}
                </Focusable>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Scrolls itself into view and glows when a notification or link points at it, and lights up
 * whenever `spotlight` changes (the header's "Answer needed").
 */
function Focusable({
  focused,
  spotlight,
  label,
  children,
}: {
  focused: boolean;
  spotlight?: number | null;
  label?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focused]);
  useSpotlight(ref, spotlight);
  return (
    <div
      ref={ref}
      tabIndex={spotlight === undefined ? undefined : -1}
      role={label ? 'group' : undefined}
      aria-label={label}
      className={`rounded-[4px] ${focused ? 'ring-2 ring-amber/70 ring-offset-2 ring-offset-gunmetal' : ''}`}
    >
      {children}
    </div>
  );
}

function Terms({ children }: { children: ReactNode }) {
  return (
    <blockquote className="mt-1 border-l-2 border-paper/40 pl-2 text-[0.95rem] break-words whitespace-pre-wrap text-muted italic">
      “{children}”
    </blockquote>
  );
}

function useAccordAction<T>(model: CampaignModel, run: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(model.campaign.id) }),
  });
}

function Countdown({ respondBy, who, silence }: { respondBy: string; who: string; silence: string }) {
  const now = useNow(1000);
  return (
    <p className="text-sm text-muted">
      {who} <strong className="text-paper tabular-nums">{timeLeft(Date.parse(respondBy) - now)}</strong> to answer.
      Without an answer, {silence}.
    </p>
  );
}

function ProposalToMe({ model, accord }: { model: CampaignModel; accord: AccordView }) {
  const answer = useAccordAction(model, (a: 'accept' | 'decline') => api.answerAccord(model.campaign.id, accord.id, a));
  const proposer = playerName(model, accord.proposerId);
  const renewal = model.accordWith.has(accord.proposerId);
  const ends = accordEndsRound(model.campaign.round, accord.rounds);
  return (
    <article className="space-y-3 rounded-[3px] border border-amber/70 bg-amber/5 p-3">
      <div className="font-stencil text-xl tracking-wide text-amber">
        {proposer} proposes {renewal ? 'renewing your accord' : 'an accord'}
      </div>
      <p className="text-[0.95rem]">
        No war between you for {roundsText(accord.rounds)}: signed now, it holds until round {ends} starts.
        {renewal && ' It replaces the accord you have now.'} {keepingText(model, accord.rounds, accord.proposerId)}
      </p>
      {accord.terms && <Terms>{accord.terms}</Terms>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-amber flex-1"
          disabled={answer.isPending}
          onClick={() => answer.mutate('accept')}
        >
          Sign accord
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={answer.isPending}
          onClick={() => answer.mutate('decline')}
        >
          Decline
        </button>
      </div>
      {accord.respondBy && <Countdown respondBy={accord.respondBy} who="You have" silence="the proposal lapses" />}
      {answer.error && <Notice tone="error">{errorMessage(answer.error)}</Notice>}
    </article>
  );
}

function MyProposal({ model, accord }: { model: CampaignModel; accord: AccordView }) {
  const withdraw = useAccordAction(model, () => api.withdrawAccord(model.campaign.id, accord.id));
  const recipient = playerName(model, accord.recipientId);
  return (
    <article className="space-y-2 rounded-[3px] border border-line-strong p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="label block">To</span>
          <PlayerName member={model.membersById.get(accord.recipientId)} />
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={withdraw.isPending}
          onClick={() => withdraw.mutate(undefined)}
        >
          Withdraw
        </button>
      </div>
      <p className="text-[0.95rem]">No war between you for {roundsText(accord.rounds)}.</p>
      {accord.terms && <Terms>{accord.terms}</Terms>}
      {accord.respondBy && (
        <Countdown respondBy={accord.respondBy} who={`${recipient} has`} silence="the proposal lapses" />
      )}
      {withdraw.error && <Notice tone="error">{errorMessage(withdraw.error)}</Notice>}
    </article>
  );
}

function MyAccord({
  model,
  accord,
  renewing,
  onRenew,
}: {
  model: CampaignModel;
  accord: AccordView;
  /** A proposal between the partners is already waiting. */
  renewing: boolean;
  onRenew(): void;
}) {
  const renounce = useAccordAction(model, () => api.renounceAccord(model.campaign.id, accord.id));
  const partnerId = partnerIn(accord, model.me.userId);
  const partner = playerName(model, partnerId);
  const round = model.campaign.round;
  const left = (accord.endsRound ?? round) - round;
  return (
    <article className="space-y-2 rounded-[3px] border border-paper/40 p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="label block">Accord with</span>
          <PlayerName member={model.membersById.get(partnerId)} />
        </span>
      </div>
      <p className="text-[0.95rem]">
        No war between you until round {accord.endsRound} starts
        {left === 1 ? ': this is its last round.' : '.'}{' '}
        <span className="text-muted">Signed in round {accord.signedRound}.</span>
      </p>
      {accord.terms && <Terms>{accord.terms}</Terms>}
      {/* Once the campaign is over, accords can be neither renewed nor broken. */}
      {diplomacyOpen(model.campaign.status) && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={renewing} onClick={onRenew}>
            {renewing ? 'Renewal proposed' : 'Renew'}
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm ml-auto"
            disabled={renounce.isPending}
            onClick={() => {
              const question =
                `Renounce your accord with ${partner}? It ends now and everyone is told. Your reputation drops by ` +
                `${-REPUTATION_BROKEN}, and you can't declare war on ${partner} until round ${round + 1} starts.`;
              if (confirm(question)) renounce.mutate(undefined);
            }}
          >
            Renounce
          </button>
        </div>
      )}
      {renounce.error && <Notice tone="error">{errorMessage(renounce.error)}</Notice>}
    </article>
  );
}

function ProposeForm({
  model,
  partner,
  onPartner,
}: {
  model: CampaignModel;
  partner: string;
  onPartner(userId: string): void;
}) {
  const { campaign } = model;
  const me = model.me.userId;
  const [rounds, setRounds] = useState(ACCORD_DEFAULT_ROUNDS);
  const [terms, setTerms] = useState('');
  const ids = { partner: useId(), rounds: useId(), terms: useId() };
  const queryClient = useQueryClient();
  const send = useMutation({
    mutationFn: () => api.proposeAccord(campaign.id, { partnerId: partner, rounds, terms: cleanText(terms) }),
    onSuccess: () => {
      setTerms('');
      onPartner('');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) }),
  });

  // The confirmation only needs a moment on screen.
  const { isSuccess, reset } = send;
  useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(reset, 5000);
    return () => clearTimeout(timer);
  }, [isSuccess, reset]);

  const others = campaign.members.filter((m) => m.userId !== me);
  const rejection = partner
    ? checkProposal(
        { status: campaign.status, memberIds: campaign.members.map((m) => m.userId), accords: campaign.accords },
        me,
        partner,
        rounds,
        cleanText(terms),
      )
    : null;
  const renewal = partner ? model.accordWith.get(partner) : undefined;

  return (
    <form
      className="space-y-3 rounded-[3px] border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (partner && !rejection) send.mutate();
      }}
    >
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label htmlFor={ids.partner} className="min-w-0">
          <span className="label mb-1 block">With</span>
          <select
            id={ids.partner}
            className="input"
            value={partner}
            onChange={(e) => {
              onPartner(e.target.value);
              send.reset();
            }}
          >
            <option value="">Choose a player</option>
            {others.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
                {model.accordWith.has(m.userId) ? ' (renew)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.rounds}>
          <span className="label mb-1 block">Length</span>
          <select
            id={ids.rounds}
            className="input w-32"
            value={rounds}
            onChange={(e) => setRounds(Number(e.target.value))}
          >
            {Array.from({ length: ACCORD_MAX_ROUNDS - ACCORD_MIN_ROUNDS + 1 }, (_, i) => ACCORD_MIN_ROUNDS + i).map(
              (n) => (
                <option key={n} value={n}>
                  {roundsText(n)}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <p className="text-sm text-muted">
        Signed now, it holds until round {accordEndsRound(campaign.round, rounds)} starts. Neither of you can declare
        war on the other while it holds.
        {renewal && ` It replaces your accord with ${playerName(model, partner)}.`}{' '}
        {keepingText(model, rounds, partner || null)}
      </p>
      <label htmlFor={ids.terms} className="block">
        <span className="label mb-1 block">Terms (optional)</span>
        <textarea
          id={ids.terms}
          className="input min-h-20 resize-y py-2 leading-snug"
          maxLength={ACCORD_TERMS_MAX}
          value={terms}
          placeholder="Anything you both agree to. Everyone can read it; the game doesn't enforce it."
          onChange={(e) => setTerms(e.target.value)}
        />
        {terms.length > ACCORD_TERMS_MAX - 40 && (
          <span className="block text-right text-xs text-muted tabular-nums">
            {terms.length} / {ACCORD_TERMS_MAX}
          </span>
        )}
      </label>
      {rejection && <p className="text-sm text-muted">{PROPOSAL_REJECTION_MESSAGES[rejection]}</p>}
      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={!partner || rejection !== null || send.isPending}
      >
        {send.isPending ? 'Proposing…' : 'Propose accord'}
      </button>
      {send.isSuccess && <Notice>Proposal sent. It lapses if nobody answers in time.</Notice>}
      {send.error && <Notice tone="error">{errorMessage(send.error)}</Notice>}
    </form>
  );
}

/** Every empire's reputation, and where each stands with the viewer. */
function Empires({
  model,
  onMessage,
  onPropose,
}: {
  model: CampaignModel;
  onMessage(userId: string): void;
  onPropose?: (userId: string) => void;
}) {
  const me = model.me.userId;
  const empireHref = useEmpireHref(model.campaign.id);
  const rows = [...model.campaign.members].sort((a, b) => b.reputation - a.reputation || a.name.localeCompare(b.name));
  const standing = (userId: string): string | null => {
    const accord = model.accordWith.get(userId);
    if (accord) return `Accord until round ${accord.endsRound}`;
    const truce = truceBetween(model.board, me, userId);
    if (truce) return `Truce until round ${truce.endsRound}`;
    const waiting = model.proposalWith.get(userId);
    if (waiting) return waiting.proposerId === me ? 'Your proposal is waiting' : 'Proposes an accord';
    if (renunciationAgainst(model.board, me, userId)) return 'You broke your accord';
    if (renunciationAgainst(model.board, userId, me)) return 'Broke your accord';
    return null;
  };
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="label">Empires</h2>
        <span className="label">Reputation</span>
      </div>
      <ul className="divide-y divide-line rounded-[3px] border border-line">
        {rows.map((m) => {
          const note = m.userId === me ? null : standing(m.userId);
          const canPropose = onPropose && !model.proposalWith.has(m.userId) && !model.accordWith.has(m.userId);
          return (
            <li key={m.userId} className="px-3 py-2">
              <div className="flex min-h-8 items-center gap-2">
                <span className="min-w-0 flex-1">
                  <PlayerName member={m} you={m.userId === me} size="sm" href={empireHref(m.userId)} />
                </span>
                <span className="shrink-0 text-lg font-semibold tabular-nums">{m.reputation}</span>
              </div>
              {m.userId !== me && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-6">
                  {note && <span className="min-w-0 flex-1 text-sm text-muted">{note}</span>}
                  <span className="ml-auto flex shrink-0 gap-1.5">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMessage(m.userId)}>
                      Message
                    </button>
                    {canPropose && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPropose(m.userId)}>
                        Propose
                      </button>
                    )}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
