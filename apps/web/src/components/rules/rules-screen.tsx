'use client';

import Link from 'next/link';
import { useMe } from '@/lib/queries';
import { AppHeader } from '../app-header';
import { RulesGuide } from './rules-guide';

/** How to play, with the standard settings: open to everyone, signed in or not. */
export function RulesScreen() {
  const me = useMe();
  const user = me.data?.user;
  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <header>
          <h1 className="font-stencil text-[2.5rem] leading-tight tracking-wide">How to play</h1>
          <p className="mt-1 text-lg text-muted">
            The whole game in one page, with each round step by step. Inside a campaign, the Rules button shows the
            settings that campaign plays with.
          </p>
        </header>
        <RulesGuide variant="standard" />
        {me.data && (
          <footer className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
            {user ? (
              <>
                <Link href="/new" className="btn btn-primary">
                  New campaign
                </Link>
                <Link href="/" className="btn btn-ghost">
                  Your campaigns
                </Link>
              </>
            ) : (
              <>
                <p className="w-full text-muted">
                  Ready? Sign in, start a campaign and send the invite link to your group.
                </p>
                <Link href="/login" className="btn btn-primary">
                  Sign in
                </Link>
              </>
            )}
          </footer>
        )}
      </main>
    </div>
  );
}
