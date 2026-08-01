import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

const SITE = 'https://bento.jlort.com';
const DESCRIPTION =
  'A layout engine for TypeScript: style data in, pixel positions out. Flexbox, grid, and block layout with no WASM, no async loader, and no dependencies.';

// metadataBase is what makes the OG image URLs absolute. Without it Next emits
// root-relative paths and most link-preview scrapers reject them, which fails
// silently — the tags are present, the card is blank.
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    // Pages set a bare title ("Getting Started"); this appends the project.
    template: '%s | bento-layout',
    default: 'bento-layout — flexbox, grid & block layout in plain TypeScript',
  },
  description: DESCRIPTION,
  applicationName: 'bento-layout',
  openGraph: {
    type: 'website',
    siteName: 'bento-layout',
    url: SITE,
    title: 'bento-layout — flexbox, grid & block layout in plain TypeScript',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'bento-layout — flexbox, grid & block layout in plain TypeScript',
    description: DESCRIPTION,
  },
};

// Paper tokens from global.css, so the browser chrome matches the page in both
// schemes rather than defaulting to white.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'hsl(40, 45%, 97%)' },
    { media: '(prefers-color-scheme: dark)', color: 'hsl(30, 8%, 11%)' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Display serif for headings; falls back to system mincho/serif when
            offline. React hoists these into <head>. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          precedence="default"
          href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600&display=swap"
        />
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
