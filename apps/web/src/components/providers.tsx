'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useMe } from '@/lib/queries';
import { RealtimeProvider } from '@/lib/realtime';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true } } }),
  );

  useEffect(() => {
    // Installable app shell. Only in production, so development always serves fresh code.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SignedInRealtime>{children}</SignedInRealtime>
    </QueryClientProvider>
  );
}

function SignedInRealtime({ children }: { children: ReactNode }) {
  const me = useMe();
  return <RealtimeProvider userId={me.data?.user?.id ?? null}>{children}</RealtimeProvider>;
}
