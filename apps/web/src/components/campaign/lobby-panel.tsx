'use client';

import {
  COLOR_PALETTES,
  DEFAULT_BOT_LEVEL,
  EMPIRE_COLORS,
  MIN_PLAYERS,
  RATING_MAX,
  RATING_MIN,
  type ColorPalette,
  type MemberView,
  type TerritoryId,
  botLevelText,
  empireColor,
  joinWords,
  lichessPerfFor,
} from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys } from '@/lib/queries';
import { changedSettings, keySettings, ratingText, settingsList } from '@/lib/rules-text';
import { EmpireSwatch } from '../hatch';
import { Notice } from '../ui';
import { PublicMissions } from '../victory/lobby-missions';
import type { MissionFocus } from '../victory/missions-panel';
import { BotLevelSelect } from './bot-level-select';
import { DraftListSection } from './draft-list';
import { PlayerName } from './player-name';
import { useSettingsHref } from './room-context';

export function LobbyPanel({
  model,
  onSelect,
  onShowOnMap,
}: {
  model: CampaignModel;
  onSelect(id: TerritoryId): void;
  onShowOnMap(focus: MissionFocus): void;
}) {
  const { campaign, isHost, me } = model;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) });
  const settingsHref = useSettingsHref(campaign.id);

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
      router.push('/campaigns');
    },
    onError: (err) => setError(errorMessage(err)),
  });

  // The player whose color the host is choosing.
  const [coloring, setColoring] = useState<string | null>(null);
  const enough = campaign.members.length >= MIN_PLAYERS;
  const missionsReady = !campaign.victory || campaign.victory.publicMissions.length === 4;

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
            <li key={m.userId}>
              <div className="flex min-h-12 items-center gap-2 px-3">
                <span className="min-w-0 flex-1">
                  <PlayerName member={m} you={m.userId === me.userId} />
                </span>
                {m.userId === campaign.hostId && <span className="label">Host</span>}
                {isHost && m.userId !== me.userId && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-expanded={coloring === m.userId}
                      onClick={() => setColoring(coloring === m.userId ? null : m.userId)}
                    >
                      Color
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        if (confirm(`Remove ${m.name} from the campaign?`)) run(() => api.kick(campaign.id, m.userId));
                      }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
              {isHost && coloring === m.userId && (
                <div className="px-3 pb-3">
                  <ColorChoices
                    model={model}
                    member={m}
                    label={`${m.name}’s color`}
                    onPick={(color) => {
                      setColoring(null);
                      run(() => api.setMemberColor(campaign.id, m.userId, color));
                    }}
                  />
                </div>
              )}
              {m.bot &&
                (isHost ? (
                  <div className="px-3">
                    <BotLevelSelect
                      label={`${m.name}’s level`}
                      value={m.bot.level}
                      disabled={action.isPending}
                      onChange={(level) => run(() => api.setBotLevel(campaign.id, m.userId, { level }))}
                    />
                  </div>
                ) : (
                  <p className="px-3 pb-3 text-sm text-muted">{botLevelText(m.bot.level)}</p>
                ))}
            </li>
          ))}
        </ul>
        {isHost && campaign.members.length < campaign.rules.maxPlayers && (
          <AddBot pending={action.isPending} onAdd={(level) => run(() => api.addBot(campaign.id, { level }))} />
        )}
      </section>

      <section>
        <ColorChoices
          model={model}
          member={me}
          heading={<h2 className="label">Your color</h2>}
          label="Empire color"
          onPick={(color) => run(() => api.updateMembership(campaign.id, { color }))}
        />
      </section>

      {campaign.rules.war.handicap !== 'off' && (
        <RatingsSection
          model={model}
          pending={action.isPending}
          onSave={(rating) => run(() => api.updateMembership(campaign.id, { rating }))}
        />
      )}

      <LobbySettings model={model} settingsHref={settingsHref} />

      <PublicMissions model={model} settingsHref={settingsHref} onSelectCountry={onSelect} onShowOnMap={onShowOnMap} />

      <DraftListSection model={model} onSelect={onSelect} />

      {error && <Notice tone="error">{error}</Notice>}

      <section className="space-y-3">
        {isHost ? (
          <>
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={!enough || !missionsReady || action.isPending}
              onClick={() => run(() => api.startDraft(campaign.id))}
            >
              Start the draft
            </button>
            <p className="text-sm text-muted">
              {!enough
                ? `You need at least ${MIN_PLAYERS} players. Share the invite link or add a bot to fill the table.`
                : !missionsReady
                  ? 'Choose the public missions in the settings first, or play open-ended.'
                  : 'The pick order is drawn at random and snakes back each round. Everyone can join until you start. The rules and missions lock when you do.'}
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

function AddBot({ pending, onAdd }: { pending: boolean; onAdd(level: number): void }) {
  const [level, setLevel] = useState(DEFAULT_BOT_LEVEL);
  return (
    <div className="mt-2 rounded-[3px] border border-line p-3">
      <h3 className="mb-1 font-semibold">Add a bot</h3>
      <p className="mb-2 text-sm text-muted">
        Bots play the whole game: they draft, choose a secret mission, declare and answer wars, and make and break
        accords, answering straight away. The level sets only how well they play chess.
      </p>
      <BotLevelSelect label="Level of the new bot" value={level} onChange={setLevel} />
      <button type="button" className="btn btn-ghost w-full" disabled={pending} onClick={() => onAdd(level)}>
        Add bot
      </button>
    </div>
  );
}

const PALETTE_LABELS: Record<ColorPalette, string> = { patterned: 'Patterned', solid: 'Solid' };

/**
 * The empire colors for one player to pick from, eight at a time: the patterned set or the solid
 * one, opening on the set their color is in. Colors other players hold are taken.
 */
function ColorChoices({
  model,
  member,
  heading,
  label,
  onPick,
}: {
  model: CampaignModel;
  member: MemberView;
  heading?: ReactNode;
  label: string;
  onPick(color: number): void;
}) {
  const [palette, setPalette] = useState<ColorPalette>(() => empireColor(member.color).palette);
  const takenBy = new Map(model.campaign.members.map((m) => [m.color, m]));
  return (
    <div className="space-y-2">
      <div className="flex min-h-9 items-center justify-between gap-2">
        {heading}
        <div className="ml-auto flex overflow-hidden rounded-[3px] border border-line" role="group" aria-label="Colors">
          {COLOR_PALETTES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={palette === p}
              onClick={() => setPalette(p)}
              className={`min-h-9 px-3 text-sm font-bold ${palette === p ? 'bg-paper text-gunmetal' : 'text-muted hover:text-paper'}`}
            >
              {PALETTE_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={label}>
        {EMPIRE_COLORS.filter((c) => c.palette === palette).map((c) => {
          const holder = takenBy.get(c.index);
          const theirs = holder?.userId === member.userId;
          return (
            <button
              key={c.index}
              type="button"
              role="radio"
              aria-checked={theirs}
              aria-label={`${c.name}${holder && !theirs ? `, taken by ${holder.name}` : ''}`}
              disabled={Boolean(holder) && !theirs}
              onClick={() => onPick(c.index)}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-[3px] border text-xs ${
                theirs ? 'border-paper bg-raised' : 'border-line hover:border-line-strong'
              } disabled:cursor-not-allowed disabled:opacity-35`}
            >
              <EmpireSwatch color={c.index} size={24} />
              <span className="truncate">{holder && !theirs ? holder.name : c.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Everyone's rating for the handicap, and the viewer's own: from Lichess (read again here, and
 * when the draft starts), or typed in where the host allows it.
 */
function RatingsSection({
  model,
  pending,
  onSave,
}: {
  model: CampaignModel;
  pending: boolean;
  onSave(rating: number | null): void;
}) {
  const { campaign, me } = model;
  const queryClient = useQueryClient();
  const { selfRatings } = campaign.rules.war;
  const lichess = me.lichessUsername;
  const ownRating = me.rating?.source === 'self' ? me.rating.rating : null;
  const [draft, setDraft] = useState(ownRating === null ? '' : String(ownRating));
  const value = Number(draft);
  const valid = draft !== '' && Number.isInteger(value) && value >= RATING_MIN && value <= RATING_MAX;

  const reread = useMutation({
    mutationFn: () => api.refreshRating(campaign.id),
    onSuccess: ({ refreshed }) => {
      if (refreshed) void queryClient.invalidateQueries({ queryKey: keys.campaign(campaign.id) });
    },
  });
  // Lichess ratings move: read them again when a Lichess player opens the lobby (the server
  // reads Lichess at most every ten minutes).
  const { mutate: rereadNow } = reread;
  useEffect(() => {
    if (lichess) rereadNow();
  }, [lichess, rereadNow]);

  const linkLichess = (
    <a
      href={`/api/auth/lichess?next=${encodeURIComponent(`/c/${campaign.id}`)}`}
      className="underline underline-offset-2 hover:text-paper"
    >
      Link your Lichess account
    </a>
  );

  return (
    <section>
      <h2 className="label mb-2">Ratings for the handicap</h2>
      <ul className="divide-y divide-line rounded-[3px] border border-line">
        {campaign.members.map((m) => (
          <li key={m.userId} className="flex min-h-11 items-center gap-3 px-3">
            <span className="min-w-0 flex-1">
              <PlayerName member={m} you={m.userId === me.userId} />
            </span>
            <span className={`text-sm ${m.rating ? '' : 'text-muted'}`}>
              {m.rating ? ratingText(m.rating) : 'Unrated'}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-2 text-sm text-muted">
        {lichess && me.rating?.source === 'lichess' ? (
          <p>
            Yours is from Lichess ({lichess}), for {lichessPerfFor(campaign.rules.war)} games or the nearest kind you
            play.{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-paper"
              disabled={reread.isPending}
              onClick={() => reread.mutate()}
            >
              Check Lichess again
            </button>
            {reread.isSuccess && !reread.data.refreshed && ' Up to date.'}
          </p>
        ) : (
          <>
            <p>
              {lichess
                ? `Your Lichess account (${lichess}) has no established rating yet.`
                : 'You’re not signed in with Lichess.'}{' '}
              {selfRatings
                ? 'Give the rating you’d have on Lichess, or your best guess.'
                : 'Without a rating your games have no handicap.'}{' '}
              {!lichess && linkLichess}
              {!lichess && '.'}
            </p>
            {selfRatings && (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (valid) onSave(value);
                }}
              >
                <label className="flex items-center gap-2">
                  <span className="font-semibold text-paper">Your rating</span>
                  <input
                    className="input w-24"
                    type="number"
                    inputMode="numeric"
                    min={RATING_MIN}
                    max={RATING_MAX}
                    step={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="btn btn-ghost btn-sm"
                  disabled={!valid || pending || value === ownRating}
                >
                  Save
                </button>
              </form>
            )}
          </>
        )}
        <p>Ratings are frozen when the draft starts. A game with an unrated player has no handicap.</p>
      </div>
    </section>
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
              .share({ title: campaignName, text: `Join my Geo Chess campaign, ${campaignName}.`, url })
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

/**
 * The campaign's settings at a glance: the few that sum it up, whether any differ from the standard
 * rules, and the rest folded away. The host changes them on the settings page, away from the map.
 */
function LobbySettings({ model, settingsHref }: { model: CampaignModel; settingsHref: string }) {
  const { campaign, isHost } = model;
  const { rules } = campaign;
  const heading = useId();
  const changed = changedSettings(rules);
  const key = keySettings(rules);
  const rest = settingsList(rules).filter((s) => !key.some((k) => k.label === s.label));
  const host = model.membersById.get(campaign.hostId)?.name ?? 'The host';
  return (
    <section aria-labelledby={heading}>
      <div className="mb-2 flex min-h-9 items-center justify-between gap-2">
        <h2 id={heading} className="label">
          Settings
        </h2>
        {isHost && (
          <Link href={settingsHref} className="btn btn-ghost btn-sm">
            Change settings
          </Link>
        )}
      </div>
      <div className="space-y-3 rounded-[3px] border border-line p-3">
        <div>
          <p className="font-semibold">{changed.length === 0 ? 'Standard rules' : 'Custom rules'}</p>
          <p className="text-sm text-muted">
            {changed.length > 0 && `Changed from the standard rules: ${joinWords(changed.map(lowerFirst))}. `}
            {isHost
              ? 'You can change any setting until the draft starts.'
              : `${host} can change them until the draft starts.`}
          </p>
        </div>
        <SettingRows rows={key} />
        <details>
          <summary className="min-h-9 cursor-pointer content-center text-sm font-semibold">All settings</summary>
          <SettingRows rows={rest} />
        </details>
      </div>
    </section>
  );
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

function SettingRows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="text-sm">
      {rows.map((s) => (
        <div
          key={s.label}
          className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 last:border-0"
        >
          <dt className="text-muted">{s.label}</dt>
          <dd className="text-right font-semibold">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}
