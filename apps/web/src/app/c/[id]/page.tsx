import { Suspense } from 'react';
import { CampaignScreen } from '@/components/campaign/campaign-screen';

export default async function Page({ params }: PageProps<'/c/[id]'>) {
  const { id } = await params;
  // The screen reads ?war= and ?game= from the URL.
  return (
    <Suspense>
      <CampaignScreen id={id} />
    </Suspense>
  );
}
