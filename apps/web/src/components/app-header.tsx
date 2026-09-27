'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useMe } from '@/lib/queries';

export function Emblem({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="10" fill="#2b3238" />
      <circle cx="32" cy="32" r="21" fill="#4b5320" stroke="#e4e2d8" strokeWidth="2.5" />
      <path d="M11 32h42M32 11c-8 6-8 36 0 42M32 11c8 6 8 36 0 42" fill="none" stroke="#1f2428" strokeWidth="2" />
      <path d="M17 44 C 26 36, 36 30, 47 22" fill="none" stroke="#c8372d" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M40 20 L48 21 L46 29"
        fill="none"
        stroke="#c8372d"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AppHeader() {
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = me.data?.user;

  const signOut = async () => {
    await api.logout().catch(() => {});
    queryClient.clear();
    router.push('/login');
  };

  return (
    <header className="border-b border-line pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Emblem />
          <span className="font-stencil text-lg tracking-[0.08em]">EMPIRE CHESS</span>
        </Link>
        <div className="flex-1" />
        {user && (
          <>
            <span className="hidden truncate text-sm text-muted sm:inline">{user.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  );
}
