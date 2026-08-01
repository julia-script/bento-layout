import Link from 'next/link';

export function BentoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" className={className} aria-hidden="true">
      <rect x="2" y="3.5" width="20" height="17" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <line x1="11" y1="3.5" x2="11" y2="20.5" stroke="currentColor" strokeWidth="1.6" />
      <line x1="11" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6.5" cy="12" r="2" fill="var(--bento-coral)" stroke="none" />
    </svg>
  );
}

/** The landing/playground top nav; the docs pages keep fumadocs' own chrome. */
export function SiteNav() {
  return (
    <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <Link href="/" className="flex items-center gap-2.5 text-fd-foreground">
        <BentoMark />
        <span className="ld-display text-lg">bento-layout</span>
      </Link>
      <div className="flex items-center gap-6 text-sm text-fd-muted-foreground">
        <Link href="/docs" className="transition-colors hover:text-fd-foreground">
          Docs
        </Link>
        <Link href="/playground" className="transition-colors hover:text-fd-foreground">
          Playground
        </Link>
      </div>
    </nav>
  );
}
