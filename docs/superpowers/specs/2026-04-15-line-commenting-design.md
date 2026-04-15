# Line-Anchored Commenting Design

**Date:** 2026-04-15
**Status:** Approved
**Depends on:** `2026-04-13-browser-ui-design.md`

## Overview

Add GitHub-style line-level commenting to the plan-review browser UI. Users hover over rendered block elements (paragraphs, list items, code blocks) and click a "+" gutter button to anchor a comment to one or more lines. This replaces arbitrary text selection with a structured, block-level granularity that is simpler to implement and easier to use.

Existing section-level commenting is preserved via a renamed "Add comment to entire section" link at the bottom of each section.

---

## Feature Summary

- Every rendered block element (paragraph, list item, code block, blockquote, h3/h4) is a selectable "line"
- Hover reveals a "+" gutter button on the left margin
- Single click selects one line; shift+click extends to a range
- Comment input opens in the sidebar with the selected lines quoted
- Submitted comments persist as highlighted lines (◆ gutter marker) for the session
- Section-level comments coexist with line-anchored comments in the same section group
- All new UI uses existing dark-theme CSS variables — no hardcoded colors

---

## Data Model

### `types.ts`

Replace the existing unused `anchor` field with a typed `LineAnchor`:

```ts
export interface LineAnchor {
  type: 'lines';
  startLine: number;   // 0-indexed within section body
  endLine: number;     // inclusive
  lineTexts: string[]; // plain text of each selected line
}

export interface ReviewComment {
  sectionId: string;
  text: string;
  timestamp: Date;
  anchor?: LineAnchor; // absent = section-level comment
}
```

`lineTexts` stores trimmed plain text (HTML stripped) at the time of selection. Used for sidebar quotes and formatter output — no re-parsing needed at display time.

---

## Architecture

### New file: `src/browser/lineRenderer.ts`

Exports `renderToLineBlocks(markdown: string): LineBlock[]`.

Uses a custom `marked.Renderer` that intercepts block-level tokens and pushes structured objects into an array as a side effect, returning empty strings from each renderer method (the string output is not used). The renderer is instantiated fresh per call to reset the line counter.

```ts
export interface LineBlock {
  index: number;     // 0-based, sequential within the section
  innerHtml: string; // rendered HTML for this block (safe to use in dangerouslySetInnerHTML)
  text: string;      // plain text (HTML stripped) for lineTexts storage
}
```

Block types handled:
| Token | `innerHtml` wrapper | Notes |
|---|---|---|
| `paragraph` | `<p>...</p>` | Standard prose |
| `listitem` | `<li>...</li>` | Each item is its own line |
| `code` | `<pre><code>...</code></pre>` | Whole block = one line |
| `blockquote` | `<blockquote>...</blockquote>` | Whole block = one line |
| `heading` (depth ≥ 3) | `<h3>` / `<h4>` | Sub-headings inside section body only |
| `heading` (depth ≤ 2) | Pass through as raw HTML | Section-level headings, not selectable |

### New file: `src/browser/LineBlock.tsx`

Single Preact component for one line. Renders gutter button + content side by side.

**Props:**
```ts
interface LineBlockProps {
  block: LineBlock;
  isInRange: boolean;
  isRangeStart: boolean;
  isRangeEnd: boolean;
  hasComment: boolean;
  isHovered: boolean;
  onGutterClick: (index: number, shiftKey: boolean) => void;
  onMouseEnter: (index: number) => void;
  onMouseLeave: () => void;
}
```

**Visual states (using existing CSS variables):**

| State | Gutter | Left border | Background |
|---|---|---|---|
| Default | dim `+` (`--border` color) | none | none |
| Hovered | bright `+` (`--accent`) | `--accent` 2px | `--accent` 7% opacity |
| In range | `—` (`--accent`) | `--accent` 2px | `--accent` 12% opacity |
| Range start | `▶` (`--accent`) | `--accent` 2px | `--accent` 12% opacity |
| Range end | `◀` (`--accent`) | `--accent` 2px | `--accent` 12% opacity |
| Has comment | `◆` (`#facc15`) | `#facc15` 2px | `#facc15` 8% opacity |

### Changes to `SectionView.tsx`

- Replace `marked.parse(section.body)` + `dangerouslySetInnerHTML` with `renderToLineBlocks(section.body)` mapped to `<LineBlock>` components
- Add internal state: `hoveredLine`, `rangeStart`, `rangeEnd` (all `number | null`)
- Remove existing "Add Comment" button; replace with small text link at section footer: "Add comment to entire section"
- `onComment` prop replaced by two callbacks:
  - `onLineComment: (sectionId, start, end, lineTexts) => void` — fired by gutter interactions
  - `onSectionComment: (sectionId) => void` — fired by the "Add comment to entire section" link
- No sentinel values; `App.tsx` maps each callback to the appropriate `commentingTarget`

**Gutter click logic:**
```ts
function handleGutterClick(index: number, shiftKey: boolean) {
  if (rangeStart === null || !shiftKey) {
    setRangeStart(index);
    setRangeEnd(null);
  } else {
    const start = Math.min(rangeStart, index);
    const end = Math.max(rangeStart, index);
    const texts = blocks.slice(start, end + 1).map(b => b.text);
    onLineComment(section.id, start, end, texts);
    setRangeStart(null);
    setRangeEnd(null);
  }
}
```

Single-line comment: user shift-clicks the same line they already clicked (start === end). Section-level: triggered by the footer link, passes sentinel values.

### Changes to `App.tsx`

Replace `commentingSection: string | null` with:

```ts
interface CommentingTarget {
  sectionId: string;
  anchor?: LineAnchor; // absent for section-level
}

commentingTarget: CommentingTarget | null
```

`addComment(sectionId, text, anchor?)` constructs a `ReviewComment` with optional anchor and appends to `comments[]`. All existing submit/output logic is unchanged.

### Changes to `CommentInput.tsx`

Add optional `anchor?: LineAnchor` prop.

- When anchor is present: show label "Commenting on lines N–M:" (or "Commenting on line N:" when start === end) and render `lineTexts` as a quoted block above the textarea
- When anchor is absent: show label "Commenting on entire section:"
- `onSubmit` signature gains optional anchor: `(sectionId, text, anchor?) => void`

### Changes to `CommentSidebar.tsx`

`CommentCard` gains anchor display:
- When `comment.anchor` present: show "Lines N–M" label in accent color, followed by quoted `lineTexts` (italic, left border, `--border` color)
- When no anchor: show "Entire section" label in `--text-secondary`

Within a section group, comments are ordered: line-anchored comments sorted by `startLine` ascending, section-level comments last.

### Changes to `formatter.ts`

For comments with `anchor`:
```markdown
### Reviewer Comment

> Line 1 text here
> Line 2 text here
> Line 3 text here

Comment text here.
```

For section-level comments:
```markdown
### Reviewer Comment (entire section)

Comment text here.
```

Multiple comments in the same section each get their own `### Reviewer Comment` block, in the same order as the sidebar (line-anchored by `startLine`, section-level last).

---

## Interaction Flow

1. User navigates to a section in the center panel
2. User hovers a line → gutter `+` brightens
3. User clicks `+` → line highlighted as range start (`▶`), sidebar shows "shift-click another line to extend, or shift-click this line for single-line comment"
4. User shift-clicks another `+` (or same line) → range locked, `CommentInput` opens in sidebar with quoted lines
5. User types comment → clicks "Add" → comment saved, `CommentInput` closes, selected lines get `◆` gutter marker
6. User clicks "Add comment to entire section" → `CommentInput` opens with no quote block, label "Commenting on entire section:"
7. On "Submit Review" → all comments (line-anchored and section-level) POSTed to `/api/review`, formatter runs

---

## Tech Debt

| Item | Priority | Notes |
|---|---|---|
| Click-and-hold drag selection | Medium | `mousedown`/`mousemove`/`mouseup` across `LineBlock` elements. Shift+click is MVP. |
| Richer AI prompt for line-anchored comments | Medium | Current output is raw blockquotes. Future: include surrounding context lines, section metadata (depends-on, blocks), and structured framing so the AI understands the spatial location of the comment within the plan. |
| Highlight persistence across navigation | Low | ◆ markers only shown on active section. Future: show comment count per section in TOC for line-anchored comments. |

---

## Files Changed

| File | Type | Change |
|---|---|---|
| `src/types.ts` | Modified | Replace `anchor` field with `LineAnchor` interface |
| `src/browser/lineRenderer.ts` | New | Custom marked renderer → `LineBlock[]` |
| `src/browser/LineBlock.tsx` | New | Single line component with gutter |
| `src/browser/SectionView.tsx` | Modified | Replace dangerouslySetInnerHTML with LineBlock map, range state |
| `src/browser/App.tsx` | Modified | `commentingSection` → `commentingTarget` |
| `src/browser/CommentInput.tsx` | Modified | Optional anchor prop, quoted lines display |
| `src/browser/CommentSidebar.tsx` | Modified | Line label + quote in CommentCard, ordering |
| `src/browser/styles.css` | Modified | Line block visual states (all using existing CSS variables) |
| `src/formatter.ts` | Modified | Blockquote lines for anchored comments |
