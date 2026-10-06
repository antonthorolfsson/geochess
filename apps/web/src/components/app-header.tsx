'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useMe } from '@/lib/queries';

/** The globe-and-rook emblem, rendered from media/geochess_logo.png by scripts/make-icons.mjs. */
export function Emblem({ className = 'size-7' }: { className?: string }) {
  return <img src="/icons/emblem.png" alt="" className={className} />;
}

/**
 * The emblem goes home, to the landing page; signed in, the Campaigns button goes to the player's
 * campaigns. `wide` lines the header up with a page wider than the usual column, such as the
 * landing page.
 */
export function AppHeader({ wide = false }: { wide?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const user = me.data?.user;
  // Signed out, every page but sign-in itself offers it, coming back to the page afterwards.
  const signIn = me.data && !user && !pathname.startsWith('/login');

  const signOut = async () => {
    await api.logout().catch(() => {});
    queryClient.clear();
    router.push('/login');
  };

  return (
    <header className="border-b border-line pt-[env(safe-area-inset-top)]">
      <div className={`mx-auto flex h-14 items-center gap-2 px-4 sm:gap-3 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Emblem />
          {/* Where the buttons need the room on a phone, the emblem stands alone; screen readers still hear the name. */}
          <span className={`font-stencil text-lg tracking-[0.08em] ${user ? 'max-sm:sr-only' : 'max-[359px]:sr-only'}`}>
            GEO CHESS
          </span>
        </Link>
        <div className="flex-1" />
        <Link
          href="/rules"
          aria-current={pathname === '/rules' ? 'page' : undefined}
          className={`flex min-h-11 items-center px-1 text-sm font-bold tracking-wider text-muted uppercase hover:text-paper aria-[current=page]:text-paper ${
            user ? 'max-[359px]:hidden' : ''
          }`}
        >
          Rules
        </Link>
        {user && (
          <>
            <Link
              href="/campaigns"
              aria-current={pathname === '/campaigns' ? 'page' : undefined}
              className="btn btn-primary btn-sm min-h-11"
            >
              Campaigns
            </Link>
            <span className="hidden truncate text-sm text-muted sm:inline">{user.name}</span>
            <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={signOut}>
              Sign out
            </button>
          </>
        )}
        {signIn && (
          <Link
            href={pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(pathname)}`}
            className="btn btn-ghost btn-sm min-h-11"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
