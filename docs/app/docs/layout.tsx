import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{ title: 'bento-layout' }}
      // Light-only site — the switch would write a preference nothing reads.
      themeSwitch={{ enabled: false }}
    >
      {children}
    </DocsLayout>
  );
}
