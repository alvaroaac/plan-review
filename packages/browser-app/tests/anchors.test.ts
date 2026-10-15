import { describe, it, expect } from 'vitest';
import type { LineAnchor } from '@plan-review/core';
import { resolveAnchor } from '../src/anchors.js';
import type { LineBlock } from '../src/lineRenderer.js';

const blocks: LineBlock[] = ['Alpha', 'Beta', 'Gamma', 'Beta', 'Delta'].map((text, index) => ({
  index,
  innerHtml: `<p>${text}</p>`,
  text,
}));

function anchor(startLine: number, endLine: number, lineTexts: string[]): LineAnchor {
  return { type: 'lines', startLine, endLine, lineTexts };
}

describe('resolveAnchor', () => {
  it('finds the run of blocks whose text matches lineTexts in order', () => {
    expect(resolveAnchor(blocks, anchor(0, 1, ['Gamma', 'Beta']))).toEqual({ start: 2, end: 3 });
  });

  it('returns the first matching run when the text repeats', () => {
    expect(resolveAnchor(blocks, anchor(3, 3, ['Beta']))).toEqual({ start: 1, end: 1 });
  });

  it('follows text that moved after the plan was edited', () => {
    expect(resolveAnchor(blocks, anchor(0, 0, ['Delta']))).toEqual({ start: 4, end: 4 });
  });

  it('requires the matched blocks to be consecutive', () => {
    expect(resolveAnchor(blocks, anchor(2, 3, ['Alpha', 'Gamma']))).toEqual({ start: 2, end: 3 });
  });

  it('falls back to the stored line range when the text is gone', () => {
    expect(resolveAnchor(blocks, anchor(1, 2, ['Removed', 'Also removed']))).toEqual({ start: 1, end: 2 });
  });

  it('returns null when the text is gone and the stored range is out of bounds', () => {
    expect(resolveAnchor(blocks, anchor(4, 5, ['Removed', 'Gone']))).toBeNull();
  });

  it('returns null for an empty section', () => {
    expect(resolveAnchor([], anchor(0, 0, ['Alpha']))).toBeNull();
  });
});
