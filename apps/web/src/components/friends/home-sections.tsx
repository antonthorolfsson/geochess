'use client';

import { joinWords, type FriendView, type InvitationView } from '@empire/rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { togetherText } from '@/lib/friends';
import { keys, useFriends, useInvitations } from '@/lib/queries';
import { Notice, ShareLink, Spinner } from '../ui';

/** Lobbies friends invited the player to, each to join or decline. Nothing when there are none. */
export function InvitationsSection() {
  const invitations = useInvitations();
  if (!invitations.data?.length) return null;
  return (
    <section className="space-y-2" aria-labelledby="invitations-heading">
      <h2 id="invitations-heading" className="label">
        Invitations
      </h2>
      <ul className="space-y-2">
        {invitations.data.map((i) => (
          <InvitationCard key={i.campaignId} invitation={i} />
        ))}
      </ul>
    </section>
  );
}

function InvitationCard({ invitation: i }: { invitation: InvitationView }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.invitations }),
      queryClient.invalidateQueries({ queryKey: keys.campaigns }),
    ]);
  const join = useMutation({
    mutationFn: () => api.acceptInvitation(i.campaignId),
    onSuccess: async ({ id }) => {
      await refresh();
      router.push(`/c/${id}`);
    },
    onError: refresh,
  });
  const decline = useMutation({ mutationFn: () => api.declineInvitation(i.campaignId), onSettled: refresh });
  const full = i.players.length >= i.maxPlayers;
  const pending = join.isPending || decline.isPending;

  return (
    <li className="panel space-y-3 border-amber/70 p-4">
      <div className="min-w-0">
        <div className="label">
          {i.invitedBy.name} invited you{i.hostName !== i.invitedBy.name ? ` · hosted by ${i.hostName}` : ''}
        </div>
        <div className="truncate text-lg font-semibold">{i.name}</div>
        <p className="text-sm text-muted">
          {i.pace === 'live' ? 'Live' : 'Correspondence'} · {i.players.length} of {i.maxPlayers} players:{' '}
          {joinWords(i.players)}
        </p>
      </div>
      {full && <Notice>Every seat is taken for now. You can join if one comes free before the draft.</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={full || pending} onClick={() => join.mutate()}>
          {join.isPending ? 'Joining…' : 'Join'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => decline.mutate()}>
          Decline
        </button>
      </div>
      {(join.error || decline.error) && <Notice tone="error">{errorMessage(join.error ?? decline.error)}</Notice>}
    </li>
  );
}

/** The player's friends, to remove any of, and their friend link for adding someone new. */
export function FriendsSection() {
  const friends = useFriends();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.friends });
  const remove = useMutation({ mutationFn: (userId: string) => api.removeFriend(userId), onSettled: refresh });
  const reset = useMutation({ mutationFn: api.resetFriendLink, onSettled: refresh });
  const error = remove.error ?? reset.error;

  return (
    <section className="panel space-y-3 p-4" aria-labelledby="friends-heading">
      <h2 id="friends-heading" className="label">
        Friends
      </h2>
      <p className="text-sm text-muted">
        Everyone you play a campaign with becomes your friend, so you can invite them to the next one. To add someone
        you haven’t played with, send them your friend link.
      </p>
      {friends.isPending ? (
        <Spinner />
      ) : friends.error ? (
        <Notice tone="error">{errorMessage(friends.error)}</Notice>
      ) : (
        <>
          {friends.data.friends.length > 0 && (
            <ul className="divide-y divide-line rounded-[3px] border border-line">
              {friends.data.friends.map((f) => (
                <FriendRow
                  key={f.userId}
                  friend={f}
                  pending={remove.isPending && remove.variables === f.userId}
                  onRemove={() => {
                    if (confirm(`Remove ${f.name} from your friends? You’ll each drop off the other’s list.`))
                      remove.mutate(f.userId);
                  }}
                />
              ))}
            </ul>
          )}
          <div className="space-y-1">
            <h3 className="label">Your friend link</h3>
            <ShareLink
              path={`/friend/${friends.data.friendCode}`}
              label="Friend link"
              shareTitle="Geo Chess"
              shareText="Add me as a friend on Geo Chess, so we can invite each other to campaigns."
            />
            <button
              type="button"
              className="min-h-11 text-sm text-muted underline underline-offset-2 hover:text-paper"
              disabled={reset.isPending}
              onClick={() => {
                if (confirm('Make a new friend link? The old one will stop working.')) reset.mutate();
              }}
            >
              Reset link
            </button>
          </div>
        </>
      )}
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
    </section>
  );
}

function FriendRow({ friend, pending, onRemove }: { friend: FriendView; pending: boolean; onRemove(): void }) {
  return (
    <li className="flex min-h-12 items-center gap-2 px-3 py-1">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{friend.name}</span>
        <span className="block truncate text-sm text-muted">
          {togetherText(friend)}
          {friend.lichessUsername ? ` · ${friend.lichessUsername} on Lichess` : ''}
        </span>
      </span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}
