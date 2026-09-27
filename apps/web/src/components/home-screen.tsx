'use client';

import { displayNameSchema, type CampaignSummary, type SessionUser } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { keys, useCampaigns, useMe } from '@/lib/queries';
import { AppHeader, Emblem } from './app-header';
import { EmpireSwatch } from './hatch';
import { Notice, Spinner } from './ui';

export function HomeScreen() {
  const me = useMe();
  const user = me.data?.user;
  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        {me.isPending ? <Spinner /> : user ? <Dashboard user={user} /> : <Landing />}
      </main>
    </div>
  );
}

function Landing() {
  return (
    <div className="py-10 text-center sm:py-16">
      <Emblem className="mx-auto mb-6 size-20" />
      <h1 className="font-stencil text-4xl tracking-[0.08em] sm:text-5xl">EMPIRE CHESS</h1>
      <p className="mx-auto mt-4 max-w-md text-lg text-muted">
        Claim countries with your friends. Declare wars. Settle every border over the board.
      </p>
      <Link href="/login" className="btn btn-primary mt-8">
        Sign in
      </Link>
    </div>
  );
}

const STATUS_LABEL: Record<CampaignSummary['status'], string> = {
  lobby: 'Lobby',
  draft: 'Drafting',
  active: 'Underway',
  finished: 'Finished',
};

function Dashboard({ user }: { user: SessionUser }) {
  const campaigns = useCampaigns(true);
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Your campaigns</h1>
        <Link href="/new" className="btn btn-primary">
          New campaign
        </Link>
      </div>

      {campaigns.isPending ? (
        <Spinner />
      ) : campaigns.error ? (
        <Notice tone="error">{errorMessage(campaigns.error)}</Notice>
      ) : campaigns.data.length === 0 ? (
        <div className="panel p-6 text-muted">
          No campaigns yet. Start one and send the invite link to your group, or open an invite link a friend sent you.
        </div>
      ) : (
        <ul className="space-y-2">
          {campaigns.data.map((c) => {
            const yourPick = c.status === 'draft' && c.currentPicker === user.id;
            const needsYou = yourPick || c.attention > 0;
            return (
              <li key={c.id}>
                <Link
                  href={`/c/${c.id}`}
                  className={`panel flex min-h-16 items-center gap-3 px-4 py-3 hover:border-line-strong ${
                    needsYou ? 'border-amber/70' : ''
                  }`}
                >
                  <EmpireSwatch color={c.myColor} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-semibold">{c.name}</span>
                    <span className="block text-sm text-muted">
                      {STATUS_LABEL[c.status]} · {c.memberCount} of {c.maxPlayers} players
                      {c.hostId === user.id ? ' · You host' : ''}
                    </span>
                  </span>
                  {needsYou && (
                    <span className="rounded-[3px] bg-amber px-2 py-1 text-sm font-bold tracking-wider whitespace-nowrap text-gunmetal uppercase">
                      {yourPick ? 'Your pick' : `${c.attention} waiting`}
                    </span>
                  )}
                  {c.unread > 0 && (
                    <span className="rounded-[3px] border border-line-strong px-2 py-1 text-sm font-bold tracking-wider whitespace-nowrap uppercase">
                      {c.unread} {c.unread === 1 ? 'message' : 'messages'}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <ProfileSection user={user} />
    </div>
  );
}

function ProfileSection({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name);
  const [saved, setSaved] = useState(false);
  const rename = useMutation({
    mutationFn: (value: string) => api.rename(value),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: keys.me });
    },
  });
  const validation = displayNameSchema.safeParse(name);

  return (
    <section className="panel space-y-3 p-4">
      <h2 className="label">Your name</h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (validation.success) rename.mutate(validation.data);
        }}
      >
        <input
          className="input flex-1"
          value={name}
          maxLength={32}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          aria-label="Display name"
        />
        <button
          type="submit"
          className="btn btn-ghost"
          disabled={!validation.success || name.trim() === user.name || rename.isPending}
        >
          {saved ? 'Saved' : 'Save'}
        </button>
      </form>
      {rename.error && <Notice tone="error">{errorMessage(rename.error)}</Notice>}
      <p className="text-sm text-muted">
        {user.lichessUsername ? `Linked to Lichess as ${user.lichessUsername}.` : 'Not linked to Lichess.'}
        {user.email ? ` Signs in with ${user.email}.` : ''}
      </p>
    </section>
  );
}
