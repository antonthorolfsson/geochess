import type { Metadata } from 'next';
import { CampaignsScreen } from '@/components/campaigns-screen';

export const metadata: Metadata = { title: 'Your campaigns' };

export default function Page() {
  return <CampaignsScreen />;
}
