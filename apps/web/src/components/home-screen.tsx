'use client';

import { useMe } from '@/lib/queries';
import { AppHeader } from './app-header';
import { Landing } from './landing/landing';

/**
 * The home page: the game, how it plays and the way in, for everyone. Signed in, the way in leads
 * to the player's campaigns (`/campaigns`, also the header's Campaigns button).
 */
export function HomeScreen() {
  const me = useMe();
  return (
    <div className="min-h-dvh">
      <AppHeader wide />
      <Landing user={me.isPending ? undefined : (me.data?.user ?? null)} />
    </div>
  );
}
