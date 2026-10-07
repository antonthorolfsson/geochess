import type { Metadata } from 'next';
import { TutorialScreen } from '@/components/tutorial/tutorial-screen';

export const metadata: Metadata = {
  title: 'Tutorial',
  description:
    'Try Geo Chess before signing in: fight one war on a sample campaign, from choosing a target to the map changing hands.',
};

export default function Page() {
  return <TutorialScreen />;
}
