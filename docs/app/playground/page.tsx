import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/landing/SiteNav';
import { ExamplePicker } from '@/components/playground/ExamplePicker';

export const metadata: Metadata = {
  // Bare title; the root layout's template appends "| bento-layout".
  title: 'Playground',
  description: 'Write real bento-layout code and see the engine lay it out.',
};

export default function PlaygroundPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="ld-display text-3xl">Playground</h1>
          <p className="mt-2 text-fd-muted-foreground">
            Real code, run by the real engine as you type — with type checking, completions, and hover docs against the
            library&apos;s own declarations. <code>renderPlayground(root)</code> lays the tree out against the preview
            viewport and draws it; everything else is exactly what you would write in your own project. Code runs only
            in your browser. Start from an example below and edit it, or drag the viewport&apos;s right edge to see the
            layout reflow. See the{' '}
            <Link href="/docs" className="text-fd-foreground underline">
              docs
            </Link>{' '}
            for the full style vocabulary.
          </p>
        </header>

        <ExamplePicker height={460} />
      </main>
    </>
  );
}
