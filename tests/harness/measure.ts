// Port of taffy/tests/common/src/lib.rs — the standard test measure functions,
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
  const lines = textContent.split(ZWS);
  if (lines.length === 0) return { width: 0, height: 0 };

  const inlineAxis = writingMode === 'horizontal' ? 'width' : 'height';
  const blockAxis = inlineAxis === 'width' ? 'height' : 'width';

  const minLineLength = lines.reduce((acc, line) => Math.max(acc, line.length), 0);
  const maxLineLength = lines.reduce((acc, line) => acc + line.length, 0);

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
      for (const line of lines) {
        if (currentLineLength + line.length > inlineLineLength) {
          if (currentLineLength > 0) lineCount += 1;
          currentLineLength = line.length;
        } else {
          currentLineLength += line.length;
        }
      }
      return lineCount * H_HEIGHT;
    })();

  return writingMode === 'horizontal'
    ? { width: inlineSize, height: blockSize }
    : { width: blockSize, height: inlineSize };
}
