import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="label">Off the map</div>
      <h1 className="text-3xl font-bold">There's nothing here.</h1>
      <Link href="/" className="btn btn-ghost">
        Back to your campaigns
      </Link>
    </main>
  );
}
