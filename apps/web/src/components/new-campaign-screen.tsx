'use client';

import { DEFAULT_RULES, campaignNameSchema, type Pace } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from '@/lib/api';
import { keys, useMe } from '@/lib/queries';
import { keySettings, standardRules } from '@/lib/rules-text';
import { AppHeader } from './app-header';
import { PACE_OPTIONS } from './campaign/settings-fields';
import { Notice } from './ui';

type Setup = 'quick' | 'advanced';

const SETUPS: { value: Setup; title: string; body: string }[] = [
  {
    value: 'quick',
    title: 'Quick start (recommended)',
    body: 'The standard rules, ready to play: you choose only the pace. Invite your friends and start the draft straight away.',
  },
  {
    value: 'advanced',
    title: 'Advanced',
    body: 'Choose every setting yourself on the next page: the players and the draft, the clocks, how wars are answered and how the campaign is won.',
  },
];

/**
 * A new campaign: a quick start on the standard rules, choosing only the pace, or an advanced one
 * that goes on to every setting on the settings page. Either way the host can change the settings
 * from the lobby until the draft starts.
 */
export function NewCampaignScreen() {
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [setup, setSetup] = useState<Setup>('quick');
  const [pace, setPace] = useState<Pace>(DEFAULT_RULES.war.pace);

  useEffect(() => {
    if (me.data && !me.data.user) router.replace('/login?next=/new');
  }, [me.data, router]);

  const create = useMutation({
    // An advanced campaign starts on the standard rules too, and changes them on the next page.
    mutationFn: () => api.createCampaign({ name, rules: setup === 'quick' ? { war: { pace } } : {} }),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: keys.campaigns });
      router.push(setup === 'quick' ? `/c/${id}` : `/c/${id}/settings`);
    },
  });
  const valid = campaignNameSchema.safeParse(name).success;
  // What a quick start plays at the chosen pace, the pace itself aside.
  const standard = keySettings(standardRules({ ...DEFAULT_RULES, war: { ...DEFAULT_RULES.war, pace } })).filter(
    (s) => s.label !== 'Pace',
  );

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

          <fieldset className="space-y-2">
            <legend className="label mb-1">Setup</legend>
            {SETUPS.map((s) => (
              <Option key={s.value} name="setup" checked={setup === s.value} onChange={() => setSetup(s.value)}>
                <span className="block font-semibold">{s.title}</span>
                <span className="block text-sm text-muted">{s.body}</span>
              </Option>
            ))}
          </fieldset>

          {setup === 'quick' ? (
            <>
              <fieldset className="space-y-2">
                <legend className="label mb-1">Pace of the wars</legend>
                {PACE_OPTIONS.map((p) => (
                  <Option key={p.value} name="pace" checked={pace === p.value} onChange={() => setPace(p.value)}>
                    <span className="block font-semibold">{p.title}</span>
                    <span className="block text-sm text-muted">{p.body}</span>
                  </Option>
                ))}
              </fieldset>
              <div>
                <h2 className="label mb-1">The standard rules</h2>
                <dl className="text-sm">
                  {standard.map((s) => (
                    <div
                      key={s.label}
                      className="flex items-baseline justify-between gap-4 border-b border-line py-1.5"
                    >
                      <dt className="text-muted">{s.label}</dt>
                      <dd className="text-right font-semibold">{s.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-sm text-muted">
                  Every country on the map is drafted in snake order. You can change any setting from the lobby until
                  the draft starts.
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              The campaign starts on the standard rules, and the next page has every setting, the pace included. You can
              come back to them from the lobby until the draft starts.
            </p>
          )}

          {create.error && <Notice tone="error">{errorMessage(create.error)}</Notice>}
          <button type="submit" className="btn btn-primary w-full" disabled={!valid || create.isPending}>
            {create.isPending ? 'Creating…' : setup === 'quick' ? 'Create campaign' : 'Create and choose settings'}
          </button>
        </form>
      </main>
    </div>
  );
}

/** A radio choice drawn as a card, lit while chosen. */
function Option({
  name,
  checked,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  onChange(): void;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-[3px] border p-3 ${
        checked ? 'border-paper bg-raised/60' : 'border-line hover:border-line-strong'
      }`}
    >
      <input type="radio" name={name} className="mt-1 size-4 accent-amber" checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}
