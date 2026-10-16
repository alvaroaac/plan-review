import { describe, it, expect } from 'vitest';
import { findLineRun, renderToLineBlocks } from '../src/lineBlocks.js';
import type { LineBlock } from '../src/lineBlocks.js';

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

  // ── Lists: nesting, mixed, task lists ────────────────────────────────────

  it('keeps nested unordered lists inside their parent item (no flattening)', () => {
    const md = '- one\n  - one-a\n    - one-a-i\n  - one-b\n- two';
    const blocks = renderToLineBlocks(md);
    // Outer list has two top-level items → two LineBlocks, nested lists stay INSIDE each.
    expect(blocks).toHaveLength(2);
    expect(blocks[0].innerHtml).toContain('one');
    expect(blocks[0].innerHtml).toContain('<ul');
    expect(blocks[0].innerHtml).toContain('one-a');
    expect(blocks[0].innerHtml).toContain('one-a-i'); // deep nesting preserved
    expect(blocks[0].innerHtml).toContain('one-b');
    expect(blocks[1].innerHtml).toContain('two');
    expect(blocks[1].innerHtml).not.toContain('one-a');
  });

  it('keeps nested ordered lists inside their parent item', () => {
    const md = '1. first\n2. second\n   1. two-a\n   2. two-b\n3. third';
    const blocks = renderToLineBlocks(md);
    expect(blocks).toHaveLength(3);
    expect(blocks[1].innerHtml).toContain('<ol');
    expect(blocks[1].innerHtml).toContain('two-a');
    expect(blocks[1].innerHtml).toContain('two-b');
  });

  it('renders GFM task-list items with disabled checkboxes', () => {
    const md = '- [ ] todo\n- [x] done\n- [ ] pending';
    const blocks = renderToLineBlocks(md);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].innerHtml).toContain('<input type="checkbox" disabled>');
    expect(blocks[1].innerHtml).toContain('<input type="checkbox" disabled checked>');
    expect(blocks[0].innerHtml).toContain('task-list-item');
  });

  it('preserves ordered-list numbering across per-item LineBlocks via `start`', () => {
    const blocks = renderToLineBlocks('1. first\n2. second\n3. third');
    expect(blocks).toHaveLength(3);
    expect(blocks[0].innerHtml).toContain('<ol start="1">');
    expect(blocks[1].innerHtml).toContain('<ol start="2">');
    expect(blocks[2].innerHtml).toContain('<ol start="3">');
  });

  it('honours a non-default `start` on ordered lists', () => {
    const blocks = renderToLineBlocks('5. five\n6. six');
    expect(blocks[0].innerHtml).toContain('<ol start="5">');
    expect(blocks[1].innerHtml).toContain('<ol start="6">');
  });

  // ── Footnotes ────────────────────────────────────────────────────────────

  it('emits a footnotes section for GFM [^ref] markers', () => {
    const md = 'Claim with a ref[^1].\n\n[^1]: The footnote body.';
    const blocks = renderToLineBlocks(md);
    const all = blocks.map((b) => b.innerHtml).join('\n');
    // The inline ref renders as a <sup>, the body lives inside <section class="footnotes">.
    expect(all).toContain('<sup>');
    expect(all).toContain('data-footnote-ref');
    expect(all).toContain('class="footnotes"');
    expect(all).toContain('The footnote body');
  });

  it('does not duplicate footnote bodies as stray top-level paragraphs', () => {
    const md = 'Body ref[^a].\n\n[^a]: This is the footnote body.';
    const blocks = renderToLineBlocks(md);
    // Body text should appear EXACTLY once — inside the footnotes <section>.
    // Prior regression: marked-footnote re-parsed each body through our custom
    // paragraph renderer, pushing a stray <p> before the section.
    const bodyMatches = blocks.filter((b) =>
      b.innerHtml.includes('This is the footnote body'),
    );
    expect(bodyMatches).toHaveLength(1);
    expect(bodyMatches[0].innerHtml).toContain('class="footnotes"');
  });

  // ── Inline HTML inside paragraphs ────────────────────────────────────────

  it('preserves inline HTML tags like <kbd>, <sub>, <sup> inside paragraphs', () => {
    const blocks = renderToLineBlocks('Press <kbd>Ctrl</kbd>+<kbd>C</kbd>. H<sub>2</sub>O and E=mc<sup>2</sup>.');
    expect(blocks[0].innerHtml).toContain('<kbd>Ctrl</kbd>');
    expect(blocks[0].innerHtml).toContain('<sub>2</sub>');
    expect(blocks[0].innerHtml).toContain('<sup>2</sup>');
  });

  // ── Tables with inline formatting in cells ───────────────────────────────

  it('renders inline formatting inside table cells', () => {
    const md = [
      '| term | meaning |',
      '|------|---------|',
      '| `cmd` | runs a **command** with [docs](https://example.com) |',
    ].join('\n');
    const blocks = renderToLineBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].innerHtml).toContain('<table>');
    expect(blocks[0].innerHtml).toContain('<code>cmd</code>');
    expect(blocks[0].innerHtml).toContain('<strong>command</strong>');
    expect(blocks[0].innerHtml).toContain('href="https://example.com"');
  });

  // ── Reference-style and auto links ───────────────────────────────────────

  it('resolves reference-style links', () => {
    const md = 'See the [docs][d].\n\n[d]: https://example.com "Example"';
    const blocks = renderToLineBlocks(md);
    expect(blocks[0].innerHtml).toContain('href="https://example.com"');
    expect(blocks[0].innerHtml).toContain('>docs</a>');
  });

  it('renders auto-links as anchors', () => {
    const blocks = renderToLineBlocks('Visit <https://anthropic.com>.');
    expect(blocks[0].innerHtml).toContain('href="https://anthropic.com"');
  });

  // ── Images ───────────────────────────────────────────────────────────────

  it('renders images as <img> tags with alt text', () => {
    const blocks = renderToLineBlocks('![local thing](demo.gif)');
    expect(blocks[0].innerHtml).toContain('<img');
    // Relative srcs get rewritten under /_assets/ so the server can resolve
    // them against the plan file's directory.
    expect(blocks[0].innerHtml).toContain('src="/_assets/demo.gif"');
    expect(blocks[0].innerHtml).toContain('alt="local thing"');
  });

  it('passes absolute image URLs (http/https/data) through unchanged', () => {
    const remote = renderToLineBlocks('![pic](https://example.com/p.png)');
    expect(remote[0].innerHtml).toContain('src="https://example.com/p.png"');
    const data = renderToLineBlocks('![dot](data:image/gif;base64,R0lGODdh)');
    expect(data[0].innerHtml).toContain('src="data:image/gif;base64,R0lGODdh"');
  });

  // ── HR + raw HTML ────────────────────────────────────────────────────────

  it('emits an <hr> block for horizontal rules', () => {
    const blocks = renderToLineBlocks('before\n\n---\n\nafter');
    const hrBlock = blocks.find((b) => b.innerHtml === '<hr>');
    expect(hrBlock).toBeTruthy();
    expect(hrBlock!.text).toBe('---');
  });

  it('emits raw HTML blocks (e.g. <details>)', () => {
    const md = '<details>\n<summary>More</summary>\nhidden body\n</details>';
    const blocks = renderToLineBlocks(md);
    const htmlBlock = blocks.find((b) => b.innerHtml.includes('<details>'));
    expect(htmlBlock).toBeTruthy();
    expect(htmlBlock!.innerHtml).toContain('<summary>');
  });

  it('merges <details> wrappers that span blank lines into one LineBlock', () => {
    // Without merging, the blank-line-separated paragraph would become its
    // own LineBlock and escape the <details>, so the body would render as a
    // sibling and stay visible even when the details element is closed.
    const md = '<details>\n<summary>More</summary>\n\nHidden body content.\n\n</details>';
    const blocks = renderToLineBlocks(md);
    const detailsBlock = blocks.find((b) => b.innerHtml.includes('<details>'));
    expect(detailsBlock).toBeTruthy();
    expect(detailsBlock!.innerHtml).toContain('<summary>');
    expect(detailsBlock!.innerHtml).toContain('Hidden body content');
    expect(detailsBlock!.innerHtml).toContain('</details>');
    // No other block should hold the body — it must not have escaped.
    const escapedBody = blocks.filter(
      (b) => b !== detailsBlock && b.innerHtml.includes('Hidden body content'),
    );
    expect(escapedBody).toHaveLength(0);
  });

  it('decorates GFM admonitions with a titled class', () => {
    const md = '> [!WARNING]\n> watch out';
    const blocks = renderToLineBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].innerHtml).toContain('admonition-warning');
    expect(blocks[0].innerHtml).toContain('admonition-title');
    expect(blocks[0].innerHtml).toContain('Warning');
    expect(blocks[0].innerHtml).not.toContain('[!WARNING]'); // marker stripped
  });

  it('renders Docusaurus :::kind ... ::: as an admonition', () => {
    const md = ':::note\nbody text here\n:::';
    const blocks = renderToLineBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].innerHtml).toContain('admonition-note');
    expect(blocks[0].innerHtml).toContain('admonition-title');
    expect(blocks[0].innerHtml).toContain('Note');
    expect(blocks[0].innerHtml).toContain('body text here');
    expect(blocks[0].innerHtml).not.toContain(':::');
  });

  it('maps Docusaurus-only kinds (info → note, danger → caution)', () => {
    const info = renderToLineBlocks(':::info\nan info note\n:::');
    expect(info[0].innerHtml).toContain('admonition-note');
    expect(info[0].innerHtml).toContain('Info');
    const danger = renderToLineBlocks(':::danger\nwatch out\n:::');
    expect(danger[0].innerHtml).toContain('admonition-caution');
    expect(danger[0].innerHtml).toContain('Danger');
  });

  it('emits a math-display block for $$ ... $$ and math-inline spans in paragraphs', () => {
    const md = 'before\n\n$$ x = 1 $$\n\nMiddle with $a=b$ inline.';
    const blocks = renderToLineBlocks(md);
    const displayBlock = blocks.find((b) => b.innerHtml.includes('math-display'));
    expect(displayBlock).toBeTruthy();
    const inlineBlock = blocks.find((b) => b.innerHtml.includes('math-inline'));
    expect(inlineBlock).toBeTruthy();
    expect(inlineBlock!.innerHtml).toContain('a=b');
  });

  describe('currency amounts are not inline math', () => {
    const cases: Record<string, string> = {
      paragraph: 'Delta $63,334.52-$50,386.55 today.',
      'table row': '| step | n | total |\n|---|---|---|\n| open | 18 | $50,386.55 |\n| close | 19 | $63,334.52/$50,386.55 |',
      'list item': '- Delta $63,334.52-$50,386.55 today.',
      blockquote: '> Delta $63,334.52-$50,386.55 today.',
    };
    for (const [name, md] of Object.entries(cases)) {
      it(`in a ${name}`, () => {
        const blocks = renderToLineBlocks(md);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].innerHtml).not.toContain('math-inline');
        expect(blocks[0].innerHtml).toContain('$63,334.52');
        expect(blocks[0].innerHtml).toContain('$50,386.55');
      });
    }
  });

  it('renders inline and display math inside list items and blockquotes', () => {
    const blocks = renderToLineBlocks(
      '- Energy $E=mc^2$ here.\n\n  $$\n  x^2\n  $$\n\n> Quoted $a=b$ math.',
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].innerHtml).toContain('<span class="math-inline">E=mc^2</span>');
    expect(blocks[0].innerHtml).toContain('<div class="math-display">x^2</div>');
    expect(blocks[1].innerHtml).toContain('<span class="math-inline">a=b</span>');
  });

  it('expands known emoji shortcodes in paragraphs and headings', () => {
    const blocks = renderToLineBlocks('Ship it :rocket:\n\n## :warning: Heads up');
    expect(blocks[0].innerHtml).toContain('🚀');
    expect(blocks[0].innerHtml).not.toContain(':rocket:');
    const headingBlock = blocks.find((b) => b.innerHtml.startsWith('<h2'));
    expect(headingBlock!.innerHtml).toContain('⚠️');
  });

  it('leaves unknown shortcodes intact', () => {
    const blocks = renderToLineBlocks('Has :totally_fake_emoji: shortcode');
    expect(blocks[0].innerHtml).toContain(':totally_fake_emoji:');
  });

  it('emits a <pre class="mermaid"> block for mermaid code fences', () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n```';
    const blocks = renderToLineBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].innerHtml).toContain('<pre class="mermaid">');
    expect(blocks[0].innerHtml).not.toContain('<code'); // not wrapped as code block
    // Raw source preserved so comments can anchor to specific lines of the diagram.
    expect(blocks[0].text).toContain('flowchart LR');
    expect(blocks[0].text).toContain('A --> B');
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

  it('renders a simple 2-column table as one LineBlock', () => {
    const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
    const blocks = renderToLineBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].innerHtml).toContain('<table>');
    expect(blocks[0].innerHtml).toContain('<thead>');
    expect(blocks[0].innerHtml).toContain('<tbody>');
    expect(blocks[0].innerHtml).toContain('<th>Name</th>');
    expect(blocks[0].innerHtml).toContain('<th>Age</th>');
    expect(blocks[0].innerHtml).toContain('<td>Alice</td>');
    expect(blocks[0].innerHtml).toContain('<td>Bob</td>');
  });

  it('renders table with column alignment', () => {
    const md = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |';
    const blocks = renderToLineBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].innerHtml).toContain('align="left"');
    expect(blocks[0].innerHtml).toContain('align="center"');
    expect(blocks[0].innerHtml).toContain('align="right"');
  });

  it('table text field contains plain text without HTML tags', () => {
    const md = '| Fruit | Count |\n| --- | --- |\n| Apple | 5 |\n| Banana | 3 |';
    const blocks = renderToLineBlocks(md);
    expect(blocks[0].text).not.toContain('<');
    expect(blocks[0].text).toContain('Fruit | Count');
    expect(blocks[0].text).toContain('Apple | 5');
    expect(blocks[0].text).toContain('Banana | 3');
  });
});

describe('renderToLineBlocks plain text', () => {
  it('strips tags and decodes entities without a DOM', () => {
    const blocks = renderToLineBlocks('Use `a<b>` & "c" isn\'t &#x263A;<!-- hidden -->\n\n<div>\n  <p>Raw  &amp; html</p>\n</div>');
    expect(blocks.map((b) => b.text)).toEqual(['Use a<b> & "c" isn\'t \u263A', 'Raw & html']);
  });

  it('matches textContent for named entities and quoted > in attributes', () => {
    const blocks = renderToLineBlocks('Copyright &copy; 2026 &mdash; <span title="a>b">x</span>');
    expect(blocks.map((b) => b.text)).toEqual(['Copyright \u00A9 2026 \u2014 x']);
  });
});

describe('renderToLineBlocks item fences', () => {
  const md = [
    'Intro paragraph.',
    '',
    '```decision id=retry-backoff',
    'question: How?',
    '```',
    '',
    '```assumption id=unknown-item',
    'statement: x',
    '```',
    '',
    '```ts',
    'const a = 1;',
    '```',
  ].join('\n');
  const known = new Set(['retry-backoff']);

  it('turns a known item fence into a marker block with itemId and no code HTML', () => {
    const blocks = renderToLineBlocks(md, known);
    expect(blocks[1]).toMatchObject({ index: 1, itemId: 'retry-backoff', innerHtml: '' });
  });

  it('renders an item fence whose id is not a known item as code', () => {
    const blocks = renderToLineBlocks(md, known);
    expect(blocks[2].itemId).toBeUndefined();
    expect(blocks[2].innerHtml).toContain('<pre><code');
  });

  it('renders other fences as code without itemId', () => {
    const blocks = renderToLineBlocks(md, known);
    expect(blocks[3].itemId).toBeUndefined();
    expect(blocks[3].innerHtml).toContain('language-ts');
  });

  it('renders a later fence repeating an item id as an ordinary code block', () => {
    const repeated = `${md}\n\n\`\`\`decision id=retry-backoff\nquestion: Again?\n\`\`\``;
    const blocks = renderToLineBlocks(repeated, known);
    expect(blocks.filter((b) => b.itemId === 'retry-backoff').map((b) => b.index)).toEqual([1]);
    expect(blocks[4]).toMatchObject({ text: 'question: Again?' });
    expect(blocks[4].innerHtml).toContain('<pre><code');
  });

  it('only treats top-level fences as items', () => {
    const nested = '- item\n\n  ```decision id=retry-backoff\n  q\n  ```\n';
    const blocks = renderToLineBlocks(nested, known);
    expect(blocks.every((b) => b.itemId === undefined)).toBe(true);
  });
});

describe('findLineRun', () => {
  it('honors a matching stored range and otherwise chooses the nearest occurrence', () => {
    const repeated = renderToLineBlocks('Same.\n\nBetween.\n\nSame.\n\nBetween.\n\nSame.');
    expect(findLineRun(repeated, ['Same.'], { startLine: 2, endLine: 2 })).toEqual({ start: 2, end: 2 });
    expect(findLineRun(repeated, ['Same.'], { startLine: 3, endLine: 3 })).toEqual({ start: 2, end: 2 });
    expect(findLineRun(repeated, ['Same.'], { startLine: 5, endLine: 5 })).toEqual({ start: 4, end: 4 });
    expect(findLineRun(repeated, ['Gone.'], { startLine: 2, endLine: 2 })).toBeNull();
  });

  const blocks: LineBlock[] = ['Alpha', 'Beta', 'Gamma', 'Beta', 'Delta'].map((text, index) => ({
    index,
    innerHtml: `<p>${text}</p>`,
    text,
  }));

  it('finds the run of blocks whose text matches lineTexts in order', () => {
    expect(findLineRun(blocks, ['Gamma', 'Beta'])).toEqual({ start: 2, end: 3 });
  });

  it('returns the first matching run when the text repeats', () => {
    expect(findLineRun(blocks, ['Beta'])).toEqual({ start: 1, end: 1 });
  });

  it('requires the matched blocks to be consecutive', () => {
    expect(findLineRun(blocks, ['Alpha', 'Gamma'])).toBeNull();
  });

  it('ignores whitespace differences only', () => {
    expect(findLineRun(blocks, ['  Delta\n'])).toEqual({ start: 4, end: 4 });
    expect(findLineRun(blocks, ['delta'])).toBeNull();
    expect(findLineRun(blocks, ['Delta.'])).toBeNull();
  });

  it('returns null when the text is gone, for an empty section and for no lines', () => {
    expect(findLineRun(blocks, ['Removed'])).toBeNull();
    expect(findLineRun([], ['Alpha'])).toBeNull();
    expect(findLineRun(blocks, [])).toBeNull();
  });
});
