'use client';

// Scroll reveal: adds data-in once the element enters the viewport. All the
// motion lives in CSS (.ld-reveal), including the reduced-motion opt-out.

import { useEffect, useRef, type ReactNode } from 'react';

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
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.setAttribute('data-in', '');
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`ld-reveal ${className ?? ''}`}
      style={{ ['--reveal-delay' as string]: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
