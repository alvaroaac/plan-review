# Browser Review UI — Design Spec

## Overview

Add a browser-based review mode to `plan-review`. When invoked with `--browser`, the CLI starts a local HTTP server, opens the user's browser, and presents the parsed markdown plan in a three-panel review interface. Users add section-level comments, submit, and the CLI outputs structured review through the existing output pipeline (stdout/clipboard/file/claude).

This is the standalone review tool. Claude Code hook integration is a separate future effort.

## Architecture

Single-package addition to existing `plan-review`. Three new layers alongside current CLI modules:

```
src/
  # Existing (unchanged)
  types.ts          — PlanDocument, Section, ReviewComment, OutputTarget
  parser.ts         — parse(), isPlanDocument()
  formatter.ts      — formatReview()
  output.ts         — writeOutput()
  renderer.ts       — terminal markdown rendering (CLI mode only)
  navigator.ts      — terminal interactive loop (CLI mode only)
  index.ts          — CLI entry point (adds --browser flag)

  # New
  transport.ts      — Transport interface + HttpTransport implementation
  server/
    server.ts       — HTTP server lifecycle (create, start, stop)
    routes.ts       — GET /, GET /api/doc, POST /api/review
    assets.ts       — serves bundled Preact app (embedded HTML+JS)
  browser/
    App.tsx          — root component, state management, doc fetching
    TOCPanel.tsx     — section tree navigation
    SectionView.tsx  — renders section markdown with marked
    CommentSidebar.tsx — comment list, add/edit/delete
    CommentCard.tsx  — single comment display
    CommentInput.tsx — textarea form for adding comments
    index.tsx        — Preact entry point
    styles.css       — dark theme styles

scripts/
  build-browser.js  — esbuild script for Preact bundle
```

### Data Flow

1. User runs `plan-review plan.md --browser`
2. CLI parses markdown with `parser.ts` → `PlanDocument`
3. CLI creates `HttpTransport`, starts server on random available port
4. CLI opens browser via `open` (macOS)
5. Browser loads Preact SPA from `GET /`
6. SPA fetches `GET /api/doc` → receives `PlanDocument` JSON
7. SPA renders three-panel UI, user adds section-level comments
8. User clicks "Submit Review" → `POST /api/review` with `ReviewComment[]`
9. Server receives comments, merges into `PlanDocument.comments`
10. CLI formats via `formatter.ts` → outputs via `output.ts`
11. Server shuts down, CLI exits

## Data Model

### ReviewComment Extension

Current:
```ts
interface ReviewComment {
  sectionId: string;
  text: string;
  timestamp: Date;
}
```

Extended (backward compatible):
```ts
interface ReviewComment {
  sectionId: string;
  text: string;
  timestamp: Date;
  anchor?: {
    type: 'section' | 'range';
    startOffset?: number;
    endOffset?: number;
    selectedText?: string;  // snapshot for anchor recovery
  };
}
```

For this iteration, all comments use `anchor.type = 'section'` or omit anchor entirely. The `range` type and offset fields are reserved for the text-range selection feature.

### API Contract

```
GET  /api/doc     → { document: PlanDocument }
POST /api/review  → { comments: ReviewComment[] }
                  ← { success: true }
GET  /            → HTML (Preact SPA)
```

## Transport Abstraction

```ts
interface Transport {
  sendDocument(doc: PlanDocument): void;
  onReviewSubmit(handler: (comments: ReviewComment[]) => void): void;
  start(port: number): Promise<{ url: string }>;
  stop(): Promise<void>;
}
```

`HttpTransport` implements this with Node `http` module. Future `WebSocketTransport` implements same interface — components and CLI don't change.

## Server Design

- **Framework**: Node built-in `http` module. Three routes don't justify Express.
- **Port**: `0` (OS-assigned random available port). Actual port printed to stderr after bind (e.g. `Review server running at http://localhost:54321`).
- **Browser open**: `open` command on macOS after server binds.
- **Shutdown**: server closes after receiving valid `POST /api/review`.
- **Timeout**: deferred (tracked as tech debt). No idle timeout in v1.
- **Asset serving**: bundled Preact app served as self-contained HTML with inline JS from `GET /`. No static file directory.

## Browser UI

### Layout

Three-panel layout, dark theme:

1. **Left — TOC Panel** (~220px): section tree with milestone grouping (plan mode) or flat list (generic mode). Click navigates to section in content area. Badge/indicator shows which sections have comments.

2. **Center — Content Area** (flex): rendered markdown per section using `marked`. Plan mode shows dependency metadata (depends on, blocks, verification command). Click-to-comment trigger at bottom of each section. Scrollable.

3. **Right — Comment Sidebar** (~300px): all comments listed, grouped by section. Each comment shows section reference, text, edit/delete buttons. Comment input form appears when user triggers comment on a section. Shows section context.

**Top bar**: document title, mode badge (plan/generic), comment count summary, Submit Review button.

### Preact Components

| Component | Responsibility |
|---|---|
| `App` | Root. Fetches doc from `/api/doc`, manages comment state, handles submit POST |
| `TOCPanel` | Renders section tree from `PlanDocument.sections`. Emits navigation events |
| `SectionView` | Renders one section's `body` as HTML via `marked`. Shows metadata in plan mode. Click handler for comment trigger |
| `CommentSidebar` | Lists all `ReviewComment[]`. Shows `CommentInput` when adding. Handles edit/delete |
| `CommentCard` | Displays single comment with section label, text, edit/delete actions |
| `CommentInput` | Textarea + Add/Cancel buttons. Receives `sectionId` context |

### Text-Range Readiness

Section-level comments only in v1, but design accommodates future upgrade:
- `SectionView` content area will be a container that can later attach text selection listeners
- `CommentInput` receives anchor data (currently just `sectionId`, later includes offsets)
- `CommentCard` displays anchor type (currently always section, later shows selected text snippet)
- Data model already has `anchor` field with `type` discriminator

## Build Pipeline

### Production Build

```
npm run build
  1. tsc              → compiles server/CLI TypeScript to dist/
  2. build-browser.js → esbuild bundles src/browser/ → dist/browser/app.js
  3. inline step      → embeds app.js into HTML shell → dist/browser/index.html
```

### Dev Workflow

```
npm run dev            → tsx for server (existing)
npm run build:browser  → one-shot browser bundle
npm run dev:browser    → esbuild watch mode for browser
npm test               → vitest (all tests)
```

### Dependencies

**New runtime:** `preact`

**New dev:** `esbuild`, `@testing-library/preact`, `jsdom`

### package.json Scripts

```json
"build": "tsc && node scripts/build-browser.js",
"build:browser": "node scripts/build-browser.js",
"dev:browser": "node scripts/build-browser.js --watch"
```

## Testing Strategy

TDD approach — tests written before implementation for each task.

### Test Areas

| Area | What to test | Approach |
|---|---|---|
| Server routes | GET /api/doc returns PlanDocument, POST /api/review accepts comments, GET / serves HTML | Unit tests with real HTTP server on random port |
| Transport | HttpTransport implements interface, lifecycle, callback fires | Unit tests |
| Browser components | SectionView renders markdown, CommentSidebar manages state, TOCPanel navigation | `@testing-library/preact` + jsdom via vitest |
| Build artifacts | esbuild produces valid bundle, HTML contains embedded JS | Integration test |
| CLI integration | `--browser` flag triggers server, POST submit produces output | Integration test |

### Vitest Config

Add jsdom environment for browser tests:
```ts
// vitest.config.ts or inline
{
  test: {
    environmentMatchGlobs: [
      ['tests/browser/**', 'jsdom']
    ]
  }
}
```

### Existing Tests

All 91 existing tests remain unchanged. Parser, output, and formatter tests continue to pass as-is.

## CLI Changes

`src/index.ts` adds:
- `--browser` flag to commander options
- When `--browser` is set: skip navigator, create HttpTransport, start server, wait for submit, then format + output as normal
- Output target selection still works: `--browser -o clipboard` reviews in browser, copies result to clipboard

## Constraints

- **Existing modes unaffected.** Running `plan-review plan.md` without `--browser` must behave identically to current v0.1.1. No regressions to CLI interactive mode, output targets, parser behavior, or any existing functionality. All 91 existing tests must continue to pass unchanged.

## Out of Scope (v1)

- Text-range comment selection (designed for, not implemented)
- WebSocket transport (interface ready, REST only)
- Server idle timeout (tech debt)
- Claude Code PostWrite hook integration (future project)
- Windows support (macOS/Linux only, consistent with existing CLI)
- Multiple concurrent review sessions
- Collaborative review (multiple users)
