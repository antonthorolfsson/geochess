import type { Metadata } from 'next';
import { VerifyScreen } from '@/components/login-screen';
import { safeNext } from '@/lib/paths';

export const metadata: Metadata = { title: 'Signing in' };

export default async function Page({ searchParams }: PageProps<'/login/verify'>) {
  const { token, next, reset } = await searchParams;
  return <VerifyScreen token={typeof token === 'string' ? token : ''} next={safeNext(next)} reset={reset === '1'} />;
}
