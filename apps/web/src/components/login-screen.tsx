'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { keys, useMe } from '@/lib/queries';
import { AppHeader } from './app-header';
import { Notice, Spinner } from './ui';

export function LoginScreen({ next, error }: { next: string; error: string | null }) {
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (me.data?.user) router.replace(next);
  }, [me.data, next, router]);

  const signedIn = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.me });
    router.replace(next);
  };

  const auth = me.data?.auth;
  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-sm space-y-8 px-4 py-10">
        <h1 className="text-3xl font-bold">Sign in</h1>
        {error === 'lichess' && <Notice tone="error">Lichess sign-in didn't go through. Try again.</Notice>}
        {!auth ? (
          <Spinner />
        ) : (
          <>
            {auth.lichess && (
              <a href={`/api/auth/lichess?next=${encodeURIComponent(next)}`} className="btn btn-primary w-full">
                Sign in with Lichess
              </a>
            )}
            {auth.email && <EmailForm next={next} />}
            {auth.devLogin && <DevSignIn onDone={signedIn} />}
          </>
        )}
      </main>
    </div>
  );
}

function EmailForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: () => api.emailSignIn(email, next) });

  if (send.data) {
    return (
      <div className="space-y-3">
        <Notice>Check your inbox. We sent a sign-in link to {email}.</Notice>
        {send.data.devLink && (
          <p className="text-sm text-muted">
            Email isn't set up on this server, so here is the link:{' '}
            <a className="break-all text-paper underline" href={send.data.devLink}>
              open sign-in link
            </a>
          </p>
        )}
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <label className="block space-y-1">
        <span className="label">Or get a link by email</span>
        <input
          className="input"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-ghost w-full" disabled={send.isPending}>
        {send.isPending ? 'Sending…' : 'Email me a link'}
      </button>
      {send.error && <Notice tone="error">{errorMessage(send.error)}</Notice>}
    </form>
  );
}

/** Development only: sign in as anyone by name, to play several seats from one machine. */
function DevSignIn({ onDone }: { onDone(): void }) {
  const [name, setName] = useState('');
  const devUsers = useQuery({ queryKey: ['dev-users'], queryFn: api.devUsers });
  const signIn = useMutation({ mutationFn: (value: string) => api.devSignIn(value), onSuccess: onDone });

  return (
    <section className="space-y-3 rounded-[3px] border border-dashed border-amber/50 p-4">
      <h2 className="label text-amber">Development sign-in</h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          signIn.mutate(name);
        }}
      >
        <input
          className="input flex-1"
          placeholder="Any name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Name"
        />
        <button type="submit" className="btn btn-ghost" disabled={signIn.isPending || name.trim().length < 2}>
          Go
        </button>
      </form>
      {devUsers.data && devUsers.data.users.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {devUsers.data.users.map((u) => (
            <button key={u.id} type="button" className="btn btn-ghost btn-sm" onClick={() => signIn.mutate(u.name)}>
              {u.name}
            </button>
          ))}
        </div>
      )}
      {signIn.error && <Notice tone="error">{errorMessage(signIn.error)}</Notice>}
    </section>
  );
}

export function VerifyScreen({ token, next }: { token: string; next: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .verifyEmail(token)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: keys.me });
        router.replace(next);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [token, next, router, queryClient]);

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-sm space-y-4 px-4 py-10">
        {error ? (
          <>
            <Notice tone="error">{error}</Notice>
            <a href="/login" className="btn btn-ghost">
              Back to sign in
            </a>
          </>
        ) : (
          <Spinner label="Signing you in" />
        )}
      </main>
    </div>
  );
}
