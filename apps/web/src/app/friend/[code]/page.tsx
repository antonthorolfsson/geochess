import type { Metadata } from 'next';
import { FriendLinkScreen } from '@/components/friends/friend-link-screen';

export const metadata: Metadata = { title: 'Add a friend' };

export default async function Page({ params }: PageProps<'/friend/[code]'>) {
  const { code } = await params;
  return <FriendLinkScreen code={code} />;
}
