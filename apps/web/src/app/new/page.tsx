import type { Metadata } from 'next';
import { NewCampaignScreen } from '@/components/new-campaign-screen';

export const metadata: Metadata = { title: 'New campaign' };

export default function Page() {
  return <NewCampaignScreen />;
}
