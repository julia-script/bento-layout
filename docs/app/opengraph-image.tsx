import { OG_CONTENT_TYPE, OG_SIZE, renderOg } from '@/lib/og';

// Hero card for the landing page and any route without its own image.
// Docs pages override this with a per-page card (see app/docs-og).
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'bento-layout — flexbox, grid & block layout in plain TypeScript';

export default async function Image() {
  // The frame's defaults are the landing copy.
  return renderOg();
}
