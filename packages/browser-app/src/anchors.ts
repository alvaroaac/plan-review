import type { LineAnchor } from '@plan-review/core';
import type { LineBlock } from './lineRenderer.js';

/**
 * Where a thread's anchor lands in the current render of its section: the first
 * run of consecutive blocks whose text matches the anchored lines, else the
 * stored line range if it still exists, else null.
 */
export function resolveAnchor(blocks: LineBlock[], anchor: LineAnchor): { start: number; end: number } | null {
  const { lineTexts } = anchor;
  for (let start = 0; start + lineTexts.length <= blocks.length; start++) {
    if (lineTexts.every((text, k) => blocks[start + k].text === text)) {
      return { start, end: start + lineTexts.length - 1 };
    }
  }
  if (anchor.startLine >= 0 && anchor.endLine < blocks.length && anchor.startLine <= anchor.endLine) {
    return { start: anchor.startLine, end: anchor.endLine };
  }
  return null;
}
