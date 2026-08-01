import { generateOGImage } from 'fumadocs-ui/og';

// Hero card for the landing page and any route without its own image.
// Docs pages override this with a per-page card (see docs/[[...slug]]).
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'bento-layout — flexbox, grid & block layout in plain TypeScript';

/** The bento mark from app/icon.svg, scaled for the card. */
function BentoMark() {
  return (
    <svg width="72" height="72" viewBox="0 0 32 32">
      <rect
        x="2"
        y="4"
        width="28"
        height="24"
        rx="6"
        fill="#FAF6EF"
        stroke="#2E2A24"
        strokeWidth="2.2"
      />
      <line x1="14.5" y1="4" x2="14.5" y2="28" stroke="#2E2A24" strokeWidth="2" />
      <line x1="14.5" y1="16" x2="30" y2="16" stroke="#2E2A24" strokeWidth="2" />
      <circle cx="8.25" cy="16" r="3.4" fill="#E8896B" />
    </svg>
  );
}

export default function Image() {
  return generateOGImage({
    title: 'bento-layout',
    description:
      'Flexbox, grid & block layout in plain TypeScript. Style data in, pixel positions out — no WASM, no dependencies.',
    site: 'bento.jlort.com',
    icon: <BentoMark />,
    // Coral on washi paper, matching the site's light theme.
    primaryColor: 'hsl(13, 72%, 62%)',
    primaryTextColor: 'hsl(35, 12%, 16%)',
    ...size,
  });
}
