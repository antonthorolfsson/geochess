import type { Metadata } from 'next';
import { JoinScreen } from '@/components/join-screen';

export const metadata: Metadata = { title: 'Join campaign' };

export default async function Page({ params }: PageProps<'/join/[code]'>) {
  const { code } = await params;
  return <JoinScreen code={code} />;
}
