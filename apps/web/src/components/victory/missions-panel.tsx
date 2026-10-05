'use client';

import {
  TITLES,
  durationText,
  effortText,
  missionName,
  partAmount,
  revealRule,
  tiebreakText,
  type ClaimView,
  type Evaluation,
  type MissionView,
  type SecretMissionSpec,
  type TerritoryId,
  type VictoryResultView,
} from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { awardKey } from '@/lib/ceremony';
import { keys } from '@/lib/queries';
import { useNow } from '@/lib/use-now';
import {
  claimTiming,
  findMission,
  hasMapView,
  pointsRace,
  progressOf,
  requirementText,
  tiebreakClause,
  titleFigureText,
  titleOf,
  victoryPlayer,
} from '@/lib/victory';
import { countryName, playerName, timeLeft } from '@/lib/wars';
import { EmpireSwatch } from '../hatch';
import { PlayerName } from '../campaign/player-name';
import { useEmpireHref, useResultsHref } from '../campaign/room-context';
import { Notice } from '../ui';
import { MissionCard, PointsBadge, ProgressParts } from './mission-card';
import { PointsCounter, ScoredStamp, useFresh, useReorderSlide } from './score-effects';
import { TitleToken } from './title-tokens';

/** What the map is asked to call out: a mission someone plays, or a secret option being weighed. */
export type MissionFocus =
  { kind: 'mission'; ownerId: string | null; key: string } | { kind: 'option'; spec: SecretMissionSpec };

interface PanelProps {
  model: CampaignModel;
  onSelectCountry(id: TerritoryId): void;
  onShowOnMap(focus: MissionFocus): void;
  onOpenWar(warId: string): void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Objectives view: the race for victory points, the viewer's secret mission, claims waiting to
 * score, and every public mission with everyone's progress. Before the war it previews the public
 * missions; between the draft and round 1 it's where secret missions are chosen; at the end it
 * shows the results.
 */
export function MissionsPanel(props: PanelProps) {
  const { model } = props;
  const { campaign } = model;
  const victory = campaign.victory;
  if (!victory) return null;
  const atWar = campaign.status === 'active' || campaign.status === 'finished';
  return (
    <div className="space-y-7 p-4">
      {campaign.status === 'finished' && victory.result && <FinalResults {...props} result={victory.result} />}
      {campaign.status === 'selection' && <SecretSelection {...props} />}
      {atWar && <PointsRace model={model} />}
      {victory.titles.length > 0 && <Titles model={model} atWar={atWar} />}
      {atWar && <MySecret {...props} />}
      {atWar && victory.claims.length > 0 && <Claims {...props} claims={victory.claims} />}
      <PublicMissions {...props} />
      {atWar && <RevealedSecrets {...props} />}
      <ScoringNote model={model} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The race

export function PointsRace({ model }: { model: CampaignModel }) {
  const victory = model.campaign.victory!;
  const empireHref = useEmpireHref(model.campaign.id);
  const winners = new Set(victory.result?.winners ?? []);
  // Ten or more points to win leave less room for names (and their title tokens): thinner marks.
  const narrow = victory.pointsToWin > 8;
  const race = pointsRace(model);
  const list = useRef<HTMLOListElement>(null);
  useReorderSlide(list, race.map((r) => r.userId).join());
  return (
    <section aria-labelledby="race-heading">
      <h2 id="race-heading" className="label mb-2">
        Victory points · first to {victory.pointsToWin}
        {victory.lastRound !== null && ` · last round ${victory.lastRound}`}
      </h2>
      <ol ref={list} className="relative space-y-2">
        {race.map(({ userId, points }) => {
          const member = model.membersById.get(userId);
          return (
            <li key={userId} data-key={userId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <PlayerName member={member} you={userId === model.me.userId} size="sm" href={empireHref(userId)} />
              </span>
              <RaceMarks
                points={points}
                toWin={victory.pointsToWin}
                narrow={narrow}
                label={`${member?.name ?? 'Player'}: ${points} of ${victory.pointsToWin} points`}
              />
              <span className="w-10 text-right font-semibold" aria-hidden="true">
                <PointsCounter value={points} delta={false} />
                {winners.has(userId) && ' ★'}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * A player's marks in the race to the points to win. Marks just won fill in one after another;
 * marks lost (a title taken away) drain to grease red and empty.
 */
function RaceMarks({
  points,
  toWin,
  narrow,
  label,
}: {
  points: number;
  toWin: number;
  narrow: boolean;
  label: string;
}) {
  const [last, setLast] = useState(points);
  const [change, setChange] = useState<{ from: number; to: number; nonce: number } | null>(null);
  if (points !== last) {
    setLast(points);
    setChange({ from: last, to: points, nonce: (change?.nonce ?? 0) + 1 });
  }
  return (
    <span className={`flex shrink-0 ${narrow ? 'gap-0.5' : 'gap-1'}`} role="img" aria-label={label}>
      {Array.from({ length: Math.max(toWin, points) }, (_, i) => {
        const gained = change !== null && i >= change.from && i < change.to;
        const lost = change !== null && i >= change.to && i < change.from;
        return (
          <span
            // A mark that changed is drawn anew, so its animation plays.
            key={gained || lost ? `${i}:${change!.nonce}` : i}
            className={`h-3.5 ${narrow ? 'w-2' : 'w-2.5'} rounded-[1px] border ${
              i < points ? 'border-amber bg-amber' : 'border-line-strong'
            } ${gained ? 'pip-fill' : lost ? 'pip-drain' : ''}`}
            style={gained ? { animationDelay: `${(i - change!.from) * 140}ms` } : undefined}
          />
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Titles

/**
 * The four titles: who holds each, their figure, and the viewer's own, with how far behind they
 * are. Before the war, what each title counts and that it comes when round 1 starts.
 */
function Titles({ model, atWar }: { model: CampaignModel; atWar: boolean }) {
  const victory = model.campaign.victory!;
  const me = model.me.userId;
  const empireHref = useEmpireHref(model.campaign.id);
  const pts = plural(victory.titlePoints, 'point');
  return (
    <section aria-labelledby="titles-heading">
      <h2 id="titles-heading" className="label mb-1">
        Titles · {pts} each
      </h2>
      <p className="mb-3 text-sm text-muted">
        {atWar
          ? `Held by whoever leads the table, and lost the moment someone passes them.`
          : `Handed to whoever leads the table when round 1 starts, and lost the moment someone passes them.`}
      </p>
      <ul className="space-y-3">
        {victory.titles.map((t) => {
          const holder = t.holderId;
          const top = holder ? (t.totals[holder] ?? 0) : null;
          const mine = t.totals[me];
          return (
            <li key={t.kind} className="flex items-start gap-3">
              <TitleToken kind={t.kind} size={36} label={false} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{TITLES[t.kind].name}</div>
                {!atWar ? (
                  <div className="text-sm text-muted">The most {TITLES[t.kind].measure}.</div>
                ) : holder ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                    <PlayerName
                      member={model.membersById.get(holder)}
                      you={holder === me}
                      size="sm"
                      href={empireHref(holder)}
                      showTitles={false}
                    />
                    <span className="text-muted tabular-nums">{titleFigureText(t.kind, top!)}</span>
                  </div>
                ) : (
                  <div className="text-sm text-muted">Nobody: the lead is shared.</div>
                )}
                {atWar && holder !== me && mine !== undefined && (
                  <div className="text-sm text-muted tabular-nums">You: {titleFigureText(t.kind, mine)}</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Secret missions

function SecretSelection({ model, onSelectCountry, onShowOnMap }: PanelProps) {
  const { campaign, isHost } = model;
  const victory = campaign.victory!;
  const mine = campaign.mySecret;
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) });
  const choose = useMutation({
    mutationFn: (optionId: string) => api.chooseSecret(campaign.id, optionId),
    onSettled: refresh,
  });
  const proceed = useMutation({ mutationFn: () => api.proceedWithoutSecrets(campaign.id), onSettled: refresh });
  const deadline = victory.selection?.deadline ? Date.parse(victory.selection.deadline) : null;
  const now = useNow(1000, deadline !== null);
  const waiting = victory.players.filter((p) => !p.ready);
  const unresolved = victory.selection?.unresolved ?? [];

  return (
    <section className="space-y-4" aria-labelledby="secret-heading">
      <div>
        <h2 id="secret-heading" className="font-stencil text-2xl tracking-wide">
          Secret missions
        </h2>
        <p className="text-[0.95rem] text-muted">
          Each player chooses one, worth {victory.secretPoints} points. Nobody else learns yours until you come within a
          step of it. Round 1 begins once everyone has chosen.
          {deadline !== null &&
            ` Anyone still choosing in ${timeLeft(deadline - now)} gets the option that fits them best.`}
        </p>
      </div>

      {mine?.options && mine.options.length > 0 && (
        <div className="space-y-3">
          <h3 className="label text-amber">Choose yours · only you can see these</h3>
          {mine.options.map((option) => (
            <MissionCard
              key={option.id}
              model={model}
              mission={{ scope: 'secret', points: victory.secretPoints, spec: option.spec }}
              onSelectCountry={onSelectCountry}
              onShowOnMap={
                hasMapView(option.spec, null) ? () => onShowOnMap({ kind: 'option', spec: option.spec }) : undefined
              }
            >
              <p className="text-sm text-muted">
                {effortText(option.spec, option.estimate)} An estimate, not a promise. {revealRule(option.spec)}
                {option.rank === 1 && <strong className="block text-paper">Best fit: yours if time runs out.</strong>}
              </p>
              <button
                type="button"
                className="btn btn-amber btn-sm mr-2"
                disabled={choose.isPending}
                onClick={() => {
                  const name = missionName(option.spec);
                  if (confirm(`Choose ${name} as your secret mission? You can’t change it later.`))
                    choose.mutate(option.id);
                }}
              >
                Choose
              </button>
            </MissionCard>
          ))}
          {choose.error && <Notice tone="error">{errorMessage(choose.error)}</Notice>}
        </div>
      )}

      {mine?.mission && (
        <div className="space-y-2">
          <h3 className="label">Your secret mission{mine.auto ? ' · assigned when time ran out' : ''}</h3>
          <MissionCard
            model={model}
            mission={mine.mission}
            highlight
            onSelectCountry={onSelectCountry}
            onShowOnMap={
              hasMapView(mine.mission.spec, null)
                ? () => onShowOnMap({ kind: 'mission', ownerId: model.me.userId, key: 'secret' })
                : undefined
            }
          >
            <p className="text-sm text-muted">{revealRule(mine.mission.spec as SecretMissionSpec)}</p>
          </MissionCard>
        </div>
      )}

      {mine && !mine.mission && (!mine.options || mine.options.length === 0) && (
        <Notice tone="amber">
          {mine.none
            ? 'You play without a secret mission: all four public missions make 8 points.'
            : 'No secret mission fits your empire. The host decides whether to go on without one; you can still win with the public missions.'}
        </Notice>
      )}

      <div>
        <h3 className="label mb-2">Ready for round 1</h3>
        <ul className="space-y-1">
          {victory.players.map((p) => (
            <li key={p.userId} className="flex min-h-9 items-center gap-2">
              <span className="min-w-0 flex-1">
                <PlayerName member={model.membersById.get(p.userId)} you={p.userId === model.me.userId} size="sm" />
              </span>
              <span className={`text-sm font-semibold ${p.ready ? 'text-paper' : 'text-muted'}`}>
                {p.ready ? 'Ready' : unresolved.includes(p.userId) ? 'Nothing fits' : 'Choosing'}
              </span>
            </li>
          ))}
        </ul>
        {waiting.length === 0 && <p className="mt-2 text-sm text-muted">Everyone is ready.</p>}
      </div>

      {unresolved.length > 0 && isHost && (
        <div className="space-y-2">
          <Notice tone="amber">
            No secret mission fits {unresolved.map((id) => playerName(model, id)).join(' and ')}. You can go on without
            one for them: they can still win with the four public missions (8 points).
          </Notice>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={proceed.isPending}
            onClick={() => {
              if (confirm('Go on without a secret mission for them? This can’t be undone.')) proceed.mutate();
            }}
          >
            Go on without their secret missions
          </button>
          {proceed.error && <Notice tone="error">{errorMessage(proceed.error)}</Notice>}
        </div>
      )}
    </section>
  );
}

function MySecret({ model, onSelectCountry, onShowOnMap }: PanelProps) {
  const mine = model.campaign.mySecret;
  const victory = model.campaign.victory!;
  if (!mine) return null;
  if (!mine.mission) {
    return mine.none ? <p className="text-[0.95rem] text-muted">You play without a secret mission.</p> : null;
  }
  const scored = victoryPlayer(model, model.me.userId)?.awards.some((a) => a.missionKey === 'secret');
  const progress = mine.progress;
  return (
    <section aria-labelledby="my-secret-heading" className="space-y-2">
      <h2 id="my-secret-heading" className="label">
        Your secret mission · {mine.revealed ? 'revealed to everyone' : 'only you can see it'}
      </h2>
      <MissionCard
        model={model}
        mission={mine.mission}
        highlight
        held={new Set(progress?.evidence.territories ?? [])}
        stamp={scored && <AwardStamp model={model} userId={model.me.userId} missionKey="secret" />}
        onSelectCountry={onSelectCountry}
        onShowOnMap={
          hasMapView(mine.mission.spec, progress)
            ? () => onShowOnMap({ kind: 'mission', ownerId: model.me.userId, key: 'secret' })
            : undefined
        }
      >
        {scored ? (
          <p className="font-semibold text-amber">Scored: {victory.secretPoints} points.</p>
        ) : (
          progress && (
            <>
              <ProgressParts parts={progress.parts} label="Your progress" />
              {!mine.revealed && (
                <p className="text-sm text-muted">
                  {progress.near ? 'One step away: it will be revealed. ' : ''}
                  {revealRule(mine.mission.spec as SecretMissionSpec)}
                </p>
              )}
            </>
          )
        )}
      </MissionCard>
    </section>
  );
}

function RevealedSecrets({ model, onSelectCountry, onShowOnMap }: PanelProps) {
  const others = model.campaign.victory!.players.filter((p) => p.secret && p.userId !== model.me.userId);
  if (others.length === 0) return null;
  return (
    <section aria-labelledby="revealed-heading" className="space-y-2">
      <h2 id="revealed-heading" className="label">
        Revealed secret missions
      </h2>
      {others.map((p) => {
        const progress = p.progress.secret;
        const scored = p.awards.some((a) => a.missionKey === 'secret');
        return (
          <div key={p.userId} className="space-y-1.5">
            <PlayerName member={model.membersById.get(p.userId)} size="sm" />
            <MissionCard
              model={model}
              mission={p.secret!.mission}
              held={new Set(progress?.evidence.territories ?? [])}
              stamp={scored && <AwardStamp model={model} userId={p.userId} missionKey="secret" />}
              onSelectCountry={onSelectCountry}
              onShowOnMap={
                hasMapView(p.secret!.mission.spec, progress)
                  ? () => onShowOnMap({ kind: 'mission', ownerId: p.userId, key: 'secret' })
                  : undefined
              }
            >
              <p className="text-xs text-muted">
                {p.secret!.reason === 'final'
                  ? 'Revealed when the campaign ended.'
                  : `Revealed in round ${p.secret!.revealedRound}${p.secret!.reason === 'claim' ? ', when completed' : ', one step from completion'}.`}
              </p>
              {scored ? (
                <p className="font-semibold">Scored.</p>
              ) : (
                progress && <ProgressParts parts={progress.parts} label={`${playerName(model, p.userId)}’s progress`} />
              )}
            </MissionCard>
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Claims

function Claims({ model, claims, onOpenWar, onShowOnMap }: PanelProps & { claims: ClaimView[] }) {
  const now = useNow(1000, true);
  const me = model.me.userId;
  const sorted = [...claims].sort((a, b) => Number(b.userId === me) - Number(a.userId === me) || a.id - b.id);
  return (
    <section aria-labelledby="claims-heading" className="space-y-2">
      <h2 id="claims-heading" className="label text-amber">
        Claims waiting to score
      </h2>
      <p className="text-sm text-muted">
        {model.campaign.victory?.hold === 'turns'
          ? 'A claim scores once the round after next has started and everyone has had their turns to declare war in a round since it began, if no war could still break it then.'
          : 'A claim scores once it has been held through the next full round and the holding time, if no war could still break it then.'}{' '}
        Break the position first and it doesn’t score.
      </p>
      <ul className="space-y-2">
        {sorted.map((claim) => {
          const played = findMission(model, claim.userId, claim.missionKey);
          const timing = claimTiming(model, claim, now);
          const mine = claim.userId === me;
          return (
            <li key={claim.id} className={`rounded-[3px] border p-3 ${mine ? 'border-amber/60' : 'border-grease/50'}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <EmpireSwatch color={model.membersById.get(claim.userId)?.color ?? 0} size={14} />
                    <span className="font-semibold">
                      {mine ? 'You claim' : `${playerName(model, claim.userId)} claims`}{' '}
                      {played ? titleOf(played.mission) : 'a mission'}
                    </span>
                  </div>
                  {played && <p className="mt-1 text-sm text-muted">{requirementText(model, played.mission.spec)}</p>}
                  <p className="mt-1 text-sm">
                    {timing.round} {timing.hold ?? timing.held}
                  </p>
                  {timing.blockers.length > 0 && (
                    <p className="mt-1 text-sm text-[#ef7b72]">
                      Waiting on{' '}
                      {timing.blockers.map((w, i) => (
                        <span key={w.id}>
                          {i > 0 && ', '}
                          <button
                            type="button"
                            className="underline underline-offset-2"
                            onClick={() => onOpenWar(w.id)}
                          >
                            the war for {countryName(model, w.targetId)}
                          </button>
                        </span>
                      ))}
                      , which could still break it.
                    </p>
                  )}
                  <p className="mt-1 text-sm text-muted">
                    {mine ? 'Keep it held.' : 'Break the position before then to stop it.'} Claimed in round{' '}
                    {claim.startedRound}.
                  </p>
                </div>
                {played && <PointsBadge points={played.mission.points} />}
              </div>
              {played && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-2"
                  onClick={() => onShowOnMap({ kind: 'mission', ownerId: claim.userId, key: claim.missionKey })}
                >
                  Show on map
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Public missions

/** Where a player stands on a public mission, in a line. */
function standingLine(model: CampaignModel, userId: string, key: string, progress: Evaluation | undefined): string {
  const player = victoryPlayer(model, userId);
  const award = player?.awards.find((a) => a.missionKey === key);
  if (award) return `Scored in round ${award.round}`;
  const claim = model.campaign.victory?.claims.find((c) => c.userId === userId && c.missionKey === key);
  if (claim) return `Claimed: can score in round ${claim.eligibleRound}`;
  if (!progress) return '';
  return progress.parts.map((p) => `${p.label} ${partAmount(p, p.have)}/${partAmount(p, p.need)}`).join(' · ');
}

function PublicMissions({ model, onSelectCountry, onShowOnMap }: PanelProps) {
  const { campaign } = model;
  const victory = campaign.victory!;
  const me = model.me.userId;
  const atWar = campaign.status === 'active' || campaign.status === 'finished';
  return (
    <section aria-labelledby="public-heading" className="space-y-3">
      <div>
        <h2 id="public-heading" className="label">
          Public missions · {victory.publicPoints} points each
        </h2>
        <p className="text-sm text-muted">
          Everyone can score each of these once; someone else scoring one takes nothing from you.
          {campaign.status === 'draft' && ' Countries you draft count, but a claim can only start when round 1 begins.'}
        </p>
      </div>
      {victory.publicMissions.map((mission: MissionView) => {
        const mine = progressOf(model, me, mission.key);
        const scored = victoryPlayer(model, me)?.awards.some((a) => a.missionKey === mission.key) ?? false;
        return (
          <MissionCard
            key={mission.key}
            model={model}
            mission={mission}
            held={new Set(mine?.evidence.territories ?? [])}
            stamp={scored && <AwardStamp model={model} userId={me} missionKey={mission.key} />}
            onSelectCountry={onSelectCountry}
            onShowOnMap={
              hasMapView(mission.spec, mine)
                ? () => onShowOnMap({ kind: 'mission', ownerId: null, key: mission.key })
                : undefined
            }
          >
            {atWar && mine && !scored && <ProgressParts parts={mine.parts} label="Your progress" />}
            {atWar && (
              <ul className="space-y-1 border-t border-line pt-2" aria-label="Everyone’s standing">
                {victory.players.map((p) => (
                  <li key={p.userId} className="flex items-baseline gap-2 text-sm">
                    <EmpireSwatch color={model.membersById.get(p.userId)?.color ?? 0} size={11} className="shrink-0" />
                    <span className="w-20 shrink-0 truncate font-semibold">
                      {p.userId === me ? 'You' : playerName(model, p.userId)}
                    </span>
                    <span className="min-w-0 flex-1 text-muted">
                      {standingLine(model, p.userId, mission.key, p.progress[mission.key])}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </MissionCard>
        );
      })}
      {victory.publicMissions.length === 0 && <p className="text-muted">No public missions yet.</p>}
    </section>
  );
}

/** "Scored" on a mission card, coming down hard if the points were won a moment ago. */
function AwardStamp({ model, userId, missionKey }: { model: CampaignModel; userId: string; missionKey: string }) {
  const fresh = useFresh(awardKey(model.campaign.id, userId, missionKey));
  return <ScoredStamp fresh={fresh} />;
}

function ScoringNote({ model }: { model: CampaignModel }) {
  const v = model.campaign.victory!;
  return (
    <section className="rounded-[3px] border border-line p-3 text-sm text-muted">
      <h2 className="label mb-1">How points work</h2>
      <p>
        Public missions are worth {v.publicPoints} points each and your secret mission {v.secretPoints}; the first to{' '}
        {v.pointsToWin} wins
        {v.titles.length > 0
          ? `. Each of the ${v.titles.length} titles is worth ${plural(v.titlePoints, 'point')} while you hold it: they're the only points that can be taken away.`
          : ' (two public missions and the secret, or all four public ones). Points are never taken away.'}{' '}
        {v.hold === 'turns'
          ? 'A position scores only once the round after next has started and every player has had their turns to declare war in a round since it was completed.'
          : `A position scores only after it has been held through the next full round and at least ${durationText(v.holdMs)} after that round starts.`}{' '}
        Players who cross the line together are ranked by points; equal points share the victory.
        {v.lastRound !== null &&
          ` If nobody has ${v.pointsToWin} when round ${v.lastRound} ends, the most points win, then ${tiebreakText(v.tiebreak)}.`}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The end

function FinalResults({ model, result }: PanelProps & { result: VictoryResultView }) {
  const victory = model.campaign.victory!;
  const resultsHref = useResultsHref(model.campaign.id);
  const names = result.winners.map((id) => playerName(model, id));
  const headline =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)} share the victory` : `${names[0]} wins`;
  const iWon = result.winners.includes(model.me.userId);
  const [first] = result.standings;
  const how = result.seasonEnd
    ? `Nobody reached ${victory.pointsToWin} points by the end of round ${result.round}, the last, so the most points won${tiebreakClause(result)}. `
    : iWon && names.length === 1
      ? `You reached ${first?.points ?? 0} points. `
      : '';
  return (
    <section aria-labelledby="results-heading" className="space-y-4">
      <div className="rounded-[3px] border border-amber/70 bg-amber/10 p-4">
        <div className="label text-amber">
          Campaign over · round {result.round}
          {result.seasonEnd && ', the last'}
        </div>
        <h2 id="results-heading" className="font-stencil text-3xl leading-tight tracking-wide">
          {iWon && names.length === 1 ? 'Victory' : headline}
        </h2>
        <p className="text-[0.95rem]">
          {how}
          The map shows the empires as they ended. Every secret mission is now revealed.
        </p>
        <Link href={resultsHref} className="btn btn-amber btn-sm mt-3">
          See the results
        </Link>
      </div>
      <table className="w-full text-[0.95rem]">
        <thead>
          <tr className="text-left">
            <th className="label w-full pb-1 font-bold">Player</th>
            <th className="label pb-1 pl-2 text-right font-bold">
              <abbr title="Victory points" className="no-underline">
                VP
              </abbr>
            </th>
            <th className="label pb-1 pl-3 text-right font-bold">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {result.standings.map((s) => (
            <tr key={s.userId}>
              <td className="max-w-0 py-1.5">
                <PlayerName member={model.membersById.get(s.userId)} you={s.userId === model.me.userId} size="sm" />
                <span className="block pl-6 text-xs text-muted">
                  {plural(s.countries, 'country', 'countries')}
                  {result.winners.includes(s.userId) ? ' · winner' : ''}
                </span>
              </td>
              <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{s.points}</td>
              <td className="py-1.5 pl-3 text-right tabular-nums">{s.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
