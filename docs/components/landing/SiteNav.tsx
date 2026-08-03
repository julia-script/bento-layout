import Link from 'next/link';

export function BentoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" className={className} aria-hidden="true">
      {/* Rounder corners than the previous mark, per the Organic system. */}
      <rect x="2" y="3.5" width="20" height="17" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="11" y1="3.5" x2="11" y2="20.5" stroke="currentColor" strokeWidth="1.8" />
      <line x1="11" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6.5" cy="12" r="2.2" fill="var(--organic-accent)" stroke="none" />
    </svg>
  );
}

/** The landing/playground top nav; the docs pages keep fumadocs' own chrome.
 *  z-20 keeps it above the hero's decorative circles, which otherwise cover
 *  the "Get started" pill. */
export function SiteNav() {
  return (
    <nav className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-6 py-[22px]">
      <Link href="/" className="flex items-center gap-2.5 text-fd-foreground no-underline">
        <BentoMark />
        <span className="ld-display text-[19px]">bento-layout</span>
      </Link>
      <div className="flex items-center gap-1 text-sm sm:gap-2">
        <Link href="/docs" className="ld-navlink">
          Docs
        </Link>
        <Link href="/playground" className="ld-navlink">
          Playground
        </Link>
        {/* Hidden on phones: it points at /docs, same as the link beside it, so
            dropping it costs no destination and buys the row enough width to
            fit without scrolling the page sideways. */}
        <Link href="/docs" className="ld-btn ld-btn-primary hidden sm:inline-flex">
          Get started
        </Link>
      </div>
    </nav>
  );
}
