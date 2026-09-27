import { Suspense } from 'react';
import { CampaignScreen } from '@/components/campaign/campaign-screen';

/**
 * The campaign screen lives in the layout, so pages opened over it (an empire's statistics) leave
 * the map, tabs and panels as they were.
 */
export default async function Layout({ children, params }: LayoutProps<'/c/[id]'>) {
  const { id } = await params;
  // The screen reads ?war=, ?game=, ?chat= and ?accord= from the URL.
  return (
    <Suspense>
      <CampaignScreen id={id}>{children}</CampaignScreen>
    </Suspense>
  );
}
