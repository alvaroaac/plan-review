# Line-Anchored Commenting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub-style line-level commenting to the plan-review browser UI, allowing users to hover block elements and anchor comments to one or more lines via shift-click range selection.

**Architecture:** A custom `marked` `Renderer` subclass (`LineCollector`) intercepts block-level tokens during parsing, building a `LineBlock[]` array as a side effect. `SectionView` maps these blocks to `LineBlock` Preact components with gutter buttons and range-selection state. `App` tracks an optional `LineAnchor` in `commentingTarget`; the formatter outputs `lineTexts` as blockquotes per anchored comment.

**Tech Stack:** Preact 10, marked v15 (Renderer subclass), vitest, @testing-library/preact, TypeScript ESM.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types.ts` | Modify | Add `LineAnchor` interface, update `ReviewComment` |
| `src/browser/lineRenderer.ts` | **Create** | marked Renderer subclass → `LineBlock[]` |
| `src/browser/LineBlock.tsx` | **Create** | Single line: gutter button + content |
| `src/browser/SectionView.tsx` | Modify | Replace `dangerouslySetInnerHTML` with `LineBlock` map; range state; dual callbacks |
| `src/browser/App.tsx` | Modify | `commentingSection` → `commentingTarget: CommentingTarget \| null` |
| `src/browser/CommentInput.tsx` | Modify | Optional `anchor` prop; quoted lines above textarea |
| `src/browser/CommentSidebar.tsx` | Modify | Pass `anchor` to `CommentInput`; sort comments |
| `src/browser/CommentCard.tsx` | Modify | Show line label + quoted `lineTexts` |
| `src/browser/styles.css` | Modify | Line block visual states (gutter, hover, range, has-comment) |
| `src/formatter.ts` | Modify | Per-comment blockquote for anchored; label suffix for section-level; drop `### Original Content` |
| `tests/browser/lineRenderer.test.ts` | **Create** | Unit tests for `renderToLineBlocks` |
| `tests/formatter.test.ts` | Modify | Update blockquote test; add anchored/section-level label tests |

---

### Task 1: Update `types.ts` — `LineAnchor` interface

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Replace the `anchor` field**

Open `src/types.ts`. Replace the existing `ReviewComment` interface and add `LineAnchor`:

```ts
export interface PlanDocument {
  title: string;
  metadata: Record<string, string>;
  mode: 'plan' | 'generic';
  sections: Section[];
  comments: ReviewComment[];
}

export interface Section {
  id: string;
  heading: string;
  level: number;
  body: string;
  parent?: string;
  dependencies?: { dependsOn: string[]; blocks: string[] };
  relatedFiles?: string[];
  verification?: string;
}

export interface LineAnchor {
  type: 'lines';
  startLine: number;   // 0-indexed within section body
  endLine: number;     // inclusive
  lineTexts: string[]; // plain text of each selected line (HTML stripped)
}

export interface ReviewComment {
  sectionId: string;
  text: string;
  timestamp: Date;
  anchor?: LineAnchor; // absent = section-level comment
}

export type OutputTarget = 'stdout' | 'clipboard' | 'file' | 'claude';

export type SplitStrategy = 'heading' | 'separator' | 'auto';
```

- [ ] **Step 2: Typecheck**

```bash
cd plan-review && npm run typecheck
```

Expected: no errors (the old `anchor` field was never consumed, so removing it breaks nothing).

- [ ] **Step 3: Commit**

```bash
git -C plan-review add src/types.ts
git -C plan-review commit -m "feat: add LineAnchor type, update ReviewComment anchor field"
```

---

### Task 2: Create `src/browser/lineRenderer.ts`

**Files:**
- Create: `src/browser/lineRenderer.ts`
- Create: `tests/browser/lineRenderer.test.ts`

This module uses a `marked` `Renderer` subclass that intercepts block tokens as a side effect, building a `LineBlock[]` array. The string output of `Marked.parse()` is discarded — only the side-effect array is used.

- [ ] **Step 1: Create the test directory**

```bash
mkdir -p plan-review/tests/browser
```

- [ ] **Step 2: Write the failing tests**

Create `tests/browser/lineRenderer.test.ts`:

```ts
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
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd plan-review && npm test -- tests/browser/lineRenderer.test.ts
```

Expected: fail with "Cannot find module '../../src/browser/lineRenderer.js'"

- [ ] **Step 4: Create `src/browser/lineRenderer.ts`**

```ts
import { Marked, Renderer } from 'marked';
import type { Tokens } from 'marked';

export interface LineBlock {
  index: number;     // 0-based, sequential within the section
  innerHtml: string; // rendered HTML (safe for dangerouslySetInnerHTML)
  text: string;      // plain text (HTML stripped) for lineTexts storage
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

class LineCollector extends Renderer {
  private _blocks: LineBlock[] = [];
  private _i = 0;

  get result(): LineBlock[] {
    return this._blocks;
  }

  override paragraph(token: Tokens.Paragraph): string {
    const html = super.paragraph(token).trimEnd();
    this._blocks.push({ index: this._i++, innerHtml: html, text: stripHtml(html) });
    return '';
  }

  override listitem(token: Tokens.ListItem): string {
    const html = super.listitem(token).trimEnd();
    // Wrap in <ul> so the browser renders the bullet point correctly
    const wrapped = `<ul style="list-style:disc;padding-left:1.5em">${html}</ul>`;
    this._blocks.push({ index: this._i++, innerHtml: wrapped, text: stripHtml(html) });
    return '';
  }

  override list(_token: Tokens.List): string {
    // Items already captured individually in listitem(); discard container
    return '';
  }

  override code(token: Tokens.Code): string {
    const html = super.code(token).trimEnd();
    this._blocks.push({ index: this._i++, innerHtml: html, text: token.text.trim() });
    return '';
  }

  override blockquote(token: Tokens.Blockquote): string {
    const html = super.blockquote(token).trimEnd();
    this._blocks.push({ index: this._i++, innerHtml: html, text: stripHtml(html) });
    return '';
  }

  override heading(token: Tokens.Heading): string {
    const html = super.heading(token).trimEnd();
    this._blocks.push({ index: this._i++, innerHtml: html, text: stripHtml(html) });
    return '';
  }
}

export function renderToLineBlocks(markdown: string): LineBlock[] {
  const collector = new LineCollector();
  const instance = new Marked({ renderer: collector });
  instance.parse(markdown);
  return collector.result;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd plan-review && npm test -- tests/browser/lineRenderer.test.ts
```

Expected: all 12 tests pass.

- [ ] **Step 6: Typecheck**

```bash
cd plan-review && npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C plan-review add src/browser/lineRenderer.ts tests/browser/lineRenderer.test.ts
git -C plan-review commit -m "feat: add lineRenderer — marked renderer to LineBlock array"
```

---

### Task 3: Update `src/formatter.ts`

**Files:**
- Modify: `src/formatter.ts`
- Modify: `tests/formatter.test.ts`

The formatter no longer outputs `### Original Content` with the full section body. Instead: line-anchored comments get their `lineTexts` blockquoted inside the comment block; section-level comments get the label suffix `(entire section)`. Comments within a section are sorted: anchored by `startLine` ascending, section-level last.

- [ ] **Step 1: Write the new failing tests**

Add these tests to the `describe('formatReview')` block in `tests/formatter.test.ts`. Also update the existing `'blockquotes original content'` test since `### Original Content` is removed:

```ts
// Replace the existing 'blockquotes original content' test with:
it('does not include ### Original Content header', () => {
  const doc = makeDoc({
    comments: [{ sectionId: '1.1', text: 'Looks good', timestamp: new Date() }],
  });
  const output = formatReview(doc);
  expect(output).not.toContain('### Original Content');
});

// Add these new tests:
it('labels section-level comments with (entire section)', () => {
  const doc = makeDoc({
    comments: [{ sectionId: '1.1', text: 'Section comment', timestamp: new Date() }],
  });
  const output = formatReview(doc);
  expect(output).toContain('### Reviewer Comment (entire section)');
  expect(output).not.toContain('### Reviewer Comment\n');
});

it('blockquotes lineTexts for line-anchored comments', () => {
  const doc = makeDoc({
    comments: [{
      sectionId: '1.1',
      text: 'Check this line',
      timestamp: new Date(),
      anchor: {
        type: 'lines',
        startLine: 0,
        endLine: 1,
        lineTexts: ['First selected line.', 'Second selected line.'],
      },
    }],
  });
  const output = formatReview(doc);
  expect(output).toContain('> First selected line.');
  expect(output).toContain('> Second selected line.');
  expect(output).toContain('Check this line');
  expect(output).not.toContain('### Reviewer Comment (entire section)');
});

it('outputs anchored comments before section-level within the same section', () => {
  const doc = makeDoc({
    comments: [
      { sectionId: '1.1', text: 'Section-level comment', timestamp: new Date() },
      {
        sectionId: '1.1',
        text: 'Line comment',
        timestamp: new Date(),
        anchor: { type: 'lines', startLine: 0, endLine: 0, lineTexts: ['A line.'] },
      },
    ],
  });
  const output = formatReview(doc);
  const anchoredPos = output.indexOf('Line comment');
  const sectionPos = output.indexOf('Section-level comment');
  expect(anchoredPos).toBeLessThan(sectionPos);
});
```

- [ ] **Step 2: Run tests to verify failures**

```bash
cd plan-review && npm test -- tests/formatter.test.ts
```

Expected: 4 new tests fail; existing tests pass.

- [ ] **Step 3: Rewrite `src/formatter.ts`**

```ts
import type { PlanDocument, ReviewComment } from './types.js';

function sortComments(comments: ReviewComment[]): ReviewComment[] {
  return [...comments].sort((a, b) => {
    const aLine = a.anchor?.startLine ?? Infinity;
    const bLine = b.anchor?.startLine ?? Infinity;
    return aLine - bLine;
  });
}

export function formatReview(doc: PlanDocument): string {
  const commentedSectionIds = new Set(doc.comments.map((c) => c.sectionId));
  const reviewableSections = doc.sections.filter((s) =>
    doc.mode === 'plan' ? s.level === 3 : s.level >= 2,
  );
  const commentedSections = reviewableSections.filter((s) => commentedSectionIds.has(s.id));

  const parts: string[] = [];

  parts.push(`# Plan Review: ${doc.title}`);
  parts.push('');
  parts.push('## Review Summary');
  parts.push(`- **Sections reviewed:** ${commentedSections.length}/${reviewableSections.length}`);
  parts.push(`- **Comments:** ${doc.comments.length}`);
  parts.push(
    `- **Skipped:** ${reviewableSections.length - commentedSections.length} sections without comments`,
  );
  parts.push('');
  parts.push('---');

  for (const section of commentedSections) {
    const sectionComments = sortComments(
      doc.comments.filter((c) => c.sectionId === section.id),
    );

    parts.push('');
    parts.push(`## Section ${section.id}: ${section.heading}`);
    parts.push('');

    if (doc.mode === 'plan' && section.dependencies) {
      const deps = section.dependencies;
      if (deps.dependsOn.length > 0) {
        parts.push(`Depends on: ${deps.dependsOn.join(', ')}`);
      }
      if (deps.blocks.length > 0) {
        parts.push(`Blocks: ${deps.blocks.join(', ')}`);
      }
      parts.push('');
    }

    for (const comment of sectionComments) {
      if (comment.anchor) {
        parts.push('### Reviewer Comment');
        parts.push('');
        for (const line of comment.anchor.lineTexts) {
          parts.push(`> ${line}`);
        }
        parts.push('');
        parts.push(comment.text);
      } else {
        parts.push('### Reviewer Comment (entire section)');
        parts.push('');
        parts.push(comment.text);
      }
      parts.push('');
      parts.push('---');
    }
  }

  return parts.join('\n');
}
```

- [ ] **Step 4: Run all formatter tests**

```bash
cd plan-review && npm test -- tests/formatter.test.ts
```

Expected: all tests pass. Note: the old `'blockquotes original content'` test has been replaced by `'does not include ### Original Content header'`.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd plan-review && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git -C plan-review add src/formatter.ts tests/formatter.test.ts
git -C plan-review commit -m "feat: update formatter for line-anchored comments"
```

---

### Task 4: Add line block CSS to `src/browser/styles.css`

**Files:**
- Modify: `src/browser/styles.css`

- [ ] **Step 1: Append line block styles**

Open `src/browser/styles.css` and append at the end:

```css
/* ── Line block gutter ──────────────────────────────────── */

.line-block {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 2px 0 2px 4px;
  border-left: 2px solid transparent;
  transition: background 0.1s, border-color 0.1s;
  position: relative;
}

.line-block:hover,
.line-block.hovered {
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  border-left-color: var(--accent);
}

.line-block.in-range {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-left-color: var(--accent);
}

.line-block.has-comment {
  background: color-mix(in srgb, #facc15 8%, transparent);
  border-left-color: #facc15;
}

.line-gutter {
  width: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  padding-top: 3px;
  justify-content: center;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  color: var(--border);
  transition: color 0.1s;
}

.line-block:hover .line-gutter,
.line-block.hovered .line-gutter {
  color: var(--accent);
  font-weight: bold;
}

.line-block.in-range .line-gutter {
  color: var(--accent);
}

.line-block.has-comment .line-gutter {
  color: #facc15;
}

.line-inner {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  line-height: 1.7;
}

.line-inner p { margin: 0; }
.line-inner pre { background: var(--bg-secondary); padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
.line-inner code { background: var(--bg-secondary); padding: 2px 6px; border-radius: 3px; font-size: 13px; }
.line-inner ul { list-style: disc; }
.line-inner blockquote { border-left: 3px solid var(--border); padding-left: 12px; color: var(--text-secondary); margin: 0; }
.line-inner h3, .line-inner h4 { font-size: 14px; margin: 4px 0; }

.add-section-comment-link {
  display: inline-block;
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.add-section-comment-link:hover { color: var(--accent); }

.range-start-hint {
  font-size: 11px;
  color: var(--accent);
  font-style: italic;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-radius: 4px;
  margin-bottom: 8px;
}

.comment-anchor-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.comment-anchor-quote {
  border-left: 2px solid var(--border);
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  font-style: italic;
  margin-bottom: 10px;
  line-height: 1.5;
}

.comment-anchor-quote p { margin: 0; }

.comment-section-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 6px;
}
```

- [ ] **Step 2: Commit**

```bash
git -C plan-review add src/browser/styles.css
git -C plan-review commit -m "feat: add line block gutter CSS"
```

---

### Task 5: Create `src/browser/LineBlock.tsx`

**Files:**
- Create: `src/browser/LineBlock.tsx`

This is a pure presentational component. It renders a gutter character + content block. All interaction state comes from props — no internal state.

- [ ] **Step 1: Create the component**

```tsx
import type { LineBlock as LineBlockData } from './lineRenderer.js';

interface LineBlockProps {
  block: LineBlockData;
  isInRange: boolean;    // true for ALL lines in selection (start, middle, end)
  isRangeStart: boolean; // gutter shows ▶; also true for single-line selections
  isRangeEnd: boolean;   // gutter shows ◀; also true for single-line selections
  hasComment: boolean;
  isHovered: boolean;
  onGutterClick: (index: number, shiftKey: boolean) => void;
  onMouseEnter: (index: number) => void;
  onMouseLeave: () => void;
}

function gutterChar(isInRange: boolean, isRangeStart: boolean, isRangeEnd: boolean, hasComment: boolean): string {
  if (hasComment && !isInRange) return '◆';
  if (isRangeStart) return '▶'; // covers single-line (both start and end true)
  if (isRangeEnd) return '◀';
  if (isInRange) return '—';
  return '+';
}

export function LineBlock({
  block, isInRange, isRangeStart, isRangeEnd, hasComment, isHovered,
  onGutterClick, onMouseEnter, onMouseLeave,
}: LineBlockProps) {
  const classes = [
    'line-block',
    isHovered && !isInRange ? 'hovered' : '',
    isInRange ? 'in-range' : '',
    hasComment && !isInRange ? 'has-comment' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      class={classes}
      onMouseEnter={() => onMouseEnter(block.index)}
      onMouseLeave={() => onMouseLeave()}
    >
      <div
        class="line-gutter"
        onClick={(e) => onGutterClick(block.index, e.shiftKey)}
        title={isInRange ? undefined : 'Click to start selection'}
      >
        {gutterChar(isInRange, isRangeStart, isRangeEnd, hasComment)}
      </div>
      <div
        class="line-inner"
        dangerouslySetInnerHTML={{ __html: block.innerHtml }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd plan-review && npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C plan-review add src/browser/LineBlock.tsx
git -C plan-review commit -m "feat: add LineBlock component with gutter"
```

---

### Task 6: Update `src/browser/SectionView.tsx`

**Files:**
- Modify: `src/browser/SectionView.tsx`

Replace the single `dangerouslySetInnerHTML` block with a `LineBlock` map. Add `rangeStart`, `rangeEnd`, `hoveredLine` state. Replace the single `onComment` prop with `onLineComment` and `onSectionComment`.

- [ ] **Step 1: Rewrite `SectionView.tsx`**

```tsx
import { useState, useMemo } from 'preact/hooks';
import type { Section } from '../types.js';
import { renderToLineBlocks } from './lineRenderer.js';
import { LineBlock } from './LineBlock.js';

interface SectionViewProps {
  section: Section;
  mode: 'plan' | 'generic';
  isActive: boolean;
  commentedLines: Set<number>; // line indices that already have a comment
  onLineComment: (sectionId: string, start: number, end: number, lineTexts: string[]) => void;
  onSectionComment: (sectionId: string) => void;
}

export function SectionView({
  section, mode, isActive, commentedLines,
  onLineComment, onSectionComment,
}: SectionViewProps) {
  const isReviewable = mode === 'plan' ? section.level === 3 : section.level >= 2;
  const showMeta = mode === 'plan' && section.level === 3 && section.dependencies;

  const blocks = useMemo(() => renderToLineBlocks(section.body), [section.body]);

  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [rangeStart, setRangeStart] = useState<number | null>(null);

  const handleGutterClick = (index: number, shiftKey: boolean) => {
    if (rangeStart === null || !shiftKey) {
      // First click or plain click resets selection
      setRangeStart(index);
    } else {
      // Shift-click confirms the range
      const start = Math.min(rangeStart, index);
      const end = Math.max(rangeStart, index);
      const lineTexts = blocks.slice(start, end + 1).map((b) => b.text);
      onLineComment(section.id, start, end, lineTexts);
      setRangeStart(null);
    }
  };

  return (
    <div
      id={`section-${section.id}`}
      class={`section-view${isActive ? ' active' : ''}`}
    >
      <h2>{section.heading}</h2>

      {showMeta && (
        <div class="section-meta">
          {section.dependencies!.dependsOn.length > 0 && (
            <span>Depends on: {section.dependencies!.dependsOn.join(', ')}</span>
          )}
          {section.dependencies!.blocks.length > 0 && (
            <span>Blocks: {section.dependencies!.blocks.join(', ')}</span>
          )}
          {section.relatedFiles && section.relatedFiles.length > 0 && (
            <span>Files: {section.relatedFiles.join(', ')}</span>
          )}
          {section.verification && (
            <span>Verify: {section.verification}</span>
          )}
        </div>
      )}

      {rangeStart !== null && (
        <div class="range-start-hint">
          Shift-click a line to select a range, or shift-click this line to comment on it alone.
        </div>
      )}

      <div class="section-body">
        {blocks.map((block) => {
          const inRange = rangeStart !== null && block.index === rangeStart;
          return (
            <LineBlock
              key={block.index}
              block={block}
              isInRange={inRange}
              isRangeStart={inRange}
              isRangeEnd={inRange}
              hasComment={commentedLines.has(block.index)}
              isHovered={hoveredLine === block.index}
              onGutterClick={handleGutterClick}
              onMouseEnter={setHoveredLine}
              onMouseLeave={() => setHoveredLine(null)}
            />
          );
        })}
      </div>

      {isReviewable && (
        <span
          class="add-section-comment-link"
          onClick={() => onSectionComment(section.id)}
        >
          Add comment to entire section
        </span>
      )}
    </div>
  );
}
```

Note: `inRange` here only highlights the `rangeStart` line (pending first click). Once shift-click fires, `rangeStart` is cleared. The full range highlight (multiple lines) only exists between first click and shift-click. To show the full pending range as highlighted, track the hovered line during pending selection and highlight all lines between `rangeStart` and `hoveredLine`. This enhancement can be added in a follow-up — for MVP the first-clicked line shows as highlighted.

- [ ] **Step 2: Typecheck**

```bash
cd plan-review && npm run typecheck
```

Expected: TypeScript will flag the `App.tsx` call sites since `onComment` prop is renamed. Fix in the next task.

- [ ] **Step 3: Commit (WIP — App not yet updated)**

```bash
git -C plan-review add src/browser/SectionView.tsx
git -C plan-review commit -m "feat: update SectionView with LineBlock map and range selection"
```

---

### Task 7: Update `src/browser/App.tsx`

**Files:**
- Modify: `src/browser/App.tsx`

Replace `commentingSection: string | null` with `commentingTarget: CommentingTarget | null`. Wire up the two `SectionView` callbacks. Compute `commentedLines` per section from the `comments` array.

- [ ] **Step 1: Rewrite `App.tsx`**

```tsx
import { useState, useEffect } from 'preact/hooks';
import type { PlanDocument, ReviewComment, LineAnchor } from '../types.js';
import { TOCPanel } from './TOCPanel.js';
import { SectionView } from './SectionView.js';
import { CommentSidebar } from './CommentSidebar.js';

interface CommentingTarget {
  sectionId: string;
  anchor?: LineAnchor;
}

export function App() {
  const [doc, setDoc] = useState<PlanDocument | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [commentingTarget, setCommentingTarget] = useState<CommentingTarget | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/doc')
      .then((r) => r.json())
      .then((data) => setDoc(data.document))
      .catch((err) => setError(err.message));
  }, []);

  const handleNavigate = (sectionId: string) => {
    setActiveSection(sectionId);
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  const addComment = (sectionId: string, text: string, anchor?: LineAnchor) => {
    setComments((prev) => [...prev, { sectionId, text, timestamp: new Date(), anchor }]);
    setCommentingTarget(null);
  };

  const editComment = (index: number, text: string) => {
    setComments((prev) => prev.map((c, i) => (i === index ? { ...c, text } : c)));
  };

  const deleteComment = (index: number) => {
    setComments((prev) => prev.filter((_, i) => i !== index));
  };

  const submitReview = async () => {
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      });
      if (res.ok) setSubmitted(true);
    } catch {
      setError('Failed to submit review');
    }
  };

  // Compute which line indices have comments, per section
  const commentedLinesBySection = new Map<string, Set<number>>();
  for (const c of comments) {
    if (c.anchor) {
      const set = commentedLinesBySection.get(c.sectionId) ?? new Set<number>();
      for (let i = c.anchor.startLine; i <= c.anchor.endLine; i++) set.add(i);
      commentedLinesBySection.set(c.sectionId, set);
    }
  }

  if (submitted) return <div class="submitted">Review submitted. You can close this tab.</div>;
  if (error) return <div class="loading">Error: {error}</div>;
  if (!doc) return <div class="loading">Loading...</div>;

  return (
    <div class="app">
      <header class="top-bar">
        <h1>{doc.title}</h1>
        <span class="mode-badge">{doc.mode}</span>
        <span class="comment-count">{comments.length} comment{comments.length !== 1 ? 's' : ''}</span>
        <button class="submit-btn" onClick={submitReview} disabled={comments.length === 0}>
          Submit Review
        </button>
      </header>
      <div class="panels">
        <TOCPanel
          doc={doc}
          comments={comments}
          activeSection={activeSection}
          onNavigate={handleNavigate}
        />
        <main class="content-area">
          {doc.sections.map((section) => (
            <SectionView
              key={section.id}
              section={section}
              mode={doc.mode}
              isActive={activeSection === section.id}
              commentedLines={commentedLinesBySection.get(section.id) ?? new Set()}
              onLineComment={(sectionId, start, end, lineTexts) =>
                setCommentingTarget({
                  sectionId,
                  anchor: { type: 'lines', startLine: start, endLine: end, lineTexts },
                })
              }
              onSectionComment={(sectionId) => setCommentingTarget({ sectionId })}
            />
          ))}
        </main>
        <CommentSidebar
          comments={comments}
          sections={doc.sections}
          commentingTarget={commentingTarget}
          onAdd={addComment}
          onEdit={editComment}
          onDelete={deleteComment}
          onCancelComment={() => setCommentingTarget(null)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd plan-review && npm run typecheck
```

Expected: TypeScript will flag `CommentSidebar` since its props changed. Fix in the next task.

- [ ] **Step 3: Commit**

```bash
git -C plan-review add src/browser/App.tsx
git -C plan-review commit -m "feat: update App with commentingTarget and dual SectionView callbacks"
```

---

### Task 8: Update `src/browser/CommentInput.tsx`

**Files:**
- Modify: `src/browser/CommentInput.tsx`

Add optional `anchor` prop. When present, show label + quoted lines above textarea. Pass anchor through to `onSubmit`.

- [ ] **Step 1: Rewrite `CommentInput.tsx`**

```tsx
import { useState } from 'preact/hooks';
import type { LineAnchor } from '../types.js';

interface CommentInputProps {
  sectionId: string;
  anchor?: LineAnchor;
  onSubmit: (sectionId: string, text: string, anchor?: LineAnchor) => void;
  onCancel: () => void;
  initialText?: string;
}

export function CommentInput({
  sectionId, anchor, onSubmit, onCancel, initialText = '',
}: CommentInputProps) {
  const [text, setText] = useState(initialText);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(sectionId, trimmed, anchor);
    setText('');
  };

  const lineLabel = anchor
    ? anchor.startLine === anchor.endLine
      ? `Commenting on line ${anchor.startLine + 1}:`
      : `Commenting on lines ${anchor.startLine + 1}–${anchor.endLine + 1}:`
    : 'Commenting on entire section:';

  return (
    <div class="comment-input">
      <div class={anchor ? 'comment-anchor-label' : 'comment-section-label'}>
        {lineLabel}
      </div>
      {anchor && (
        <div class="comment-anchor-quote">
          {anchor.lineTexts.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      <textarea
        placeholder="Add a comment..."
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />
      <div class="comment-input-actions">
        <button class="add-btn" onClick={handleSubmit}>Add</button>
        <button class="cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd plan-review && npm run typecheck
```

Expected: still flags `CommentSidebar` — fix next.

- [ ] **Step 3: Commit**

```bash
git -C plan-review add src/browser/CommentInput.tsx
git -C plan-review commit -m "feat: update CommentInput with optional anchor and quoted lines"
```

---

### Task 9: Update `CommentCard.tsx` and `CommentSidebar.tsx`

**Files:**
- Modify: `src/browser/CommentCard.tsx`
- Modify: `src/browser/CommentSidebar.tsx`

`CommentCard` gets a label + quote block for anchored comments. `CommentSidebar` changes `commentingSection` prop to `commentingTarget` and sorts comments within groups.

- [ ] **Step 1: Rewrite `CommentCard.tsx`**

```tsx
import { useState } from 'preact/hooks';
import type { ReviewComment } from '../types.js';
import { CommentInput } from './CommentInput.js';

interface CommentCardProps {
  comment: ReviewComment;
  onEdit: (text: string) => void;
  onDelete: () => void;
}

export function CommentCard({ comment, onEdit, onDelete }: CommentCardProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CommentInput
        sectionId={comment.sectionId}
        anchor={comment.anchor}
        initialText={comment.text}
        onSubmit={(_, text) => { onEdit(text); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const anchorLabel = comment.anchor
    ? comment.anchor.startLine === comment.anchor.endLine
      ? `Line ${comment.anchor.startLine + 1}`
      : `Lines ${comment.anchor.startLine + 1}–${comment.anchor.endLine + 1}`
    : null;

  return (
    <div class="comment-card">
      {anchorLabel ? (
        <>
          <div class="comment-anchor-label">{anchorLabel}</div>
          <div class="comment-anchor-quote">
            {comment.anchor!.lineTexts.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </>
      ) : (
        <div class="comment-section-label">Entire section</div>
      )}
      <div class="comment-text">{comment.text}</div>
      <div class="comment-actions">
        <button onClick={() => setEditing(true)}>Edit</button>
        <button class="delete" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `CommentSidebar.tsx`**

```tsx
import type { ReviewComment, Section, LineAnchor } from '../types.js';
import { CommentCard } from './CommentCard.js';
import { CommentInput } from './CommentInput.js';

interface CommentingTarget {
  sectionId: string;
  anchor?: LineAnchor;
}

interface CommentSidebarProps {
  comments: ReviewComment[];
  sections: Section[];
  commentingTarget: CommentingTarget | null;
  onAdd: (sectionId: string, text: string, anchor?: LineAnchor) => void;
  onEdit: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onCancelComment: () => void;
}

function sortComments(items: { comment: ReviewComment; index: number }[]) {
  return [...items].sort((a, b) => {
    const aLine = a.comment.anchor?.startLine ?? Infinity;
    const bLine = b.comment.anchor?.startLine ?? Infinity;
    return aLine - bLine;
  });
}

export function CommentSidebar({
  comments, sections, commentingTarget, onAdd, onEdit, onDelete, onCancelComment,
}: CommentSidebarProps) {
  const getSectionHeading = (sectionId: string) =>
    sections.find((s) => s.id === sectionId)?.heading ?? sectionId;

  const grouped = new Map<string, { comment: ReviewComment; index: number }[]>();
  comments.forEach((comment, index) => {
    const group = grouped.get(comment.sectionId) ?? [];
    group.push({ comment, index });
    grouped.set(comment.sectionId, group);
  });

  return (
    <aside class="comment-sidebar">
      <h2>Comments ({comments.length})</h2>

      {commentingTarget && (
        <div class="commenting-for">
          <h3>{getSectionHeading(commentingTarget.sectionId)}</h3>
          <CommentInput
            sectionId={commentingTarget.sectionId}
            anchor={commentingTarget.anchor}
            onSubmit={onAdd}
            onCancel={onCancelComment}
          />
        </div>
      )}

      {Array.from(grouped.entries()).map(([sectionId, items]) => (
        <div key={sectionId} class="comment-group">
          <h3>{getSectionHeading(sectionId)}</h3>
          {sortComments(items).map(({ comment, index }) => (
            <CommentCard
              key={index}
              comment={comment}
              onEdit={(text) => onEdit(index, text)}
              onDelete={() => onDelete(index)}
            />
          ))}
        </div>
      ))}

      {comments.length === 0 && !commentingTarget && (
        <p class="no-comments">No comments yet. Hover a line and click + to start.</p>
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd plan-review && npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
cd plan-review && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git -C plan-review add src/browser/CommentCard.tsx src/browser/CommentSidebar.tsx
git -C plan-review commit -m "feat: update CommentCard and CommentSidebar for anchored comments"
```

---

### Task 10: Build, typecheck, and verify

**Files:** none new

- [ ] **Step 1: Full build**

```bash
cd plan-review && npm run build
```

Expected: TypeScript compile + esbuild browser bundle both succeed with no errors.

- [ ] **Step 2: Run full test suite**

```bash
cd plan-review && npm test
```

Expected: all tests pass.

- [ ] **Step 3: Smoke test the browser UI**

```bash
cd plan-review && node dist/index.js docs/superpowers/specs/2026-04-15-line-commenting-design.md --browser
```

Open the URL printed. Verify:
- Lines show faint `+` in gutter on hover
- Clicking `+` on a line highlights it with `▶` and shows the shift-click hint
- Shift-clicking another line opens `CommentInput` in sidebar with quoted lines
- Shift-clicking the same line opens `CommentInput` with a single line quoted
- Submitting a comment shows `◆` on the commented lines
- "Add comment to entire section" link opens `CommentInput` with no quote, "Commenting on entire section:" label
- Canceling `CommentInput` resets the selection

- [ ] **Step 4: Final commit**

```bash
git -C plan-review add -A
git -C plan-review commit -m "chore: final build artifacts for line-anchored commenting"
```

---

## Tech Debt Log

| Item | File to update | Notes |
|---|---|---|
| Click-and-hold drag selection | `src/browser/SectionView.tsx` | Add `onMouseDown`/`onMouseMove`/`onMouseUp` to `LineBlock` for drag-range. Replace shift+click with drag. |
| Richer AI prompt (reference not quote) | `src/formatter.ts` | Output `sectionId` + `startLine`–`endLine` reference instead of duplicating line text as blockquotes. AI agent reads the plan file itself. |
| Highlight persistence in TOC | `src/browser/TOCPanel.tsx` | Show per-line comment count badge in TOC items, not just section-level ✓ marker. |
| Range preview on hover | `src/browser/SectionView.tsx` | While `rangeStart` is set, highlight all lines between `rangeStart` and `hoveredLine` as a preview range before shift-click confirms. |
| Spec review gate distinguishes questions from changes | brainstorming skill / review workflow | The review gate applied all spec changes without first confirming that reviewer questions were answered satisfactorily vs. requesting changes. The review prompt should instruct the agent to separate "questions requiring clarification" from "requested changes" and confirm the former before acting on the latter. |
