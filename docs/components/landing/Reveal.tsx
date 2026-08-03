'use client';

// Scroll reveal: adds data-in once the element enters the viewport, and runs
// the count-up on any [data-count] inside it. All the motion lives in CSS
// (.ld-reveal), including the reduced-motion opt-out.
//
// An IntersectionObserver alone is not enough: where IO is throttled or never
// fires (some capture/export tools, certain embeds), every revealed section
// stays at opacity 0 and the whole page below the fold renders as blank
// ground. So the element is ALSO measured on mount, scroll, and resize. IO is
// kept for its timing; the measurement is the guarantee.

import { type ReactNode, useEffect, useRef } from 'react';

const COUNT_MS = 1300;

function animateCount(el: HTMLElement) {
  const target = Number.parseInt(el.getAttribute('data-count') ?? '', 10);
  if (!target) return; // 0 and NaN render as authored
  const t0 = performance.now();
  const tick = (t: number) => {
    const p = Math.min(1, (t - t0) / COUNT_MS);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = Math.round(target * eased).toLocaleString('en-US');
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Stagger, in ms, applied via --reveal-delay. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let io: IntersectionObserver | null = null;
    let raf = 0;
    let done = false;

    // Once revealed, stay revealed: re-hiding on scroll-out would replay the
    // entrance every time the section crosses the viewport edge.
    const reveal = () => {
      if (done) return;
      done = true;
      el.setAttribute('data-in', '');
      for (const n of el.querySelectorAll<HTMLElement>('[data-count]')) animateCount(n);
      io?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };

    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight - 40 && r.bottom > 0) reveal();
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };

    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) reveal();
        },
        { threshold: 0.15 },
      );
      io.observe(el);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    measure();

    return () => {
      io?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className={`ld-reveal ${className ?? ''}`} style={{ ['--reveal-delay' as string]: `${delay}ms` }}>
      {children}
    </div>
  );
}
