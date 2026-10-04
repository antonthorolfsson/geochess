'use client';

import {
  CORRESPONDENCE_HOURS,
  DEFAULT_BOT_LEVEL,
  EMPIRE_COLORS,
  HANDICAP_CAP_PCT,
  HANDICAP_LEVELS,
  HANDICAP_PCT_PER_100,
  LIVE_CLOCKS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MATCHED_RAISE_MIN_PCT,
  MAX_RAISES,
  RATING_MAX,
  RATING_MIN,
  TURN_WINDOW_TEXT,
  type DraftMode,
  type DrawRule,
  type HandicapLevel,
  type MemberView,
  type Pace,
  type RaiseStyle,
  type TerritoryId,
  type WarRules,
  botLevelText,
  lichessPerfFor,
  withStakeFloor,
} from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { CampaignModel } from '@/lib/campaign';
import { keys } from '@/lib/queries';
import { ratingText } from '@/lib/rules-text';
import { EmpireSwatch } from '../hatch';
import { Notice, Toggle } from '../ui';
import { LobbyMissions } from '../victory/lobby-missions';
import type { MissionFocus } from '../victory/missions-panel';
import { BotLevelSelect } from './bot-level-select';
import { DraftListSection } from './draft-list';
import { PlayerName } from './player-name';

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
        <h2 className="label mb-2">Your color</h2>
        <ColorChoices
          model={model}
          member={me}
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

      <RulesSection model={model} onSave={(rules) => run(() => api.updateCampaign(campaign.id, { rules }))} />

      <LobbyMissions
        model={model}
        onSaveRules={(rules) => run(() => api.updateCampaign(campaign.id, { rules }))}
        onSelectCountry={onSelect}
        onShowOnMap={onShowOnMap}
      />

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
                  ? 'Choose four public missions first, or play open-ended.'
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

/** The eight empire colors for one player to pick from; colors other players hold are taken. */
function ColorChoices({
  model,
  member,
  label,
  onPick,
}: {
  model: CampaignModel;
  member: MemberView;
  label: string;
  onPick(color: number): void;
}) {
  const takenBy = new Map(model.campaign.members.map((m) => [m.color, m]));
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={label}>
      {EMPIRE_COLORS.map((c) => {
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

const handicapBody = (level: Exclude<HandicapLevel, 'off'>) =>
  `The weaker player gets ${HANDICAP_PCT_PER_100[level]}% more time for every 100 rating points between the two, up to ${HANDICAP_CAP_PCT[level]}%. In live games the stronger player has as much less.`;

const HANDICAP_OPTIONS: { value: HandicapLevel; title: string; body: string }[] = HANDICAP_LEVELS.map((value) =>
  value === 'off'
    ? { value, title: 'Off', body: 'Both players get the same time, whatever their ratings.' }
    : { value, title: value === 'full' ? 'Full' : 'Light', body: handicapBody(value) },
);

const hoursLabel = (h: number) => (h % 24 === 0 ? `${h / 24} ${h === 24 ? 'day' : 'days'}` : `${h} hours`);

/** How a defender raises the stakes, in the lobby's words. */
export function raiseStyleOptions(rules: WarRules): { value: RaiseStyle; title: string; body: string }[] {
  return [
    {
      value: 'matched',
      title: 'Matched',
      body: `The defender puts one of their countries, worth ${MATCHED_RAISE_MIN_PCT}% to 100% of the target, into the war. The attacker adds at least as much to the stake or withdraws; winning takes both. With more than one raise, either side can raise again in turn.`,
    },
    {
      value: 'token',
      title: 'Costs a token',
      body: `The defender pays a war token to demand a stake of ${rules.raisePct}% of the target. The attacker gets the token for meeting it.`,
    },
    {
      value: 'free',
      title: 'Free (original)',
      body: `The defender demands a stake of ${rules.raisePct}% of the target at no cost.`,
    },
    {
      value: 'off',
      title: 'No raising',
      body: 'Defenders accept, redirect or talk peace. Try it with a higher stake floor.',
    },
  ];
}

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
  const raiseName = useId();
  const handicapName = useId();
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
      <Toggle
        checked={rules.turns}
        disabled={disabled}
        onChange={(turns) => onSave({ turns })}
        label="Take turns declaring"
        description={`Each round, players declare war or fortify one at a time, round the table, with ${TURN_WINDOW_TEXT[rules.pace]} a turn; passing ends a player's declaring for the round. Off: anyone declares whenever they like, so the quickest get first pick.`}
      />
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
      <div className="space-y-1">
        <span className="block text-sm font-semibold text-muted">Rating handicap</span>
        {HANDICAP_OPTIONS.map((h) => (
          <label key={h.value} className="flex cursor-pointer gap-3 rounded-[3px] p-2 hover:bg-raised/60">
            <input
              type="radio"
              name={handicapName}
              className="mt-1 size-4 accent-amber"
              checked={rules.handicap === h.value}
              disabled={disabled}
              onChange={() => onSave({ handicap: h.value })}
            />
            <span>
              <span className="block font-semibold">{h.title}</span>
              <span className="block text-sm text-muted">{h.body}</span>
            </span>
          </label>
        ))}
      </div>
      {rules.handicap !== 'off' && (
        <Toggle
          checked={rules.selfRatings}
          disabled={disabled}
          onChange={(selfRatings) => onSave({ selfRatings })}
          label="Players give their own rating"
          description="Players without an established Lichess rating type one in. Off: they play unrated, and their games have no handicap."
        />
      )}
      <div className="space-y-1">
        <span className="block text-sm font-semibold text-muted">Raising the stakes</span>
        {raiseStyleOptions(rules).map((r) => (
          <label key={r.value} className="flex cursor-pointer gap-3 rounded-[3px] p-2 hover:bg-raised/60">
            <input
              type="radio"
              name={raiseName}
              className="mt-1 size-4 accent-amber"
              checked={rules.raise === r.value}
              disabled={disabled}
              onChange={() => onSave({ raise: r.value })}
            />
            <span>
              <span className="block font-semibold">{r.title}</span>
              <span className="block text-sm text-muted">{r.body}</span>
            </span>
          </label>
        ))}
      </div>
      {rules.raise === 'matched' && (
        <label className="block space-y-1">
          <span className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-[0.95rem] font-semibold">Raises in one war</span>
            <select
              className="input w-24"
              value={rules.raises}
              disabled={disabled}
              onChange={(e) => onSave({ raises: Number(e.target.value) })}
            >
              {Array.from({ length: MAX_RAISES }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </span>
          <span className="block text-sm text-muted">
            {rules.raises === 1
              ? 'The defender raises once; the attacker meets it or withdraws (the original rule).'
              : `The attacker can raise again, then the defender, up to ${rules.raises} raises in all. Whoever has raised and then backs down loses the war as declared, without a game: the defender the target, the attacker the stake.`}
          </span>
        </label>
      )}
      <Toggle
        checked={rules.redirect === 'nearby'}
        disabled={disabled}
        onChange={(nearby) => onSave({ redirect: nearby ? 'nearby' : 'anywhere' })}
        label="Redirects stay nearby"
        description="A redirect must border the country attacked, and the war keeps that country's clock. Off: any same-value country bordering the attacker (the original rule)."
      />
      <Toggle
        checked={rules.redirectToken}
        disabled={disabled}
        onChange={(redirectToken) => onSave({ redirectToken })}
        label="Redirects cost a token"
        description="The defender pays a war token to redirect; the attacker gets it for fighting on."
      />
      <Toggle
        checked={rules.fortify}
        disabled={disabled}
        onChange={(fortify) => onSave({ fortify })}
        label="Fortifying"
        description={`A war token fortifies a country until the round after next: a war on it needs a stake of ${rules.raisePct}% of its value.`}
      />
      <Toggle
        checked={rules.peaceTerms}
        disabled={disabled}
        onChange={(peaceTerms) => onSave({ peaceTerms })}
        label="Peace terms"
        description="Either player can offer terms to end a war until its game is over: countries or tokens either way, or nothing, and an accord. Takes the place of tribute."
      />
      <Toggle
        checked={rules.recall}
        disabled={disabled}
        onChange={(recall) => onSave({ recall })}
        label="Calling off"
        description="The attacker can call a declaration off until the defender answers. The token stays spent."
      />
      <details className="rounded-[3px] border border-line px-3 py-2">
        <summary className="min-h-9 cursor-pointer content-center font-semibold">More war settings</summary>
        <div className="space-y-2 pt-2">
          {(
            [
              { key: 'stakeFloorPct', label: 'Least stake, as a share of the target', range: [80, 90, 100, 110, 125] },
              {
                key: 'raisePct',
                label: 'Stake a raise or a fortified country demands',
                range: [110, 125, 150, 175, 200],
              },
            ] as const
          ).map(({ key, label, range }) => (
            <label key={key} className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-[0.95rem]">{label}</span>
              <select
                className="input w-24"
                value={rules[key]}
                disabled={disabled}
                onChange={(e) => {
                  const pct = Number(e.target.value);
                  onSave(key === 'stakeFloorPct' ? withStakeFloor(rules, pct) : { raisePct: pct });
                }}
              >
                {[...new Set([...range, rules[key]])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}%
                    </option>
                  ))}
              </select>
            </label>
          ))}
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
