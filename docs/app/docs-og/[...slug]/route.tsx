import { notFound } from 'next/navigation';
import { renderOg } from '@/lib/og';
import { source } from '@/lib/source';

// Per-page OG cards live here rather than as an `opengraph-image` file beside
// the page, because Next forbids metadata image routes under an *optional*
// catch-all ([[...slug]]) — "optional catch-all must be the last part of the
// URL". The docs route needs to stay optional to serve /docs itself, so the
// cards get their own required catch-all and pages link to them explicitly
// via generateMetadata.
//
// Statically rendered at build time; the site has no runtime rendering. That
// is also why there is no query-string card route (/og?title=…): nothing
// renders at request time to answer it.
export const dynamic = 'force-static';

export function generateStaticParams() {
  return source.generateParams().map(({ slug }) => ({
    slug: [...(slug ?? []), 'image.png'],
  }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  // Drop the trailing "image.png" to recover the page's own slug.
  const pageSlug = slug.slice(0, -1);
  const page = source.getPage(pageSlug);
  if (!page) notFound();

  return renderOg({
    eyebrow: 'Docs',
    title: page.data.title,
    // The frame paints `accent` terracotta as the heading's tail. A page title
    // is one phrase with no natural tail, so it stays whole and unaccented.
    accent: '',
    tagline: page.data.description ?? '',
    // No install line on a reference page — the pill is the landing card's job.
    command: '',
  });
}
