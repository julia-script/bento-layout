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

// Organic ground token from global.css, so the browser chrome matches the page
// rather than defaulting to white. Light-only: the site forces one scheme.
export const viewport: Viewport = {
  themeColor: '#f5ead8',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Organic pairing: Caprasimo display over Figtree body; both fall back
            to system-ui when offline. React hoists these into <head>. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          precedence="default"
          href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;600;700&display=swap"
        />
        {/* Light-only. The provider stays enabled — `enabled: false` skips
            ThemeProvider entirely, which would drop forcedTheme with it. */}
        <RootProvider theme={{ forcedTheme: 'light', enableSystem: false, hotKey: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}
