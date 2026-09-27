'use client';

import { DEFAULT_RULES, MAX_PLAYERS, MIN_PLAYERS, campaignNameSchema, type DraftMode, type Pace } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { keys, useMe } from '@/lib/queries';
import { AppHeader } from './app-header';
import { PACE_OPTIONS } from './campaign/lobby-panel';
import { Notice } from './ui';

const DRAFT_MODES: { value: DraftMode; title: string; body: string }[] = [
  {
    value: 'contiguous',
    title: 'Contiguous (recommended)',
    body: 'After your first pick, claim countries bordering your empire by land or sea lane, while any are left. Empires stay in one piece.',
  },
  {
    value: 'free',
    title: 'Free',
    body: 'Claim any free country on every pick. Expect scattered empires and long fronts.',
  },
];

export function NewCampaignScreen() {
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(DEFAULT_RULES.maxPlayers);
  const [mode, setMode] = useState<DraftMode>(DEFAULT_RULES.draft.mode);
  const [pace, setPace] = useState<Pace>(DEFAULT_RULES.war.pace);

  useEffect(() => {
    if (me.data && !me.data.user) router.replace('/login?next=/new');
  }, [me.data, router]);

  const create = useMutation({
    mutationFn: () => api.createCampaign({ name, rules: { maxPlayers, draft: { mode }, war: { pace } } }),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: keys.campaigns });
      router.push(`/c/${id}`);
    },
  });
  const valid = campaignNameSchema.safeParse(name).success;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-lg px-4 py-8">
        <h1 className="mb-6 text-3xl font-bold">New campaign</h1>
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <label className="block space-y-1">
            <span className="label">Campaign name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Operation Long Winter"
              maxLength={60}
              required
              autoFocus
            />
          </label>

          <label className="block space-y-1">
            <span className="label">Player limit</span>
            <select className="input" value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
              {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((n) => (
                <option key={n} value={n}>
                  {n} players
                </option>
              ))}
            </select>
          </label>

          <fieldset className="space-y-2">
            <legend className="label mb-1">Draft</legend>
            {DRAFT_MODES.map((m) => (
              <label
                key={m.value}
                className={`flex cursor-pointer gap-3 rounded-[3px] border p-3 ${
                  mode === m.value ? 'border-paper bg-raised/60' : 'border-line hover:border-line-strong'
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  className="mt-1 size-4 accent-amber"
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                />
                <span>
                  <span className="block font-semibold">{m.title}</span>
                  <span className="block text-sm text-muted">{m.body}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="label mb-1">Pace of the wars</legend>
            {PACE_OPTIONS.map((p) => (
              <label
                key={p.value}
                className={`flex cursor-pointer gap-3 rounded-[3px] border p-3 ${
                  pace === p.value ? 'border-paper bg-raised/60' : 'border-line hover:border-line-strong'
                }`}
              >
                <input
                  type="radio"
                  name="pace"
                  className="mt-1 size-4 accent-amber"
                  checked={pace === p.value}
                  onChange={() => setPace(p.value)}
                />
                <span>
                  <span className="block font-semibold">{p.title}</span>
                  <span className="block text-sm text-muted">{p.body}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <p className="text-sm text-muted">
            Every country on the map is drafted in snake order. You can change these settings, and the time control,
            draws and war tokens, in the lobby until the draft starts.
          </p>
          {create.error && <Notice tone="error">{errorMessage(create.error)}</Notice>}
          <button type="submit" className="btn btn-primary w-full" disabled={!valid || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create campaign'}
          </button>
        </form>
      </main>
    </div>
  );
}
