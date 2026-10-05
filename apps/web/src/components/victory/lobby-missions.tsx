'use client';

import {
  HOLD_MINUTE_OPTIONS,
  LAST_ROUND_OPTIONS,
  SELECTION_MINUTE_OPTIONS,
  durationText,
  holdMs,
  isLongMission,
  kindName,
  missionRules,
  missionSummary,
  missionTargets,
  publicMissionIssue,
  selectionMs,
  tiebreakText,
  type PublicMissionKind,
  type TerritoryId,
  type VictoryMode,
} from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys } from '@/lib/queries';
import { Notice } from '../ui';
import { MissionCard } from './mission-card';
import type { MissionFocus } from './missions-panel';

/** The presets, plus the value set now if it isn't one of them (set under the other pace). */
const withCurrent = (presets: readonly number[], current: number | null) =>
  current === null || presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);

const MODES: { value: VictoryMode; title: string; body: string }[] = [
  {
    value: 'objectives',
    title: 'Objectives',
    body: 'Four public missions and a secret one for each player. The first to 7 victory points wins, or the most points when the last round ends.',
  },
  { value: 'open', title: 'Open-ended', body: 'No fixed end: play for as long as the group likes.' },
];

/**
 * How the campaign is won, in the lobby: the victory mode, the four public missions with their
 * targets (the host can pick others or draw new targets), and the holding and choosing times.
 * Everything here locks when the draft starts.
 */
export function LobbyMissions({
  model,
  onSaveRules,
  onSelectCountry,
  onShowOnMap,
}: {
  model: CampaignModel;
  onSaveRules(rules: Record<string, unknown>): void;
  onSelectCountry(id: TerritoryId): void;
  onShowOnMap(focus: MissionFocus): void;
}) {
  const { campaign, isHost } = model;
  const { rules } = campaign;
  const victory = campaign.victory;
  const cfg = missionRules(rules.victory.version);
  const modeName = useId();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) });
  const [picking, setPicking] = useState<PublicMissionKind[] | null>(null);
  const reroll = useMutation({
    mutationFn: (slot: number) => api.rerollMission(campaign.id, slot),
    onSettled: refresh,
  });
  const choose = useMutation({
    mutationFn: (kinds: PublicMissionKind[]) => api.setPublicMissions(campaign.id, kinds),
    onSuccess: () => setPicking(null),
    onSettled: refresh,
  });
  const random = useMutation({ mutationFn: () => api.randomMissions(campaign.id), onSettled: refresh });
  const missions = victory?.publicMissions ?? [];
  const players = campaign.members.length;
  const pace = rules.war.pace;
  const lastRound = rules.victory.lastRound;
  const error = reroll.error ?? choose.error ?? random.error;

  return (
    <section aria-labelledby="victory-heading">
      <h2 id="victory-heading" className="label mb-2">
        Victory{isHost ? '' : ' · set by the host'}
      </h2>
      <div className="space-y-4 rounded-[3px] border border-line p-3">
        <fieldset className="space-y-1">
          <legend className="sr-only">Victory mode</legend>
          {MODES.map((mode) => (
            <label key={mode.value} className="flex cursor-pointer gap-3 rounded-[3px] p-2 hover:bg-raised/60">
              <input
                type="radio"
                name={modeName}
                className="mt-1 size-4 accent-amber"
                checked={rules.victory.mode === mode.value}
                disabled={!isHost}
                onChange={() => onSaveRules({ victory: { mode: mode.value } })}
              />
              <span>
                <span className="block font-semibold">{mode.title}</span>
                <span className="block text-sm text-muted">{mode.body}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {victory && (
          <>
            <p className="text-[0.95rem]">
              Public missions are worth {cfg.points.public} points each, and everyone can score every one. After the
              draft each player privately picks a secret mission worth {cfg.points.secret}.{' '}
              {cfg.titles
                ? `Four titles worth ${cfg.titles.points} each go to whoever leads on population, land, GDP and military might, and move with the lead; mission points are never lost. The first to ${cfg.points.toWin} wins.`
                : `Points are never lost; the first to ${cfg.points.toWin} wins.`}{' '}
              A completed position scores once it has been held through the next full round and{' '}
              {durationText(holdMs(rules))} after that round starts.{' '}
              {lastRound !== null
                ? `If nobody has ${cfg.points.toWin} when round ${lastRound} ends, the most points win, then ${tiebreakText(rules.victory.tiebreak)}.`
                : 'There is no last round: the campaign goes on until someone reaches it.'}
            </p>

            {missions.length < cfg.publicCount && (
              <Notice tone="amber">
                This map fits only {missions.length} of the {cfg.publicCount} public missions.{' '}
                {isHost ? 'Choose others before starting the draft.' : 'The host has to choose others.'}
              </Notice>
            )}

            <div className="space-y-3">
              {missions.map((mission, slot) => {
                const issue = publicMissionIssue(mission.spec.kind as PublicMissionKind, model.idx, rules, players);
                return (
                  <MissionCard
                    key={mission.key}
                    model={model}
                    mission={mission}
                    onSelectCountry={onSelectCountry}
                    onShowOnMap={
                      missionTargets(mission.spec).length > 0
                        ? () => onShowOnMap({ kind: 'mission', ownerId: null, key: mission.key })
                        : undefined
                    }
                  >
                    {issue && (
                      <Notice tone="amber">
                        {issue} {isHost ? 'Swap it for another before starting the draft.' : 'The host has to swap it.'}
                      </Notice>
                    )}
                    {isHost &&
                      ['regional_power', 'strategic_positions', 'great_connection'].includes(mission.spec.kind) && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm mr-2"
                          disabled={reroll.isPending}
                          onClick={() => reroll.mutate(slot)}
                        >
                          New targets
                        </button>
                      )}
                  </MissionCard>
                );
              })}
            </div>

            {isHost && picking === null && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPicking(missions.map((m) => m.spec.kind as PublicMissionKind))}
                >
                  Change missions
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={random.isPending}
                  onClick={() => random.mutate()}
                >
                  Random missions
                </button>
              </div>
            )}
            {isHost && picking !== null && (
              <fieldset className="space-y-2 rounded-[3px] border border-line-strong p-3">
                <legend className="px-1 font-semibold">
                  Choose {cfg.publicCount} public missions ({picking.length} chosen)
                </legend>
                {cfg.publicKinds.map((kind) => {
                  const issue = publicMissionIssue(kind, model.idx, rules, players);
                  const checked = picking.includes(kind);
                  return (
                    <label
                      key={kind}
                      className={`flex gap-3 rounded-[3px] p-2 ${issue ? 'opacity-60' : 'cursor-pointer hover:bg-raised/60'}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-amber"
                        checked={checked}
                        disabled={Boolean(issue) || (!checked && picking.length >= cfg.publicCount)}
                        onChange={() => setPicking(checked ? picking.filter((k) => k !== kind) : [...picking, kind])}
                      />
                      <span>
                        <span className="block font-semibold">
                          {kindName(kind, cfg)}
                          {isLongMission(kind, cfg) ? (
                            <span className="ml-2 text-xs text-muted uppercase">Long campaign</span>
                          ) : null}
                        </span>
                        <span className="block text-sm text-muted">{issue ?? missionSummary(kind, cfg)}</span>
                      </span>
                    </label>
                  );
                })}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={picking.length !== cfg.publicCount || choose.isPending}
                    onClick={() => choose.mutate(picking)}
                  >
                    Use these {cfg.publicCount}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(null)}>
                    Cancel
                  </button>
                </div>
                <p className="text-xs text-muted">
                  Each mission gets fresh targets from this map.
                  {cfg.longDrawn < cfg.publicCount &&
                    ` Random missions take at most ${cfg.longDrawn === 1 ? 'one' : cfg.longDrawn} marked Long campaign.`}
                </p>
              </fieldset>
            )}

            <div className="space-y-2">
              <label className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-[0.95rem]">Last round</span>
                <select
                  className="input w-36"
                  value={lastRound ?? ''}
                  disabled={!isHost}
                  onChange={(e) =>
                    onSaveRules({ victory: { lastRound: e.target.value ? Number(e.target.value) : null } })
                  }
                >
                  {withCurrent(LAST_ROUND_OPTIONS, lastRound).map((r) => (
                    <option key={r} value={r}>
                      Round {r}
                    </option>
                  ))}
                  <option value="">No last round</option>
                </select>
              </label>
              <label className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-[0.95rem]">Holding time before a claim scores</span>
                <select
                  className="input w-36"
                  value={rules.victory.holdMinutes ?? ''}
                  disabled={!isHost}
                  onChange={(e) =>
                    onSaveRules({ victory: { holdMinutes: e.target.value ? Number(e.target.value) : null } })
                  }
                >
                  <option value="">Default ({durationText(cfg.holdMinutes[pace] * 60_000)})</option>
                  {withCurrent(HOLD_MINUTE_OPTIONS[pace], rules.victory.holdMinutes).map((m) => (
                    <option key={m} value={m}>
                      {durationText(m * 60_000)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-[0.95rem]">Time to choose a secret mission</span>
                <select
                  className="input w-36"
                  value={rules.victory.selectionMinutes ?? ''}
                  disabled={!isHost}
                  onChange={(e) =>
                    onSaveRules({ victory: { selectionMinutes: e.target.value ? Number(e.target.value) : null } })
                  }
                >
                  <option value="">Default ({durationText(cfg.selectionMinutes[pace] * 60_000)})</option>
                  {withCurrent(SELECTION_MINUTE_OPTIONS[pace], rules.victory.selectionMinutes).map((m) => (
                    <option key={m} value={m}>
                      {durationText(m * 60_000)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted">
                Now: claims hold for {durationText(holdMs(rules))} after the next round starts (the default is also the
                least); secret missions are chosen within {durationText(selectionMs(rules))} of the draft ending.
                Changing the pace puts both back to its defaults.
              </p>
            </div>
          </>
        )}
        {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      </div>
    </section>
  );
}
