'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { keys, useInvite, useMe } from '@/lib/queries';
import { AppHeader } from './app-header';
import { Notice, Spinner } from './ui';

export function JoinScreen({ code }: { code: string }) {
  const me = useMe();
  const invite = useInvite(code);
  const router = useRouter();
  const queryClient = useQueryClient();
  const join = useMutation({
    mutationFn: () => api.join(code),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: keys.campaigns });
      router.push(`/c/${id}`);
    },
  });

  const user = me.data?.user;
  const c = invite.data?.campaign;
  const full = c ? c.memberCount >= c.maxPlayers : false;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-md px-4 py-10">
        {invite.isPending || me.isPending ? (
          <Spinner />
        ) : invite.error ? (
          <Notice tone="error">{errorMessage(invite.error)}</Notice>
        ) : c ? (
          <div className="panel space-y-5 p-5">
            <div>
              <div className="label">Invitation from {c.hostName}</div>
              <h1 className="mt-1 text-3xl font-bold">{c.name}</h1>
              <p className="mt-1 text-muted">
                {c.memberCount} of {c.maxPlayers} seats taken.
              </p>
            </div>
            {invite.data?.isMember ? (
              <Link href={`/c/${c.id}`} className="btn btn-primary w-full">
                Open campaign
              </Link>
            ) : c.status !== 'lobby' ? (
              <Notice>This campaign has already started.</Notice>
            ) : full ? (
              <Notice>This campaign is full.</Notice>
            ) : user ? (
              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={join.isPending}
                onClick={() => join.mutate()}
              >
                {join.isPending ? 'Joining…' : `Join as ${user.name}`}
              </button>
            ) : (
              <Link href={`/login?next=${encodeURIComponent(`/join/${code}`)}`} className="btn btn-primary w-full">
                Sign in to join
              </Link>
            )}
            {join.error && <Notice tone="error">{errorMessage(join.error)}</Notice>}
          </div>
        ) : null}
      </main>
    </div>
  );
}
