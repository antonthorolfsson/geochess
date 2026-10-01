'use client';

import { displayNameSchema, passwordSchema, type CampaignSummary, type SessionUser } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { keys, useCampaigns, useMe } from '@/lib/queries';
import { AppHeader, Emblem } from './app-header';
import { FriendsSection, InvitationsSection } from './friends/home-sections';
import { EmpireSwatch } from './hatch';
import { LinkSent } from './login-screen';
import { RulesGuide } from './rules/rules-guide';
import { Notice, PasswordInput, Spinner } from './ui';

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
    <>
      <div className="py-10 text-center sm:py-16">
        <Emblem className="mx-auto mb-6 size-20" />
        <h1 className="font-stencil text-4xl tracking-[0.08em] sm:text-5xl">GEO CHESS</h1>
        <p className="mx-auto mt-4 max-w-md text-lg text-muted">
          Claim countries with your friends. Declare wars. Settle every border over the board.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/login" className="btn btn-primary">
            Sign in
          </Link>
          <Link href="#how-to-play" className="btn btn-ghost">
            How to play
          </Link>
        </div>
      </div>
      <section id="how-to-play" aria-labelledby="how-to-play-heading" className="scroll-mt-4 space-y-6 pb-4">
        <h2 id="how-to-play-heading" className="font-stencil text-3xl tracking-wide">
          How to play
        </h2>
        <RulesGuide variant="standard" level={3} />
        <div className="panel flex flex-wrap items-center gap-4 p-4">
          <p className="min-w-0 flex-1 basis-60">
            Ready? Sign in, start a campaign and send the invite link to your group.
          </p>
          <Link href="/login" className="btn btn-primary">
            Sign in
          </Link>
        </div>
      </section>
    </>
  );
}

const STATUS_LABEL: Record<CampaignSummary['status'], string> = {
  lobby: 'Lobby',
  draft: 'Drafting',
  selection: 'Choosing secret missions',
  active: 'Underway',
  finished: 'Finished',
};

function Dashboard({ user }: { user: SessionUser }) {
  const campaigns = useCampaigns(true);
  return (
    <div className="space-y-8">
      <InvitationsSection />
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
          No campaigns yet. Start one and invite your group, or open an invite link a friend sent you.
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

      <FriendsSection />
      <ProfileSection user={user} />
      {user.email && <PasswordSection hasPassword={user.hasPassword} email={user.email} />}
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

/** Sets a password, or changes it given the current one. A forgotten one is replaced by email. */
function PasswordSection({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [saved, setSaved] = useState<'set' | 'changed' | null>(null);
  const save = useMutation({
    mutationFn: () => api.setPassword(password, hasPassword ? current : undefined),
    onSuccess: async () => {
      setSaved(hasPassword ? 'changed' : 'set');
      setCurrent('');
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: keys.me });
    },
  });
  const reset = useMutation({ mutationFn: () => api.emailSignIn(email, '/', true) });
  const valid = passwordSchema.safeParse(password).success && (!hasPassword || current !== '');
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setSaved(null);
  };

  return (
    <section className="panel space-y-3 p-4">
      <h2 className="label">Password</h2>
      <p className="text-sm text-muted">
        {hasPassword
          ? `You can sign in with ${email} and your password.`
          : `Set a password to sign in with ${email} without waiting for a link.`}
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        {/* Tells password managers which account the password belongs to. */}
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        {hasPassword && (
          <PasswordInput
            label="Current password"
            autoComplete="current-password"
            required
            value={current}
            onChange={edit(setCurrent)}
          />
        )}
        <PasswordInput
          label={hasPassword ? 'New password' : 'Password'}
          hint={`At least 8 characters.${hasPassword ? ' Changing it signs you out on your other devices.' : ''}`}
          autoComplete="new-password"
          required
          value={password}
          onChange={edit(setPassword)}
        />
        <button type="submit" className="btn btn-ghost" disabled={!valid || save.isPending}>
          {hasPassword ? 'Change password' : 'Set password'}
        </button>
      </form>
      {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
      {saved && <Notice>{saved === 'changed' ? 'Password changed.' : 'Password set.'}</Notice>}
      {hasPassword &&
        (reset.data ? (
          <LinkSent email={email} reset devLink={reset.data.devLink} />
        ) : (
          <button
            type="button"
            className="min-h-11 text-sm text-muted underline underline-offset-2 hover:text-paper"
            disabled={reset.isPending}
            onClick={() => reset.mutate()}
          >
            Forgot it? Email me a link to choose a new one
          </button>
        ))}
      {reset.error && <Notice tone="error">{errorMessage(reset.error)}</Notice>}
    </section>
  );
}
