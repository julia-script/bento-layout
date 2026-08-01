import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';

const SITE = 'https://bento.jlort.com';

// Derived from the same loader that builds the nav tree, so a new .mdx file
// appears here automatically — no hand-maintained list to drift.
export default function sitemap(): MetadataRoute.Sitemap {
  const docs = source.getPages().map((page) => ({
    url: new URL(page.url, SITE).toString(),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  return [
    { url: SITE, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/playground`, changeFrequency: 'monthly', priority: 0.9 },
    ...docs,
  ];
}
