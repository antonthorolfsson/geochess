'use client';

import { passwordSchema } from '@empire/rules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';
import { keys, useMe } from '@/lib/queries';
import { AppHeader } from './app-header';
import { Notice, PasswordInput, Spinner } from './ui';

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
            {auth.email && <EmailSignIn next={next} onSignedIn={signedIn} />}
            {auth.devLogin && <DevSignIn onDone={signedIn} />}
          </>
        )}
      </main>
    </div>
  );
}

/**
 * Email and password for players who have set a password. Everyone else gets a link by email,
 * which is also how new players sign up and how a forgotten password is replaced.
 */
function EmailSignIn({ next, onSignedIn }: { next: string; onSignedIn(): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const emailInput = useRef<HTMLInputElement>(null);
  const signIn = useMutation({ mutationFn: () => api.passwordSignIn(email, password), onSuccess: onSignedIn });
  const link = useMutation({ mutationFn: (reset: boolean) => api.emailSignIn(email, next, reset) });

  if (link.data) return <LinkSent email={email} reset={link.variables} devLink={link.data.devLink} />;

  // A link needs only the email, so only that field is checked.
  const sendLink = (reset: boolean) => {
    if (emailInput.current?.reportValidity()) link.mutate(reset);
  };

  return (
    <div className="space-y-6">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          signIn.mutate();
        }}
      >
        <label className="block space-y-1">
          <span className="label">Email</span>
          <input
            ref={emailInput}
            className="input"
            type="email"
            required
            autoComplete="username"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={setPassword}
        />
        <button type="submit" className="btn btn-ghost w-full" disabled={signIn.isPending}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </button>
        {signIn.error && <Notice tone="error">{errorMessage(signIn.error)}</Notice>}
        <button
          type="button"
          className="min-h-11 text-sm text-muted underline underline-offset-2 hover:text-paper"
          disabled={link.isPending}
          onClick={() => sendLink(true)}
        >
          Forgot your password?
        </button>
      </form>
      <div className="space-y-3 border-t border-line pt-6">
        <p className="text-sm text-muted">New here, or no password yet? We'll email you a link that signs you in.</p>
        <button
          type="button"
          className="btn btn-ghost w-full"
          disabled={link.isPending}
          onClick={() => sendLink(false)}
        >
          {link.isPending ? 'Sending…' : 'Email me a link'}
        </button>
        {link.error && <Notice tone="error">{errorMessage(link.error)}</Notice>}
      </div>
    </div>
  );
}

/** Says a link is on its way. Where the server doesn't send email (development), it shows the link. */
export function LinkSent({ email, reset, devLink }: { email: string; reset: boolean; devLink?: string }) {
  return (
    <div className="space-y-3">
      <Notice>
        Check your inbox. We sent {reset ? 'a link to choose a new password' : 'a sign-in link'} to {email}.
      </Notice>
      {devLink && (
        <p className="text-sm text-muted">
          Email isn't set up on this server, so here is the link:{' '}
          <a className="break-all text-paper underline" href={devLink}>
            open {reset ? 'password' : 'sign-in'} link
          </a>
        </p>
      )}
    </div>
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

/** Where an emailed link lands. A link from "Forgot your password?" (`reset`) asks for the new one first. */
export function VerifyScreen({ token, next, reset }: { token: string; next: string; reset: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.me });
    router.replace(next);
  };

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-sm space-y-4 px-4 py-10">
        {reset ? <NewPasswordFromLink token={token} onDone={done} /> : <OpenLink token={token} onDone={done} />}
      </main>
    </div>
  );
}

/** Signs in with the link straight away, then offers a password to a player who has none. */
function OpenLink({ token, onDone }: { token: string; onDone(): Promise<void> }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [offerPassword, setOfferPassword] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .verifyEmail(token)
      .then(async ({ hasPassword }) => {
        if (hasPassword) return onDone();
        await queryClient.invalidateQueries({ queryKey: keys.me });
        setOfferPassword(true);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [token, onDone, queryClient]);

  if (error) return <LinkFailed message={error} />;
  if (offerPassword) return <ChoosePassword onDone={onDone} />;
  return <Spinner label="Signing you in" />;
}

function ChoosePassword({ onDone }: { onDone(): Promise<void> }) {
  const me = useMe();
  const [password, setPassword] = useState('');
  const save = useMutation({ mutationFn: () => api.setPassword(password), onSuccess: onDone });
  const valid = passwordSchema.safeParse(password).success;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <h1 className="text-3xl font-bold">You&rsquo;re signed in</h1>
      <p className="text-muted">Choose a password to sign in with your email next time, without waiting for a link.</p>
      {/* Tells password managers which account the new password belongs to. */}
      <input type="email" autoComplete="username" value={me.data?.user?.email ?? ''} readOnly hidden />
      <PasswordInput
        label="Password"
        hint="At least 8 characters."
        autoComplete="new-password"
        required
        value={password}
        onChange={setPassword}
      />
      {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary flex-1" disabled={!valid || save.isPending}>
          Save password
        </button>
        <button type="button" className="btn btn-ghost" disabled={save.isPending} onClick={() => void onDone()}>
          Not now
        </button>
      </div>
    </form>
  );
}

/** A link from "Forgot your password?": the new password goes in before the link is used up. */
function NewPasswordFromLink({ token, onDone }: { token: string; onDone(): Promise<void> }) {
  const [password, setPassword] = useState('');
  const open = useMutation({
    mutationFn: (keepPassword: boolean) => api.verifyEmail(token, keepPassword ? undefined : password),
    onSuccess: onDone,
  });
  const valid = passwordSchema.safeParse(password).success;

  // A refused password can be tried again; a used or expired link can't.
  if (open.error instanceof ApiError && open.error.code === 'link-expired') {
    return <LinkFailed message={open.error.message} />;
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) open.mutate(false);
      }}
    >
      <h1 className="text-3xl font-bold">Choose a new password</h1>
      <PasswordInput
        label="New password"
        hint="At least 8 characters. Saving it signs you out everywhere else."
        autoComplete="new-password"
        required
        value={password}
        onChange={setPassword}
      />
      {open.error && <Notice tone="error">{errorMessage(open.error)}</Notice>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || open.isPending}>
        Save and sign in
      </button>
      <button
        type="button"
        className="btn btn-ghost w-full"
        disabled={open.isPending}
        onClick={() => open.mutate(true)}
      >
        Sign in without changing it
      </button>
    </form>
  );
}

function LinkFailed({ message }: { message: string }) {
  return (
    <>
      <Notice tone="error">{message}</Notice>
      <a href="/login" className="btn btn-ghost">
        Back to sign in
      </a>
    </>
  );
}
