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

/** `wide` lines the header up with a page wider than the usual column, such as the landing page. */
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
      <div className={`mx-auto flex h-14 items-center gap-3 px-4 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
        <Link href="/" className="flex items-center gap-2.5">
          <Emblem />
          <span className="font-stencil text-lg tracking-[0.08em]">GEO CHESS</span>
        </Link>
        <div className="flex-1" />
        <Link
          href="/rules"
          aria-current={pathname === '/rules' ? 'page' : undefined}
          className="flex min-h-11 items-center px-1 text-sm font-bold tracking-wider text-muted uppercase hover:text-paper aria-[current=page]:text-paper"
        >
          Rules
        </Link>
        {user && (
          <>
            <span className="hidden truncate text-sm text-muted sm:inline">{user.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
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
