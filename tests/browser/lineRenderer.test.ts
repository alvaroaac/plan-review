// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderToLineBlocks } from '../../src/browser/lineRenderer.js';

describe('renderToLineBlocks', () => {
  it('returns one block per paragraph', () => {
    const blocks = renderToLineBlocks('First paragraph.\n\nSecond paragraph.');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].index).toBe(0);
    expect(blocks[1].index).toBe(1);
  });

  it('renders paragraph innerHtml with wrapping <p> tag', () => {
    const blocks = renderToLineBlocks('Hello world.');
    expect(blocks[0].innerHtml).toContain('<p>');
    expect(blocks[0].innerHtml).toContain('Hello world.');
  });

  it('strips HTML from text field', () => {
    const blocks = renderToLineBlocks('Text with **bold**.');
    expect(blocks[0].text).not.toContain('<');
    expect(blocks[0].text).toContain('Text with');
    expect(blocks[0].text).toContain('bold');
  });

  it('returns one block per list item', () => {
    const blocks = renderToLineBlocks('- Item one\n- Item two\n- Item three');
    expect(blocks).toHaveLength(3);
  });

  it('renders list item innerHtml with <li> tag', () => {
    const blocks = renderToLineBlocks('- Item one');
    expect(blocks[0].innerHtml).toContain('<li>');
    expect(blocks[0].innerHtml).toContain('Item one');
  });

  it('returns one block for an entire code block', () => {
    const blocks = renderToLineBlocks('```ts\nconst a = 1;\nconst b = 2;\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].innerHtml).toContain('<pre>');
    expect(blocks[0].innerHtml).toContain('const a = 1;');
  });

  it('returns one block for a blockquote', () => {
    const blocks = renderToLineBlocks('> Quoted text here.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].innerHtml).toContain('<blockquote>');
  });

  it('returns one block for h3/h4 headings', () => {
    const blocks = renderToLineBlocks('### Sub heading');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].innerHtml).toContain('<h3>');
  });

  it('assigns sequential indices across mixed block types', () => {
    const md = 'Paragraph one.\n\n- List item\n\n```\ncode\n```\n\nParagraph two.';
    const blocks = renderToLineBlocks(md);
    const indices = blocks.map(b => b.index);
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it('text field for code block is the raw code string', () => {
    const blocks = renderToLineBlocks('```\nconst x = 1;\n```');
    expect(blocks[0].text).toContain('const x = 1;');
    expect(blocks[0].text).not.toContain('<');
  });

  it('returns empty array for empty markdown', () => {
    const blocks = renderToLineBlocks('');
    expect(blocks).toHaveLength(0);
  });

  it('resets index counter on each call (no shared state between calls)', () => {
    renderToLineBlocks('First call paragraph.');
    const blocks = renderToLineBlocks('Second call paragraph.');
    expect(blocks[0].index).toBe(0);
  });

  it('renders ordered list with <ol> tag', () => {
    const blocks = renderToLineBlocks('1. First\n2. Second');
    expect(blocks[0].innerHtml).toContain('<ol');
    expect(blocks[1].innerHtml).toContain('<ol');
  });

  it('handles nested blockquote without mangling structure', () => {
    const blocks = renderToLineBlocks('>> Nested quote');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].innerHtml).toContain('<blockquote>');
  });
});
