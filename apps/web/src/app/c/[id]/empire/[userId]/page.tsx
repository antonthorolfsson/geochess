import { EmpireScreen } from '@/components/empire/empire-screen';

/** An empire's statistics, over the campaign screen. */
export default async function Page({ params }: PageProps<'/c/[id]/empire/[userId]'>) {
  const { userId } = await params;
  return <EmpireScreen userId={userId} />;
}
