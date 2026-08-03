'use client';

// The playground's example gallery: pick a layout, load it into the editor.
//
// Picking an example REPLACES the editor's contents, including any edits, so
// the tabs are deliberately plain buttons rather than a router — there is no
// URL to come back to and no draft to lose track of.
//
// Deliberately NOT keyed on the example: remounting Demo would throw away the
// reader's zoom, dragged viewport width, and engine toggles every time they
// looked at a different layout, and it made the whole panel flash as Monaco
// tore down and rebuilt. Demo and Editor take a changed source directly, so
// only the code and the preview change.

import { useState } from 'react';
import { Demo } from './Demo.js';
import { EXAMPLES } from './examples.js';

export function ExamplePicker({ height }: { height?: number }) {
  const [index, setIndex] = useState(0);
  const example = EXAMPLES[index] ?? EXAMPLES[0];
  if (!example) return null;

  return (
    <>
      {/* Tabs, not a <select>: the whole point is that the reader can see the
          range of layouts on offer without opening anything. */}
      <div className="fd-pg-examples" role="tablist" aria-label="Example layouts">
        {EXAMPLES.map((item, i) => (
          <button
            key={item.name}
            type="button"
            role="tab"
            aria-selected={i === index}
            className="fd-pg-example"
            data-active={i === index ? '' : undefined}
            onClick={() => setIndex(i)}
          >
            {item.name}
          </button>
        ))}
      </div>

      <p className="fd-pg-blurb">{example.blurb}</p>

      <Demo height={height}>{example.source}</Demo>
    </>
  );
}
