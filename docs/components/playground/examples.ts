// The playground's starting points: recognisable layouts, not feature swatches.
//
// Each one is a layout a reader has built before in CSS — a holy grail page, a
// card wall, a chat thread — expressed in this library's vocabulary. That is
// the pitch the playground has to make in the first ten seconds: not "here is
// what `alignItems` does", but "the thing you already build, without a
// browser".
//
// Every source is subject to the same rules as a docs demo (docs-demos.test.ts
// asserts them): annotation-free JavaScript, because demos run un-transpiled
// before Monaco loads, and a Prettier fixpoint at printWidth 60, so the format
// button is a no-op until the reader edits.
//
// Every root is fluid — `width: '100%'` — so dragging the viewport reflows the
// layout instead of leaving a fixed box adrift in an empty pane. Fixed sizes
// appear only *inside* a layout, where they are the point: a 140px nav, a
// 260px dialog, the avatar in a media object.

export interface PlaygroundExample {
  /** Tab label. Short: these sit in a horizontal strip. */
  name: string;
  /** One line under the tabs, saying what to look at. */
  blurb: string;
  source: string;
}

export const EXAMPLES: PlaygroundExample[] = [
  {
    name: 'Holy grail',
    blurb:
      'Header, footer, fluid centre, two fixed side columns — the classic page. Drag the viewport: only the centre moves.',
    source: `import { LayoutNode } from 'bento-layout';

const header = LayoutNode.make({ height: 48 });
const nav = LayoutNode.make({ width: 140 });
const main = LayoutNode.make({ flexGrow: 1, minWidth: 0 });
const aside = LayoutNode.make({ width: 110 });
const footer = LayoutNode.make({ height: 36 });

const body = LayoutNode.make(
  { flexGrow: 1, columnGap: 12 },
  [nav, main, aside],
);

const page = LayoutNode.make(
  {
    flexDirection: 'column',
    width: '100%',
    height: 380,
    padding: 12,
    rowGap: 12,
  },
  [header, body, footer],
);

renderPlayground(page);`,
  },
  {
    name: 'Card wall',
    blurb:
      'One auto-fill track list is the whole responsive grid: the column count follows the viewport, with no media queries.',
    source: `import { LayoutNode } from 'bento-layout';

const cards = Array.from({ length: 8 }, () =>
  LayoutNode.make({ padding: 8 }, [
    LayoutNode.make({ height: 70 }),
    LayoutNode.make({ height: 12, marginTop: 8 }),
  ]),
);

const wall = LayoutNode.make(
  {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: [
      {
        repeat: 'auto-fill',
        tracks: [{ min: 160, max: { fr: 1 } }],
      },
    ],
    gap: 12,
  },
  cards,
);

renderPlayground(wall);`,
  },
  {
    name: 'Media object',
    blurb:
      'A fixed avatar beside text that takes the rest. minWidth: 0 is what lets the text column shrink below its content.',
    source: `import { LayoutNode } from 'bento-layout';

const row = (lines = 3) =>
  LayoutNode.make({ columnGap: 12, padding: 12 }, [
    LayoutNode.make({ width: 48, height: 48 }),
    LayoutNode.make(
      {
        flexDirection: 'column',
        flexGrow: 1,
        minWidth: 0,
        rowGap: 6,
      },
      Array.from({ length: lines }, () =>
        LayoutNode.make({ height: 10 }),
      ),
    ),
  ]);

const feed = LayoutNode.make(
  { flexDirection: 'column', width: '100%', rowGap: 8 },
  [row(3), row(2), row(4)],
);

renderPlayground(feed);`,
  },
  {
    name: 'Chat thread',
    blurb:
      "Alternating alignSelf puts bubbles on opposite sides; maxWidth: '70%' keeps a long message from spanning the pane.",
    source: `import { LayoutNode } from 'bento-layout';

const bubble = (height = 30, mine = false) =>
  LayoutNode.make({
    height,
    maxWidth: '70%',
    width: mine ? '55%' : '70%',
    alignSelf: {
      keyword: mine ? 'flex-end' : 'flex-start',
      safe: false,
    },
  });

const thread = LayoutNode.make(
  {
    flexDirection: 'column',
    width: '100%',
    padding: 12,
    rowGap: 8,
  },
  [
    bubble(34, false),
    bubble(22, true),
    bubble(48, false),
    bubble(22, true),
    bubble(34, true),
  ],
);

renderPlayground(thread);`,
  },
  {
    name: 'Sticky footer',
    blurb: 'The content column grows to push the footer down, so a short page still puts the footer at the bottom.',
    source: `import { LayoutNode } from 'bento-layout';

const header = LayoutNode.make({ height: 44 });
const content = LayoutNode.make(
  {
    flexGrow: 1,
    padding: 12,
    rowGap: 10,
    flexDirection: 'column',
  },
  [
    LayoutNode.make({ height: 16 }),
    LayoutNode.make({ height: 16, width: '80%' }),
    LayoutNode.make({ height: 16, width: '60%' }),
  ],
);
const footer = LayoutNode.make({ height: 40 });

const page = LayoutNode.make(
  { flexDirection: 'column', width: '100%', height: 320 },
  [header, content, footer],
);

renderPlayground(page);`,
  },
  {
    name: 'Toolbar',
    blurb: 'An auto left margin absorbs the free space, pushing everything after it to the right — no spacer element.',
    source: `import { LayoutNode } from 'bento-layout';

const button = (width = 32) =>
  LayoutNode.make({ width, height: 28 });

const toolbar = LayoutNode.make(
  {
    width: '100%',
    height: 52,
    padding: 12,
    columnGap: 8,
    alignItems: { keyword: 'center', safe: false },
  },
  [
    button(32),
    button(64),
    button(48),
    LayoutNode.make({
      width: 72,
      height: 28,
      marginLeft: 'auto',
    }),
    button(32),
  ],
);

renderPlayground(toolbar);`,
  },
  {
    name: 'Dashboard',
    blurb:
      'Grid placement: a banner spanning every column and a panel spanning two rows, with the rest flowing around them.',
    source: `import { LayoutNode } from 'bento-layout';

const banner = LayoutNode.make({
  gridColumnStart: { line: 1 },
  gridColumnEnd: { line: -1 },
  height: 56,
});

const tall = LayoutNode.make({ gridRowEnd: { span: 2 } });

const board = LayoutNode.make(
  {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: [
      {
        repeat: 3,
        tracks: [{ min: 100, max: { fr: 1 } }],
      },
    ],
    gridAutoRows: [{ min: 80, max: 80 }],
    gap: 12,
  },
  [
    banner,
    tall,
    LayoutNode.make({}),
    LayoutNode.make({}),
    LayoutNode.make({}),
    LayoutNode.make({}),
  ],
);

renderPlayground(board);`,
  },
  {
    name: 'Centered modal',
    blurb: "A uniform margin: 'auto' centres a box on both axes at once — no alignment properties, no transforms.",
    source: `import { LayoutNode } from 'bento-layout';

const dialog = LayoutNode.make(
  {
    width: 260,
    margin: 'auto',
    padding: 16,
    rowGap: 12,
    flexDirection: 'column',
  },
  [
    LayoutNode.make({ height: 18, width: '60%' }),
    LayoutNode.make({ height: 44 }),
    LayoutNode.make({
      height: 30,
      width: 96,
      alignSelf: { keyword: 'flex-end', safe: false },
    }),
  ],
);

const backdrop = LayoutNode.make(
  { width: '100%', height: 300 },
  [dialog],
);

renderPlayground(backdrop);`,
  },
];
