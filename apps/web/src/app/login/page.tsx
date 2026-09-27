import type { Metadata } from 'next';
import { LoginScreen } from '@/components/login-screen';
import { safeNext } from '@/lib/paths';

export const metadata: Metadata = { title: 'Sign in' };

export default async function Page({ searchParams }: PageProps<'/login'>) {
  const { next, error } = await searchParams;
  return <LoginScreen next={safeNext(next)} error={typeof error === 'string' ? error : null} />;
}
