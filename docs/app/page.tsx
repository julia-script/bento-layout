import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col justify-center text-center">
      <h1 className="mb-4 text-2xl font-bold">bento-layout</h1>
      <p className="text-fd-muted-foreground">
        Head to <Link href="/docs" className="text-fd-foreground underline">/docs</Link> to get started.
      </p>
    </main>
  );
}
