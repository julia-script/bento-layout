import Link from 'next/link';
import type { Metadata } from 'next';
import { Demo } from '@/components/playground/Demo';
import { SiteNav } from '@/components/landing/SiteNav';

const SEED = `<Layout>
  <Node style={{width: '480px', height: '260px', display: 'flex',
                padding: '16px', gap: '12px'}}>
    <Node style={{width: '120px'}} />
    <Node style={{flexGrow: 1, alignItems: 'center',
                  justifyContent: 'center'}}>
      <Node style={{width: '80px', height: '80px'}} />
    </Node>
  </Node>
</Layout>`;

export const metadata: Metadata = {
  // Bare title; the root layout's template appends "| bento-layout".
  title: 'Playground',
  description: 'Edit a layout tree and see bento-layout lay it out.',
};

export default function PlaygroundPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="ld-display text-3xl">Playground</h1>
          <p className="mt-2 text-fd-muted-foreground">
            Edit the tree on the left; the engine lays it out on the right. Sizes accept
            CSS-shaped strings such as <code>100px</code>, <code>50%</code>, and{' '}
            <code>1fr</code>. See the{' '}
            <Link href="/docs" className="text-fd-foreground underline">
              docs
            </Link>{' '}
            for the full style vocabulary.
          </p>
        </header>

        <Demo height={460}>{SEED}</Demo>
      </main>
    </>
  );
}
