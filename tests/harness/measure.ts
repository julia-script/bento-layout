// The standard test measure functions,
// including Ahem-font text measurement (each glyph is a 10x10 square, wrapping
// at zero-width-space boundaries).

import type { AvailableSpace, MeasureFunction, Size } from '../../src/index.js';
import type { Opt } from '../../src/math.js';

export type WritingMode = 'horizontal' | 'vertical';

const ZWS = '​';
const H_WIDTH = 10;
const H_HEIGHT = 10;

export function ahemTextMeasure(textContent: string, writingMode: WritingMode): MeasureFunction {
  return (knownDimensions, availableSpace) => {
    if (knownDimensions.width !== null && knownDimensions.height !== null) {
      return { width: knownDimensions.width, height: knownDimensions.height };
    }
    const computed = measureAhem(textContent, writingMode, knownDimensions, availableSpace);
    return {
      width: knownDimensions.width ?? computed.width,
      height: knownDimensions.height ?? computed.height,
    };
  };
}

function measureAhem(
  textContent: string,
  writingMode: WritingMode,
  knownDimensions: Size<Opt>,
  availableSpace: Size<AvailableSpace>,
): Size<number> {
  // Break opportunities are ZWS *and* the ordinary space — WPT prose relies on
  // spaces, and Chrome wraps it (`AA BB` in Ahem: 50 wide at max-content, but
  // 20x20 at min-content, i.e. two 2-glyph lines). ZWS is zero-width, while a
  // space occupies a cell whenever the line does *not* break there, so the two
  // separators are tracked apart rather than both being dropped by `split`.
  const lines: string[] = [];
  const sepWidths: number[] = [];
  {
    let current = '';
    for (const ch of textContent) {
      if (ch === ZWS || ch === ' ') {
        lines.push(current);
        sepWidths.push(ch === ' ' ? 1 : 0);
        current = '';
      } else {
        current += ch;
      }
    }
    lines.push(current);
  }
  if (lines.length === 0) return { width: 0, height: 0 };

  const inlineAxis = writingMode === 'horizontal' ? 'width' : 'height';
  const blockAxis = inlineAxis === 'width' ? 'height' : 'width';

  const minLineLength = lines.reduce((acc, line) => Math.max(acc, line.length), 0);
  // On one line every separator is rendered, so their widths count too.
  const maxLineLength = lines.reduce((acc, line) => acc + line.length, 0) + sepWidths.reduce((a, b) => a + b, 0);

  const inlineAvs = availableSpace[inlineAxis];
  const inlineSize = Math.max(
    knownDimensions[inlineAxis] ??
      (inlineAvs === 'min-content'
        ? minLineLength * H_WIDTH
        : inlineAvs === 'max-content'
          ? maxLineLength * H_WIDTH
          : Math.min(inlineAvs, maxLineLength * H_WIDTH)),
    minLineLength * H_WIDTH,
  );

  const blockSize =
    knownDimensions[blockAxis] ??
    ((): number => {
      const inlineLineLength = Math.floor(inlineSize / H_WIDTH);
      let lineCount = 1;
      let currentLineLength = 0;
      for (let i = 0; i < lines.length; i++) {
        const segment = lines[i] as string;
        // The separator *before* this segment is only rendered when the line
        // continues through it; a break consumes it.
        const sep = i > 0 ? (sepWidths[i - 1] as number) : 0;
        if (currentLineLength + sep + segment.length > inlineLineLength) {
          if (currentLineLength > 0) lineCount += 1;
          currentLineLength = segment.length;
        } else {
          currentLineLength += sep + segment.length;
        }
      }
      return lineCount * H_HEIGHT;
    })();

  return writingMode === 'horizontal'
    ? { width: inlineSize, height: blockSize }
    : { width: blockSize, height: inlineSize };
}
