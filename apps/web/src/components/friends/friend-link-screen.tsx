'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import { keys, useFriendLink, useMe } from '@/lib/queries';
import { AppHeader } from '../app-header';
import { Notice, Spinner } from '../ui';

/** Someone's friend link: whose it is, and a button that makes the two friends. */
export function FriendLinkScreen({ code }: { code: string }) {
  const me = useMe();
  const link = useFriendLink(code);
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: () => api.addFriend(code),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.friendLink(code) }),
        queryClient.invalidateQueries({ queryKey: keys.friends }),
      ]),
  });

  const user = me.data?.user;
  const owner = link.data;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-md px-4 py-10">
        {link.isPending || me.isPending ? (
          <Spinner />
        ) : link.error ? (
          <Notice tone="error">{errorMessage(link.error)}</Notice>
        ) : owner ? (
          <div className="panel space-y-5 p-5">
            <div>
              <div className="label">{owner.self ? 'Your friend link' : 'Friend link'}</div>
              <h1 className="mt-1 text-3xl font-bold">{owner.name}</h1>
              <p className="mt-1 text-muted">
                {owner.self
                  ? 'Send this link to someone you want to play with. When they open it, you become friends.'
                  : owner.friends
                    ? `You and ${owner.name} are friends. Either of you can invite the other to a new campaign.`
                    : `Add ${owner.name} as a friend, and you can invite each other to new campaigns.`}
              </p>
            </div>
            {owner.self || owner.friends ? (
              <div className="flex flex-wrap gap-2">
                {owner.friends && (
                  <Link href="/new" className="btn btn-primary">
                    New campaign
                  </Link>
                )}
                <Link href="/" className="btn btn-ghost">
                  Your campaigns
                </Link>
              </div>
            ) : user ? (
              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={add.isPending}
                onClick={() => add.mutate()}
              >
                {add.isPending ? 'Adding…' : 'Add friend'}
              </button>
            ) : (
              <Link href={`/login?next=${encodeURIComponent(`/friend/${code}`)}`} className="btn btn-primary w-full">
                Sign in to add {owner.name}
              </Link>
            )}
            {add.error && <Notice tone="error">{errorMessage(add.error)}</Notice>}
          </div>
        ) : null}
      </main>
    </div>
  );
}
