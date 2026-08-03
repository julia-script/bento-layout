import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { BentoMark } from '@/components/landing/SiteNav';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      // The same mark the landing header uses, so the two navs read as one site.
      nav={{
        title: (
          <span className="flex items-center gap-2">
            <BentoMark />
            <span className="ld-display text-[17px]">bento-layout</span>
          </span>
        ),
      }}
      // Without this the playground is unreachable from every docs page: the
      // landing nav links to it, but fumadocs' chrome replaces that nav here.
      links={[{ text: 'Playground', url: '/playground' }]}
      // Light-only site — the switch would write a preference nothing reads.
      themeSwitch={{ enabled: false }}
    >
      {children}
    </DocsLayout>
  );
}
