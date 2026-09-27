'use client';

import {
  CORRESPONDENCE_HOURS,
  EMPIRE_COLORS,
  LIVE_CLOCKS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type DraftMode,
  type DrawRule,
  type Pace,
  type TerritoryId,
  type WarRules,
} from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys } from '@/lib/queries';
import { EmpireSwatch } from '../hatch';
import { Notice, Toggle } from '../ui';
import { DraftListSection } from './draft-list';
import { PlayerName } from './player-name';

export function LobbyPanel({ model, onSelect }: { model: CampaignModel; onSelect(id: TerritoryId): void }) {
  const { campaign, isHost, me } = model;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) });

  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onMutate: () => setError(null),
    onError: (err) => setError(errorMessage(err)),
    onSettled: refresh,
  });
  const run = (fn: () => Promise<unknown>) => action.mutate(fn);

  const leaveOrDelete = useMutation({
    mutationFn: () => (isHost ? api.deleteCampaign(campaign.id) : api.leave(campaign.id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.campaigns });
      router.push('/');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const takenBy = new Map(campaign.members.map((m) => [m.color, m]));
  const enough = campaign.members.length >= MIN_PLAYERS;

  return (
    <div className="space-y-6 p-4">
      <section>
        <h2 className="label mb-2">Invite your friends</h2>
        <InviteLink code={campaign.inviteCode} campaignName={campaign.name} />
        {isHost && (
          <button
            type="button"
            className="mt-2 text-sm text-muted underline underline-offset-2 hover:text-paper"
            onClick={() => {
              if (confirm('Make a new invite link? The old one will stop working.'))
                run(() => api.resetInvite(campaign.id));
            }}
          >
            Reset link
          </button>
        )}
      </section>

      <section>
        <h2 className="label mb-2">
          Players · {campaign.members.length} of {campaign.rules.maxPlayers}
        </h2>
        <ul className="divide-y divide-line rounded-[3px] border border-line">
          {campaign.members.map((m) => (
            <li key={m.userId} className="flex min-h-12 items-center gap-2 px-3">
              <span className="min-w-0 flex-1">
                <PlayerName member={m} you={m.userId === me.userId} />
              </span>
              {m.userId === campaign.hostId && <span className="label">Host</span>}
              {isHost && m.userId !== me.userId && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (confirm(`Remove ${m.name} from the campaign?`)) run(() => api.kick(campaign.id, m.userId));
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="label mb-2">Your color</h2>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Empire color">
          {EMPIRE_COLORS.map((c) => {
            const holder = takenBy.get(c.index);
            const mine = holder?.userId === me.userId;
            return (
              <button
                key={c.index}
                type="button"
                role="radio"
                aria-checked={mine}
                aria-label={`${c.name}${holder && !mine ? `, taken by ${holder.name}` : ''}`}
                disabled={Boolean(holder) && !mine}
                onClick={() => run(() => api.updateMembership(campaign.id, { color: c.index }))}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-[3px] border text-xs ${
                  mine ? 'border-paper bg-raised' : 'border-line hover:border-line-strong'
                } disabled:cursor-not-allowed disabled:opacity-35`}
              >
                <EmpireSwatch color={c.index} size={24} />
                <span className="truncate">{holder && !mine ? holder.name : c.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <RulesSection model={model} onSave={(rules) => run(() => api.updateCampaign(campaign.id, { rules }))} />

      <DraftListSection model={model} onSelect={onSelect} />

      {error && <Notice tone="error">{error}</Notice>}

      <section className="space-y-3">
        {isHost ? (
          <>
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={!enough || action.isPending}
              onClick={() => run(() => api.startDraft(campaign.id))}
            >
              Start the draft
            </button>
            <p className="text-sm text-muted">
              {enough
                ? 'The pick order is drawn at random and snakes back each round. Everyone can join until you start.'
                : `You need at least ${MIN_PLAYERS} players. Share the invite link to fill the table.`}
            </p>
          </>
        ) : (
          <p className="text-[0.95rem] text-muted">Waiting for the host to start the draft.</p>
        )}
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={leaveOrDelete.isPending}
          onClick={() => {
            const question = isHost
              ? 'Delete this campaign for everyone? This cannot be undone.'
              : 'Leave this campaign?';
            if (confirm(question)) leaveOrDelete.mutate();
          }}
        >
          {isHost ? 'Delete campaign' : 'Leave campaign'}
        </button>
      </section>
    </div>
  );
}

function InviteLink({ code, campaignName }: { code: string; campaignName: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === 'undefined' ? `/join/${code}` : `${window.location.origin}/join/${code}`;
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex gap-2">
      <input
        className="input min-w-0 flex-1 font-mono text-sm"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
        aria-label="Invite link"
      />
      {canShare ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            navigator
              .share({ title: campaignName, text: `Join my Empire Chess campaign, ${campaignName}.`, url })
              .catch(() => {})
          }
        >
          Share
        </button>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}

function RulesSection({ model, onSave }: { model: CampaignModel; onSave(rules: Record<string, unknown>): void }) {
  const { campaign, isHost } = model;
  const radioName = useId();
  const modes: { value: DraftMode; title: string; body: string }[] = [
    {
      value: 'contiguous',
      title: 'Contiguous',
      body: 'After your first pick, claim countries bordering your empire (by land or sea lane) while any are left.',
    },
    { value: 'free', title: 'Free', body: 'Claim any free country on every pick.' },
  ];
  return (
    <section>
      <h2 className="label mb-2">Rules{isHost ? '' : ' · set by the host'}</h2>
      <div className="space-y-3 rounded-[3px] border border-line p-3">
        <label className="flex min-h-11 items-center justify-between gap-3">
          <span className="font-semibold">Player limit</span>
          <select
            className="input w-24"
            value={campaign.rules.maxPlayers}
            disabled={!isHost}
            onChange={(e) => onSave({ maxPlayers: Number(e.target.value) })}
          >
            {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((n) => (
              <option key={n} value={n} disabled={n < campaign.members.length}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="mb-1 font-semibold">Draft</legend>
          <div className="space-y-1">
            {modes.map((mode) => (
              <label key={mode.value} className="flex cursor-pointer gap-3 rounded-[3px] p-2 hover:bg-raised/60">
                <input
                  type="radio"
                  name={radioName}
                  className="mt-1 size-4 accent-amber"
                  checked={campaign.rules.draft.mode === mode.value}
                  disabled={!isHost}
                  onChange={() => onSave({ draft: { mode: mode.value } })}
                />
                <span>
                  <span className="block font-semibold">{mode.title}</span>
                  <span className="block text-sm text-muted">{mode.body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <WarRulesFields rules={campaign.rules.war} disabled={!isHost} onSave={(war) => onSave({ war })} />
      </div>
    </section>
  );
}

export const PACE_OPTIONS: { value: Pace; title: string; body: string }[] = [
  {
    value: 'correspondence',
    title: 'Correspondence',
    body: 'Games run over days, each move within the time per move. Suits campaigns that last weeks.',
  },
  {
    value: 'live',
    title: 'Live',
    body: 'Blitz for game nights with everyone online. Each player plays one game at a time.',
  },
];

const DRAW_OPTIONS: { value: DrawRule; title: string; body: string }[] = [
  { value: 'defender-holds', title: 'Defender holds', body: 'A drawn war changes nothing.' },
  {
    value: 'armageddon',
    title: 'Armageddon',
    body: 'A draw goes to one more game with colors swapped. Black gets four fifths of the time and wins a draw.',
  },
];

const hoursLabel = (h: number) => (h % 24 === 0 ? `${h / 24} ${h === 24 ? 'day' : 'days'}` : `${h} hours`);

/** The host's war settings: pace, clocks, draws, and the numbers the playtest will tune. */
function WarRulesFields({
  rules,
  disabled,
  onSave,
}: {
  rules: WarRules;
  disabled: boolean;
  onSave(war: Partial<WarRules>): void;
}) {
  const paceName = useId();
  const drawName = useId();
  const numbers: {
    key: 'tokensPerRound' | 'tokenCap' | 'truceRounds' | 'lockRounds';
    label: string;
    range: number[];
  }[] = [
    { key: 'tokensPerRound', label: 'War tokens each round', range: [1, 2, 3] },
    { key: 'tokenCap', label: 'Most tokens a player can save up', range: [1, 2, 3, 4, 5] },
    { key: 'truceRounds', label: 'Rounds of truce after a war', range: [0, 1, 2, 3] },
    { key: 'lockRounds', label: 'Rounds before a won country can be staked', range: [0, 1, 2, 3, 4] },
  ];
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 font-semibold">Wars</legend>
      <div className="space-y-1">
        {PACE_OPTIONS.map((p) => (
          <label key={p.value} className="flex cursor-pointer gap-3 rounded-[3px] p-2 hover:bg-raised/60">
            <input
              type="radio"
              name={paceName}
              className="mt-1 size-4 accent-amber"
              checked={rules.pace === p.value}
              disabled={disabled}
              onChange={() => onSave({ pace: p.value })}
            />
            <span>
              <span className="block font-semibold">{p.title}</span>
              <span className="block text-sm text-muted">{p.body}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span className="font-semibold">Time control</span>
        {rules.pace === 'live' ? (
          <select
            className="input w-32"
            value={rules.liveClock}
            disabled={disabled}
            onChange={(e) => onSave({ liveClock: e.target.value as WarRules['liveClock'] })}
          >
            {LIVE_CLOCKS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <select
            className="input w-44"
            value={rules.hoursPerMove}
            disabled={disabled}
            onChange={(e) => onSave({ hoursPerMove: Number(e.target.value) as WarRules['hoursPerMove'] })}
          >
            {CORRESPONDENCE_HOURS.map((h) => (
              <option key={h} value={h}>
                {hoursLabel(h)} per move
              </option>
            ))}
          </select>
        )}
      </label>
      <div className="space-y-1">
        <span className="block text-sm font-semibold text-muted">Draws</span>
        {DRAW_OPTIONS.map((d) => (
          <label key={d.value} className="flex cursor-pointer gap-3 rounded-[3px] p-2 hover:bg-raised/60">
            <input
              type="radio"
              name={drawName}
              className="mt-1 size-4 accent-amber"
              checked={rules.draws === d.value}
              disabled={disabled}
              onChange={() => onSave({ draws: d.value })}
            />
            <span>
              <span className="block font-semibold">{d.title}</span>
              <span className="block text-sm text-muted">{d.body}</span>
            </span>
          </label>
        ))}
      </div>
      <Toggle
        checked={rules.clockModifiers}
        disabled={disabled}
        onChange={(clockModifiers) => onSave({ clockModifiers })}
        label="Clock modifiers"
        description="Home turf, mountains and islands give the defender extra time; supply lines give the attacker extra time. Capped at 25%."
      />
      <details className="rounded-[3px] border border-line px-3 py-2">
        <summary className="min-h-9 cursor-pointer content-center font-semibold">More war settings</summary>
        <div className="space-y-2 pt-2">
          {numbers.map(({ key, label, range }) => (
            <label key={key} className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-[0.95rem]">{label}</span>
              <select
                className="input w-20"
                value={rules[key]}
                disabled={disabled}
                onChange={(e) => onSave({ [key]: Number(e.target.value) })}
              >
                {range.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </details>
    </fieldset>
  );
}
