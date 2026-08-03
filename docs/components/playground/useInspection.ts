'use client';

// Which node the reader is looking at, devtools-style.
//
// Two sources with a precedence rule between them, plus the dismiss handlers
// they need — small, but self-contained, and it is one fewer thing tangled
// into Demo's render.

import { useEffect, useState } from 'react';
import type { HoveredNode } from './LayoutBox.js';

export interface Inspection {
  /** The node the badge and highlight describe, if any. */
  inspected: HoveredNode | null;
  setHovered: (node: HoveredNode | null) => void;
  setSelected: (node: HoveredNode | null) => void;
}

export function useInspection(): Inspection {
  // Hover is transient; selection survives the pointer leaving. On touch there
  // is no hover at all, so tapping a node is the only way to inspect it.
  const [hovered, setHovered] = useState<HoveredNode | null>(null);
  const [selected, setSelected] = useState<HoveredNode | null>(null);

  // Clicking anywhere that is not a node clears the selection. Bound to the
  // document rather than the stage so a click outside the demo dismisses it
  // too; the rects call stopPropagation, so their own clicks never reach here.
  useEffect(() => {
    if (!selected) return;
    const clear = () => setSelected(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    document.addEventListener('click', clear);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', clear);
      document.removeEventListener('keydown', onKey);
    };
  }, [selected]);

  // The pointer wins while it is over a node, otherwise the last tap stands.
  return { inspected: hovered ?? selected, setHovered, setSelected };
}
