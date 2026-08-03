import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

/* --- Shared OG image frame -----------------------------------------------
   One renderer behind both the landing card and the per-page docs cards, so
   every card in the wild is the same card.

   Satori (what next/og renders with) is not a browser: no CSS variables from
   a stylesheet, no `grid`, no `color-mix()`. So the Organic tokens are written
   here as literal values — copies of the ramps in `app/global.css`, keep them
   in step — and every layout below is flex. -------------------------------- */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

const T = {
  bg: '#f5ead8',
  surface: '#ebddc5',
  text: '#201e1d',
  muted: '#645c50',
  accent: '#c67139',
  accent700: '#8c491a',
  accent100: '#fff2eb',
  accent300: '#ffc6a5',
  sage100: '#f0fae1',
  sage500: '#8fa073',
  neutral200: '#eee7db',
  neutral300: '#dcd3c4',
};

/** Fonts are read off disk, not fetched: the cards are rendered at build time
 *  (the site is fully prerendered), so a network hop here would make the build
 *  depend on fonts.gstatic.com being up. */
async function fonts() {
  const dir = join(process.cwd(), 'public', 'fonts');
  const [heading, body, bodyBold] = await Promise.all([
    readFile(join(dir, 'Caprasimo-Regular.ttf')),
    readFile(join(dir, 'Figtree-Regular.ttf')),
    readFile(join(dir, 'Figtree-SemiBold.ttf')),
  ]);
  return [
    { name: 'Caprasimo', data: heading, weight: 400 as const, style: 'normal' as const },
    { name: 'Figtree', data: body, weight: 400 as const, style: 'normal' as const },
    { name: 'Figtree', data: bodyBold, weight: 600 as const, style: 'normal' as const },
  ];
}

export type OgProps = {
  /** Heading, minus the accented tail word. */
  title?: string;
  /** Last word or phrase of the heading, painted terracotta. */
  accent?: string;
  eyebrow?: string;
  tagline?: string;
  /** Pill in the bottom-left. Pass '' to drop it. */
  command?: string;
};

/** The holy grail — header, nav, main, aside, footer. Drawn as an interface
 *  wireframe rather than a bento tray: white panels on the warm ground, one
 *  terracotta note, skeleton bars instead of labels. */
function HolyGrail() {
  const panel: React.CSSProperties = {
    display: 'flex',
    borderRadius: 12,
    border: '1.5px solid rgba(32,30,29,0.14)',
    background: '#fffdfa',
    padding: 12,
  };
  const bar = (w: number | string, h = 8, c = T.neutral300): React.CSSProperties => ({
    display: 'flex',
    width: w,
    height: h,
    flexShrink: 0,
    borderRadius: 999,
    background: c,
  });
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 440,
        height: 372,
        padding: 16,
        gap: 12,
        borderRadius: 24,
        border: `1.5px solid ${T.neutral300}`,
        background: T.surface,
        boxShadow: '0 20px 36px -20px rgba(32,30,29,0.42)',
      }}
    >
      {/* header */}
      <div style={{ ...panel, height: 46, alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', width: 18, height: 18, borderRadius: 999, background: T.accent }} />
        <div style={bar(52)} />
        <div style={{ display: 'flex', flex: 1 }} />
        <div style={bar(34)} />
        <div style={bar(34)} />
        <div style={bar(46, 20, T.accent300)} />
      </div>

      <div style={{ display: 'flex', flex: 1, gap: 12 }}>
        {/* nav */}
        <div style={{ ...panel, width: 92, flexDirection: 'column', gap: 10 }}>
          <div style={bar('100%', 20, T.accent100)} />
          <div style={bar('78%')} />
          <div style={bar('88%')} />
          <div style={bar('64%')} />
        </div>

        {/* main */}
        <div style={{ ...panel, flex: 1, flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', height: 62, borderRadius: 8, background: T.sage100 }} />
          <div style={bar('92%')} />
          <div style={bar('100%')} />
          <div style={bar('70%')} />
          <div style={{ display: 'flex', flex: 1, gap: 10, marginTop: 2 }}>
            <div style={{ display: 'flex', flex: 1, borderRadius: 8, background: T.neutral200 }} />
            <div style={{ display: 'flex', flex: 1, borderRadius: 8, background: T.neutral200 }} />
          </div>
        </div>

        {/* aside */}
        <div style={{ ...panel, width: 82, flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', height: 54, borderRadius: 8, background: T.neutral200 }} />
          <div style={bar('84%')} />
          <div style={bar('60%')} />
        </div>
      </div>

      {/* footer */}
      <div style={{ ...panel, height: 34, alignItems: 'center', gap: 10 }}>
        <div style={bar(40, 6)} />
        <div style={bar(28, 6)} />
        <div style={bar(34, 6)} />
      </div>
    </div>
  );
}

/** The nav mark from components/landing/SiteNav, with literal colors —
 *  `currentColor` and CSS variables both resolve to nothing under satori. */
function Mark() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24">
      <rect x="2" y="3.5" width="20" height="17" rx="6" fill="none" stroke={T.text} strokeWidth="2" />
      <line x1="11" y1="3.5" x2="11" y2="20.5" stroke={T.text} strokeWidth="1.8" />
      <line x1="11" y1="12" x2="22" y2="12" stroke={T.text} strokeWidth="1.8" />
      <circle cx="6.5" cy="12" r="2.2" fill={T.accent} />
    </svg>
  );
}

export async function renderOg({
  title = 'Flexbox, Grid and block layout in plain',
  accent = 'TypeScript.',
  eyebrow = 'a layout engine for TypeScript',
  tagline = 'Style data in, pixel positions out — no WASM, no async init, no node lifecycles. Verified against Chrome.',
  command = 'npm install bento-layout',
}: OgProps = {}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: T.bg,
          fontFamily: 'Figtree',
          color: T.text,
        }}
      >
        {/* Soft shapes — the system's decoration, kept behind the content. */}
        <div
          style={{
            position: 'absolute',
            top: -190,
            right: 250,
            width: 520,
            height: 520,
            borderRadius: 999,
            background: T.surface,
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -150,
            left: -110,
            width: 340,
            height: 340,
            borderRadius: 999,
            background: T.sage100,
          }}
        />

        <div
          style={{
            position: 'relative',
            display: 'flex',
            width: '100%',
            height: '100%',
            padding: '58px 64px',
            alignItems: 'center',
            gap: 40,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Mark />
              <span style={{ fontFamily: 'Caprasimo', fontSize: 26 }}>bento-layout</span>
            </div>

            <div
              style={{
                display: 'flex',
                marginTop: 26,
                alignSelf: 'flex-start',
                padding: '8px 20px',
                borderRadius: 999,
                background: T.accent100,
                color: T.accent700,
                fontSize: 21,
                fontWeight: 600,
              }}
            >
              {eyebrow}
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                marginTop: 20,
                fontFamily: 'Caprasimo',
                fontSize: 48,
                lineHeight: 1.08,
                letterSpacing: '-0.015em',
              }}
            >
              <span style={{ marginRight: 16 }}>{title}</span>
              {accent ? <span style={{ color: T.accent700 }}>{accent}</span> : null}
            </div>

            <div
              style={{
                display: 'flex',
                marginTop: 22,
                maxWidth: 560,
                fontSize: 23,
                lineHeight: 1.4,
                color: T.muted,
              }}
            >
              {tagline}
            </div>

            {command ? (
              <div
                style={{
                  display: 'flex',
                  marginTop: 30,
                  alignSelf: 'flex-start',
                  padding: '12px 24px',
                  borderRadius: 999,
                  border: `2px solid ${T.neutral300}`,
                  background: '#fdfbf8',
                  fontSize: 22,
                  color: T.text,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ color: T.sage500, marginRight: 12 }}>$</span>
                <span style={{ flexShrink: 0 }}>{command}</span>
              </div>
            ) : null}
          </div>

          <HolyGrail />
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await fonts() },
  );
}
