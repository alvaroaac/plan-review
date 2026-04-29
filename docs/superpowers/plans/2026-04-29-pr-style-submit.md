# PR-Style Submit (Verdict + Summary) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "Submit Review" button with a GitHub PR-review-style flow: reviewer chooses a verdict (`approved` or `null`-comment) and may include an overall summary text, in addition to existing per-section comments.

**Architecture:** New transient submission contract `ReviewSubmission { comments, verdict, summary }` plumbed end-to-end through `ReviewClient`, the VS Code webview protocol, and the CLI HTTP `/api/review` route. New Preact `SubmitReviewPanel` owns the split-button + popover UI. `formatReview()` gains `opts: { verdict, summary }` to render a `## Verdict` line and an optional `## Overall Comments` block. Verdict + summary are NOT persisted to session (popover is transient).

**Tech Stack:** TypeScript, Preact, vitest, `@testing-library/preact`, jsdom, Node `http`.

**Spec:** [docs/superpowers/specs/2026-04-29-pr-style-submit-design.md](../specs/2026-04-29-pr-style-submit-design.md)

---

## File Map

```
packages/core/src/types.ts                       # MODIFY: add ReviewVerdict, ReviewSubmission
packages/core/src/index.ts                       # already re-exports types.ts (no change expected)
packages/core/src/formatter.ts                   # MODIFY: signature + verdict/summary render
packages/core/src/reviewClient.ts                # MODIFY: ReviewClient.submitReview signature + FakeReviewClient
packages/core/tests/formatter.test.ts            # MODIFY: update existing calls + add new cases

packages/browser-app/src/httpClient.ts           # MODIFY: send ReviewSubmission body
packages/browser-app/src/SubmitReviewPanel.tsx   # CREATE
packages/browser-app/src/styles.css              # MODIFY: add popover styles
packages/browser-app/src/App.tsx                 # MODIFY: use SubmitReviewPanel, plumb verdict/summary
packages/browser-app/tests/SubmitReviewPanel.test.tsx  # CREATE
packages/browser-app/tests/httpClient.test.ts    # MODIFY: assert new body shape
packages/browser-app/tests/App.test.tsx          # MODIFY: update submit assertions

packages/cli/src/server/routes.ts                # MODIFY: parse + validate verdict/summary
packages/cli/src/transport.ts                    # MODIFY: onReviewSubmit handler signature
packages/cli/src/browser-review.ts               # MODIFY: return { comments, verdict, summary }
packages/cli/src/index.ts                        # MODIFY: pass verdict/summary to formatReview
packages/cli/tests/server/routes.test.ts (or similar)  # MODIFY: update body shape assertions

packages/vscode-extension/src/messageHandlers.ts # MODIFY: submitReview params + forward
packages/vscode-extension/src/extension.ts       # MODIFY: handleWebviewMessage unpacks new params
packages/vscode-extension/src/submit/index.ts    # MODIFY: runSubmit takes verdict/summary
packages/vscode-extension/test/unit/messageDispatch.test.ts    # MODIFY: new params shape
packages/vscode-extension/test/unit/submit.fanOut.test.ts      # MODIFY: pass verdict/summary
```

Use `git grep` from repo root to confirm exact CLI test path (`packages/cli/tests/...`) before starting Task 5; if no existing route test exists, add one only if straightforward, otherwise rely on integration via `httpClient.test.ts`.

---

## Conventions

- All test commands run from repo root unless noted.
- Per-package tests: `npm --workspace @plan-review/<name> test`.
- All-package tests: `npm test -ws --if-present`.
- Typecheck per-package: `npm --workspace @plan-review/<name> run typecheck`.
- TDD: every code task writes a failing test first, then minimal code, then asserts test passes.
- Commit after every task. Keep commits small and topical.

---

## Task 1: Add `ReviewVerdict` + `ReviewSubmission` types

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add the new types**

Append at the end of `packages/core/src/types.ts`:

```ts
export type ReviewVerdict = 'approved' | null;

export interface ReviewSubmission {
  comments: ReviewComment[];
  verdict: ReviewVerdict;
  summary: string; // empty string allowed
}
```

- [ ] **Step 2: Verify the types are exported**

Run: `npm --workspace @plan-review/core run typecheck`
Expected: passes (new types compile, no other code uses them yet).

The existing `packages/core/src/index.ts` already does `export * from './types.js';` — no change needed.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): add ReviewVerdict and ReviewSubmission types"
```

---

## Task 2: Update `formatReview` signature + verdict/summary rendering (TDD)

**Files:**
- Test: `packages/core/tests/formatter.test.ts`
- Modify: `packages/core/src/formatter.ts`

- [ ] **Step 1: Update existing test calls to pass new opts arg**

In `packages/core/tests/formatter.test.ts`, every call to `formatReview(doc)` currently passes one argument. Update them to `formatReview(doc, { verdict: null, summary: '' })`. Use a sed-style search to find them:

Run: `grep -n "formatReview(" packages/core/tests/formatter.test.ts`

For each match, change `formatReview(doc)` → `formatReview(doc, { verdict: null, summary: '' })`. Same for any local variable variants.

- [ ] **Step 2: Add new failing tests for verdict + summary**

Append these tests inside the existing `describe('formatReview', () => { ... })` block in `packages/core/tests/formatter.test.ts`:

```ts
  it('renders verdict "Approved" when opts.verdict is "approved"', () => {
    const doc = makeDoc({ comments: [] });
    const out = formatReview(doc, { verdict: 'approved', summary: '' });
    expect(out).toContain('**Verdict:** Approved');
  });

  it('renders verdict "Comment" when opts.verdict is null', () => {
    const doc = makeDoc({
      comments: [{ sectionId: '1.1', text: 'X', timestamp: new Date() }],
    });
    const out = formatReview(doc, { verdict: null, summary: '' });
    expect(out).toContain('**Verdict:** Comment');
  });

  it('renders ## Overall Comments when summary is non-empty', () => {
    const doc = makeDoc({ comments: [] });
    const out = formatReview(doc, {
      verdict: 'approved',
      summary: 'Looks great overall.',
    });
    expect(out).toContain('## Overall Comments');
    expect(out).toContain('Looks great overall.');
  });

  it('omits ## Overall Comments when summary is empty or whitespace', () => {
    const doc = makeDoc({ comments: [] });
    const out = formatReview(doc, { verdict: 'approved', summary: '   ' });
    expect(out).not.toContain('## Overall Comments');
  });

  it('renders full template with no sections when approved + zero comments', () => {
    const doc = makeDoc({ comments: [] });
    const out = formatReview(doc, { verdict: 'approved', summary: '' });
    expect(out).toContain('# Plan Review: Test Plan');
    expect(out).toContain('**Verdict:** Approved');
    expect(out).toContain('**Comments:** 0');
    expect(out).not.toContain('## Section');
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm --workspace @plan-review/core test -- --run formatter`
Expected: TypeScript error or test failures because `formatReview` does not yet accept opts and does not render verdict/summary.

- [ ] **Step 4: Update `formatReview` signature and rendering**

Replace the contents of `packages/core/src/formatter.ts` with:

```ts
import type { PlanDocument, ReviewComment, ReviewVerdict } from './types.js';

function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_`~\[\]#>|])/g, '\\$1');
}

function sortComments(comments: ReviewComment[]): ReviewComment[] {
  return [...comments].sort((a, b) => {
    const aLine = a.anchor?.startLine ?? Infinity;
    const bLine = b.anchor?.startLine ?? Infinity;
    return aLine - bLine;
  });
}

function verdictLabel(verdict: ReviewVerdict): string {
  return verdict === 'approved' ? 'Approved' : 'Comment';
}

export interface FormatReviewOptions {
  verdict: ReviewVerdict;
  summary: string;
}

export function formatReview(doc: PlanDocument, opts: FormatReviewOptions): string {
  const commentedSectionIds = new Set(doc.comments.map((c) => c.sectionId));
  const reviewableSections = doc.sections.filter((s) =>
    doc.mode === 'plan' ? s.level === 3 : s.level >= 2,
  );
  const commentedSections = reviewableSections.filter((s) => commentedSectionIds.has(s.id));

  const parts: string[] = [];

  parts.push(`# Plan Review: ${doc.title}`);
  parts.push('');
  parts.push('## Review Summary');
  parts.push(`- **Verdict:** ${verdictLabel(opts.verdict)}`);
  parts.push(`- **Sections reviewed:** ${commentedSections.length}/${reviewableSections.length}`);
  parts.push(`- **Comments:** ${doc.comments.length}`);
  parts.push(
    `- **Skipped:** ${reviewableSections.length - commentedSections.length} sections without comments`,
  );

  if (opts.summary.trim() !== '') {
    parts.push('');
    parts.push('## Overall Comments');
    parts.push('');
    parts.push(escapeMarkdown(opts.summary));
  }

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
        parts.push(escapeMarkdown(comment.text));
      } else {
        parts.push('### Reviewer Comment (entire section)');
        parts.push('');
        parts.push(escapeMarkdown(comment.text));
      }
      parts.push('');
      parts.push('---');
    }
  }

  return parts.join('\n');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --workspace @plan-review/core test -- --run formatter`
Expected: all formatter tests pass, including the 5 new ones.

- [ ] **Step 6: Run core typecheck**

Run: `npm --workspace @plan-review/core run typecheck`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/formatter.ts packages/core/tests/formatter.test.ts
git commit -m "feat(core): formatReview takes verdict + summary opts"
```

---

## Task 3: Update `ReviewClient` interface + `FakeReviewClient`

**Files:**
- Modify: `packages/core/src/reviewClient.ts`
- Test: `packages/core/tests/reviewClient.test.ts` (if it exercises submitReview)

- [ ] **Step 1: Inspect the existing reviewClient test**

Run: `grep -n "submitReview" packages/core/tests/reviewClient.test.ts`
Note any calls so you can update them.

- [ ] **Step 2: Update the interface and `FakeReviewClient`**

Replace the contents of `packages/core/src/reviewClient.ts` with:

```ts
import type { PlanDocument, ReviewComment, ReviewSubmission } from './types.js';

export interface SessionState {
  comments: ReviewComment[];
  activeSection: string | null;
  contentHash: string;
}

export interface ReviewClient {
  loadDocument(): Promise<{
    document: PlanDocument;
    contentHash?: string;
    restoredSession?: { comments: ReviewComment[]; activeSection: string | null; stale: boolean };
  }>;
  saveSession(state: SessionState): Promise<void>;
  submitReview(submission: ReviewSubmission): Promise<{ ok: true }>;
}

export class FakeReviewClient implements ReviewClient {
  readonly sessionSaves: SessionState[] = [];
  readonly submits: ReviewSubmission[] = [];
  constructor(private readonly opts: { document: PlanDocument; contentHash?: string }) {}
  async loadDocument() {
    return { document: this.opts.document, contentHash: this.opts.contentHash };
  }
  async saveSession(state: SessionState) { this.sessionSaves.push(state); }
  async submitReview(submission: ReviewSubmission) { this.submits.push(submission); return { ok: true as const }; }
}
```

- [ ] **Step 3: Update reviewClient tests if any reference `submitReview`**

For each call you found in step 1, change the argument from `comments` to `{ comments, verdict: null, summary: '' }`. If `submits` was previously asserted as `ReviewComment[][]`, update to `ReviewSubmission[]` (the `.submits[i].comments` shape).

- [ ] **Step 4: Run core tests**

Run: `npm --workspace @plan-review/core test`
Expected: passes.

- [ ] **Step 5: Run core typecheck**

Run: `npm --workspace @plan-review/core run typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/reviewClient.ts packages/core/tests/reviewClient.test.ts
git commit -m "feat(core): ReviewClient.submitReview takes ReviewSubmission"
```

---

## Task 4: Update `HttpReviewClient` to send `ReviewSubmission` body (TDD)

**Files:**
- Test: `packages/browser-app/tests/httpClient.test.ts`
- Modify: `packages/browser-app/src/httpClient.ts`

- [ ] **Step 1: Inspect existing test**

Run: `grep -n "submitReview" packages/browser-app/tests/httpClient.test.ts`

- [ ] **Step 2: Update existing test + add new assertion**

Find the existing test that calls `client.submitReview(...)` and update it. The test should:

- Pass a `ReviewSubmission` (e.g. `{ comments: [], verdict: 'approved', summary: 'Looks good' }`) to `submitReview`.
- Assert the fetch body parses to that exact submission object (not just `{ comments }`).

Example test (rewrite or replace existing equivalent — keep neighboring tests intact):

```ts
it('submitReview POSTs full ReviewSubmission body to /api/review', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  const client = new HttpReviewClient();
  await client.submitReview({
    comments: [{ sectionId: '1', text: 'note', timestamp: new Date() }],
    verdict: 'approved',
    summary: 'LGTM',
  });

  expect(fetchMock).toHaveBeenCalledWith('/api/review', expect.objectContaining({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }));
  const [, init] = fetchMock.mock.calls[0];
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.verdict).toBe('approved');
  expect(body.summary).toBe('LGTM');
  expect(body.comments).toHaveLength(1);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace @plan-review/browser-app test -- --run httpClient`
Expected: test fails because current implementation only sends `{ comments }`.

- [ ] **Step 4: Update `HttpReviewClient`**

Replace `packages/browser-app/src/httpClient.ts` with:

```ts
import type { ReviewClient, SessionState, PlanDocument, ReviewSubmission } from '@plan-review/core';

export class HttpReviewClient implements ReviewClient {
  async loadDocument(): Promise<{ document: PlanDocument }> {
    const res = await fetch('/api/doc');
    if (!res.ok) throw new Error(`loadDocument failed: ${res.status}`);
    return res.json();
  }

  async saveSession(state: SessionState): Promise<void> {
    const res = await fetch('/api/session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (!res.ok) throw new Error(`saveSession failed: ${res.status}`);
  }

  async submitReview(submission: ReviewSubmission): Promise<{ ok: true }> {
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
    });
    if (!res.ok) throw new Error(`submitReview failed: ${res.status}`);
    return { ok: true };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace @plan-review/browser-app test -- --run httpClient`
Expected: passes.

- [ ] **Step 6: Run typecheck**

Run: `npm --workspace @plan-review/browser-app run typecheck`
Expected: passes (App.tsx may surface a separate type error from old submit call — leave that for Task 8; if blocking, temporarily skip in this typecheck).

If typecheck fails on `App.tsx` because of the upcoming refactor, accept the failure here and proceed to next task; CI typecheck will be re-run after Task 8.

- [ ] **Step 7: Commit**

```bash
git add packages/browser-app/src/httpClient.ts packages/browser-app/tests/httpClient.test.ts
git commit -m "feat(browser): HttpReviewClient sends ReviewSubmission body"
```

---

## Task 5: Update CLI `/api/review` route to accept new body

**Files:**
- Modify: `packages/cli/src/server/routes.ts`
- Modify: `packages/cli/src/transport.ts` (handler signature)

- [ ] **Step 1: Update the routes handler at line 56–95**

In `packages/cli/src/server/routes.ts`, locate the `POST /api/review` handler. Replace the parsed-body validation block (currently parses `comments` only) with this:

```ts
      req.on('end', () => {
        if (size > MAX_BODY_SIZE) return;
        try {
          const parsed = JSON.parse(body);
          const comments = parsed.comments;
          const verdict = parsed.verdict;
          const summary = parsed.summary;

          if (!Array.isArray(comments)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'comments must be an array' }));
            return;
          }
          for (const c of comments) {
            if (!validateComment(c)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Each comment must have sectionId (string) and text (string)' }));
              return;
            }
          }
          if (verdict !== 'approved' && verdict !== null) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: "verdict must be 'approved' or null" }));
            return;
          }
          if (typeof summary !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'summary must be a string' }));
            return;
          }
          ctx.onSubmit({ comments: comments as ReviewComment[], verdict, summary });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
```

- [ ] **Step 2: Update the `onSubmit` context type at line 23**

In the same file, change:

```ts
  onSubmit: (comments: ReviewComment[]) => void;
```

to:

```ts
  onSubmit: (submission: { comments: ReviewComment[]; verdict: 'approved' | null; summary: string }) => void;
```

If `ReviewSubmission` is exported from `@plan-review/core` and already imported, prefer:

```ts
import type { ReviewComment, ReviewSubmission } from '@plan-review/core';
// ...
  onSubmit: (submission: ReviewSubmission) => void;
```

(Add the import if missing.)

- [ ] **Step 3: Update transport.ts to match**

In `packages/cli/src/transport.ts`:
- Change interface `Transport.onReviewSubmit` signature: `onReviewSubmit(handler: (submission: ReviewSubmission) => void): void;`
- Change `submitHandler` field type accordingly: `private submitHandler: ((submission: ReviewSubmission) => void) | null = null;`
- Change `onReviewSubmit` method body: `this.submitHandler = handler;` (unchanged, just retype)
- Change `onSubmit` adapter inside `start()`: `onSubmit: (submission) => this.submitHandler?.(submission),`
- Add `ReviewSubmission` to the type import.

- [ ] **Step 4: Typecheck CLI**

Run: `npm --workspace @plan-review/cli run typecheck`
Expected: now `runBrowserReview` (Task 6) is the next compile error. Note it but proceed.

- [ ] **Step 5: Run CLI tests**

Run: `npm --workspace @plan-review/cli test`
Expected: tests that exercise `/api/review` may need body-shape updates. If a test exists, update its POST body to include `verdict: null, summary: ''`. If none exists, this passes.

If a route test does exist and needs updating, search:

Run: `grep -rn "/api/review" packages/cli/tests 2>/dev/null`

For each test that POSTs to that path, ensure body contains `verdict` and `summary` keys.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/server/routes.ts packages/cli/src/transport.ts packages/cli/tests
git commit -m "feat(cli): /api/review accepts verdict + summary"
```

---

## Task 6: Plumb verdict + summary through `runBrowserReview` and `index.ts`

**Files:**
- Modify: `packages/cli/src/browser-review.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Update `runBrowserReview` return type**

In `packages/cli/src/browser-review.ts`:

- Change the import: `import type { PlanDocument, ReviewSubmission } from '@plan-review/core';` (drop `ReviewComment` if no longer needed; keep if used elsewhere in this file).
- Change the function return type from `Promise<ReviewComment[]>` to `Promise<ReviewSubmission>`.
- Inside the `Promise<...>` constructor at line ~35, change the type to `Promise<ReviewSubmission>`.
- Change the `onReviewSubmit` callback at line 62 to accept the full submission and resolve with it:

```ts
    transport.onReviewSubmit((submission) => {
      clearAll();
      resolve(submission);
    });
```

- [ ] **Step 2: Hoist verdict/summary state and pass to `formatReview`**

A clean rewrite of the relevant region in `packages/cli/src/index.ts` (the section starting at the comment `// Navigate (interactive review or browser)` and ending at the `formatReview` call near line 184):

```ts
  // Navigate (interactive review or browser)
  let reviewed: PlanDocument;
  let verdict: 'approved' | null = null;
  let summary = '';

  if (!opts.cli) {
    const submission = await runBrowserReview({ doc, absPath, contentHash, restoredActiveSection });
    doc.comments = submission.comments;
    verdict = submission.verdict;
    summary = submission.summary;
    reviewed = doc;
  } else {
    const onCommentChange = absPath
      ? () => saveSession(absPath, contentHash, doc.comments, null)
      : undefined;
    reviewed = await navigate(doc, inputFromStdin, onCommentChange);
    // CLI (interactive TTY) mode does not yet support verdict/summary.
    // Default to comment-only with no overall summary.
  }

  // Clear session after successful review completion
  if (absPath) clearSession(absPath);

  // Determine output target after review is complete
  let outputTarget: OutputTarget;
  if (opts.output !== undefined) {
    outputTarget = opts.output as OutputTarget;
  } else {
    outputTarget = await promptOutputTarget(inputFromStdin);
    // Check claude availability after prompting
    if (outputTarget === 'claude' && !isClaudeAvailable()) {
      console.error(chalk.red('Claude CLI not found in PATH.'));
      console.error(chalk.dim('Install: https://docs.anthropic.com/en/docs/claude-code'));
      console.error(chalk.yellow('Falling back to stdout.'));
      outputTarget = 'stdout';
    }
  }

  // Format and output
  const output = formatReview(reviewed, { verdict, summary });
  writeOutput(output, outputTarget, { outputFile: opts.outputFile, inputFile: file });
```

If `PlanDocument` is not yet imported, add it to the existing `@plan-review/core` import.

- [ ] **Step 3: Typecheck CLI**

Run: `npm --workspace @plan-review/cli run typecheck`
Expected: passes.

- [ ] **Step 4: Run CLI tests**

Run: `npm --workspace @plan-review/cli test`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/browser-review.ts packages/cli/src/index.ts
git commit -m "feat(cli): plumb verdict + summary from browser to formatReview"
```

---

## Task 7: Create `SubmitReviewPanel` component (TDD)

**Files:**
- Test: `packages/browser-app/tests/SubmitReviewPanel.test.tsx`
- Create: `packages/browser-app/src/SubmitReviewPanel.tsx`

- [ ] **Step 1: Inspect a sibling component test for patterns**

Run: `head -40 packages/browser-app/tests/CommentInput.test.tsx`

Note the imports (`render`, `fireEvent`, etc.) and the way the test bootstraps Preact components. Mirror that pattern.

- [ ] **Step 2: Write the failing test**

Create `packages/browser-app/tests/SubmitReviewPanel.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { SubmitReviewPanel } from '../src/SubmitReviewPanel.js';

describe('SubmitReviewPanel', () => {
  it('renders the split-button with chevron', () => {
    const { getByText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    expect(getByText(/Submit Review/i)).toBeTruthy();
  });

  it('opens popover with verdict radios + summary textarea on click', () => {
    const { getByText, getByPlaceholderText, getByLabelText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    expect(getByLabelText(/Approve/i)).toBeTruthy();
    expect(getByLabelText(/Comment/i)).toBeTruthy();
    expect(getByPlaceholderText(/leave a summary/i)).toBeTruthy();
  });

  it('submit button is enabled for Approve regardless of comments/summary', () => {
    const { getByText, getByLabelText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    fireEvent.click(getByLabelText(/Approve/i));
    const submitBtn = getByText('Submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('Comment verdict is disabled with empty summary AND zero comments', () => {
    const { getByText, getByLabelText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    fireEvent.click(getByLabelText(/Comment/i));
    const submitBtn = getByText('Submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('Comment verdict is enabled when summary is non-empty', () => {
    const { getByText, getByLabelText, getByPlaceholderText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    fireEvent.click(getByLabelText(/Comment/i));
    const ta = getByPlaceholderText(/leave a summary/i) as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: 'something' } });
    const submitBtn = getByText('Submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('Comment verdict is enabled when commentCount > 0', () => {
    const { getByText, getByLabelText } = render(
      <SubmitReviewPanel commentCount={2} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    fireEvent.click(getByLabelText(/Comment/i));
    const submitBtn = getByText('Submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('calls onSubmit with verdict + summary on confirm', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByLabelText, getByPlaceholderText } = render(
      <SubmitReviewPanel commentCount={1} onSubmit={onSubmit} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    fireEvent.click(getByLabelText(/Approve/i));
    const ta = getByPlaceholderText(/leave a summary/i) as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: 'great work' } });
    fireEvent.click(getByText('Submit'));
    expect(onSubmit).toHaveBeenCalledWith('approved', 'great work');
  });

  it('Cancel closes the popover', () => {
    const { getByText, queryByLabelText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    expect(queryByLabelText(/Approve/i)).toBeTruthy();
    fireEvent.click(getByText('Cancel'));
    expect(queryByLabelText(/Approve/i)).toBeNull();
  });

  it('Escape closes the popover', () => {
    const { getByText, queryByLabelText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    expect(queryByLabelText(/Approve/i)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByLabelText(/Approve/i)).toBeNull();
  });

  it('outer button is disabled when disabled prop is true', () => {
    const { getByText } = render(
      <SubmitReviewPanel commentCount={0} disabled onSubmit={vi.fn()} />,
    );
    const btn = getByText(/Submit Review/i).closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm --workspace @plan-review/browser-app test -- --run SubmitReviewPanel`
Expected: fails — file does not exist.

- [ ] **Step 4: Implement the component**

Create `packages/browser-app/src/SubmitReviewPanel.tsx`:

```tsx
import { useState, useEffect, useRef } from 'preact/hooks';
import type { ReviewVerdict } from '@plan-review/core';

export interface SubmitReviewPanelProps {
  commentCount: number;
  disabled?: boolean;
  onSubmit: (verdict: ReviewVerdict, summary: string) => Promise<void>;
}

export function SubmitReviewPanel({ commentCount, disabled, onSubmit }: SubmitReviewPanelProps) {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<ReviewVerdict>('approved');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (popoverRef.current && t && !popoverRef.current.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const submitEnabled =
    verdict === 'approved' || summary.trim() !== '' || commentCount > 0;

  const handleConfirm = async () => {
    if (!submitEnabled || busy) return;
    setBusy(true);
    try {
      await onSubmit(verdict, summary);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="submit-panel" ref={popoverRef}>
      <button
        type="button"
        class="submit-btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        Submit Review <span class="caret">▾</span>
      </button>
      {open && (
        <div class="submit-popover" role="dialog">
          <label class="submit-radio">
            <input
              type="radio"
              name="verdict"
              checked={verdict === 'approved'}
              onChange={() => setVerdict('approved')}
            />
            Approve
          </label>
          <label class="submit-radio">
            <input
              type="radio"
              name="verdict"
              checked={verdict === null}
              onChange={() => setVerdict(null)}
            />
            Comment
          </label>
          <textarea
            class="submit-summary"
            placeholder="Leave a summary…"
            value={summary}
            onInput={(e) => setSummary((e.currentTarget as HTMLTextAreaElement).value)}
          />
          <div class="submit-actions">
            <button type="button" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              class="submit-confirm"
              onClick={handleConfirm}
              disabled={!submitEnabled || busy}
            >
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --workspace @plan-review/browser-app test -- --run SubmitReviewPanel`
Expected: passes.

- [ ] **Step 6: Run typecheck**

Run: `npm --workspace @plan-review/browser-app run typecheck`
Expected: passes for the new component (App.tsx may still error from old call site — that's Task 8).

- [ ] **Step 7: Commit**

```bash
git add packages/browser-app/src/SubmitReviewPanel.tsx packages/browser-app/tests/SubmitReviewPanel.test.tsx
git commit -m "feat(browser): add SubmitReviewPanel split-button + popover"
```

---

## Task 8: Add popover CSS

**Files:**
- Modify: `packages/browser-app/src/styles.css`

- [ ] **Step 1: Inspect existing top-bar styles**

Run: `grep -n "top-bar\|submit-btn" packages/browser-app/src/styles.css`

- [ ] **Step 2: Append popover styles**

Append to `packages/browser-app/src/styles.css`:

```css
.submit-panel {
  position: relative;
  display: inline-block;
}

.submit-panel .submit-btn .caret {
  margin-left: 0.4em;
  font-size: 0.8em;
}

.submit-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 320px;
  padding: 12px;
  background: var(--bg-elev, #1f1f1f);
  color: inherit;
  border: 1px solid var(--border, #444);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.submit-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.submit-summary {
  width: 100%;
  min-height: 80px;
  padding: 6px 8px;
  font-family: inherit;
  font-size: 0.95em;
  background: var(--bg, #111);
  color: inherit;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  resize: vertical;
}

.submit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.submit-confirm:disabled,
.submit-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

(If the existing CSS uses different variable names — e.g. `--background-elevated` — adapt the var names to match what's already in the file. Use the values you saw in step 1.)

- [ ] **Step 3: Verify build still works**

Run: `npm --workspace @plan-review/browser-app run build`
Expected: passes (CSS is bundled with esbuild).

- [ ] **Step 4: Commit**

```bash
git add packages/browser-app/src/styles.css
git commit -m "style(browser): popover styles for SubmitReviewPanel"
```

---

## Task 9: Wire `SubmitReviewPanel` into `App.tsx`

**Files:**
- Modify: `packages/browser-app/src/App.tsx`
- Modify: `packages/browser-app/tests/App.test.tsx`

- [ ] **Step 1: Inspect current App test for submit assertions**

Run: `grep -n "submitReview\|Submit Review\|submit-btn" packages/browser-app/tests/App.test.tsx`
Note any test that exercises the submit flow.

- [ ] **Step 2: Update `App.tsx` to use the new component**

Apply these edits to `packages/browser-app/src/App.tsx`:

1. Add import near the top, alongside other component imports:

```tsx
import { SubmitReviewPanel } from './SubmitReviewPanel.js';
```

2. Replace the `submitReview` handler (lines 157–164) with:

```tsx
  const submitReview = async (verdict: 'approved' | null, summary: string) => {
    try {
      await client.submitReview({ comments, verdict, summary });
      setSubmitted(true);
    } catch {
      setError('Failed to submit review');
    }
  };
```

3. Replace the existing submit button in the header (line 192–194):

```tsx
        <button class="submit-btn" onClick={submitReview} disabled={comments.length === 0}>
          Submit Review
        </button>
```

with:

```tsx
        <SubmitReviewPanel
          commentCount={comments.length}
          disabled={!doc}
          onSubmit={submitReview}
        />
```

- [ ] **Step 3: Update App tests for new submit flow**

For each test that previously simulated a submit click on the old button, update it to:
- Click the split-button (`Submit Review`)
- Click the desired verdict radio (`Approve` or `Comment`)
- Optionally set a summary
- Click the inner `Submit` button
- Assert the `submitReview` call shape is `{ comments, verdict, summary }`

Concrete pattern (use this when adapting):

```tsx
fireEvent.click(getByText(/Submit Review/i));
fireEvent.click(getByLabelText(/Approve/i));
fireEvent.click(getByText('Submit'));
// then:
expect(client.submits[0]).toEqual({ comments: [], verdict: 'approved', summary: '' });
```

If `App.test.tsx` uses `FakeReviewClient`, its `submits` array now stores `ReviewSubmission`, not `ReviewComment[]`. Update assertions accordingly.

- [ ] **Step 4: Run browser-app tests**

Run: `npm --workspace @plan-review/browser-app test`
Expected: passes.

- [ ] **Step 5: Run typecheck**

Run: `npm --workspace @plan-review/browser-app run typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add packages/browser-app/src/App.tsx packages/browser-app/tests/App.test.tsx
git commit -m "feat(browser): use SubmitReviewPanel in App, plumb verdict/summary"
```

---

## Task 10: Update `messageHandlers.submitReview` to forward verdict + summary

**Files:**
- Modify: `packages/vscode-extension/src/messageHandlers.ts`
- Modify: `packages/vscode-extension/src/extension.ts` (the `handleWebviewMessage` dispatcher)

- [ ] **Step 1: Update `MessageHandlers.submitReview` signature**

In `packages/vscode-extension/src/messageHandlers.ts`:

```ts
import {
  parse,
  computeContentHash,
  loadSession,
  saveSession as coreSaveSession,
  type PlanDocument,
  type ReviewComment,
  type ReviewVerdict,
} from '@plan-review/core';
```

Change interface to:

```ts
  submitReview(params: {
    planFsPath: string;
    document: PlanDocument;
    comments: ReviewComment[];
    verdict: ReviewVerdict;
    summary: string;
  }): Promise<{ ok: true; submitted: boolean }>;
```

Change `createMessageHandlers` deps + body:

```ts
export function createMessageHandlers(deps?: {
  submit?: (args: {
    planFsPath: string;
    document: PlanDocument;
    comments: ReviewComment[];
    verdict: ReviewVerdict;
    summary: string;
  }) => Promise<{ submitted: boolean }>;
}): MessageHandlers {
  return {
    // loadDocument, saveSession unchanged
    async submitReview({ planFsPath, document, comments, verdict, summary }) {
      const result = await deps?.submit?.({ planFsPath, document, comments, verdict, summary });
      return { ok: true as const, submitted: result?.submitted ?? true };
    },
  };
}
```

(Keep the unchanged handlers in place; the snippet above only shows the changed shape.)

- [ ] **Step 2: Update dispatcher (`extension.ts → handleWebviewMessage`) to read new params**

In `packages/vscode-extension/src/extension.ts`, find the branch that handles `method === 'submitReview'`. The existing call looks like:

```ts
case 'submitReview': {
  const params = msg.params as { comments: ReviewComment[] };
  const result = await handlers.submitReview({
    planFsPath: ctx.planFsPath,
    document: ctx.cachedDoc,
    comments: params.comments,
  });
  // ...
}
```

Change to:

```ts
case 'submitReview': {
  const params = msg.params as {
    comments: ReviewComment[];
    verdict: 'approved' | null;
    summary: string;
  };
  const result = await handlers.submitReview({
    planFsPath: ctx.planFsPath,
    document: ctx.cachedDoc,
    comments: params.comments,
    verdict: params.verdict,
    summary: params.summary,
  });
  // ...
}
```

- [ ] **Step 3: Typecheck**

Run: `npm --workspace @plan-review/vscode-extension run typecheck`
Expected: passes (pending Task 12 still uses old shape in tests).

- [ ] **Step 4: Commit**

```bash
git add packages/vscode-extension/src/messageHandlers.ts packages/vscode-extension/src/extension.ts
git commit -m "feat(vscode): messageHandlers.submitReview forwards verdict + summary"
```

---

## Task 11: Update `runSubmit` to take + use verdict + summary

**Files:**
- Modify: `packages/vscode-extension/src/submit/index.ts`

- [ ] **Step 1: Update the `runSubmit` signature**

Replace the signature and the `formatReview` call in `packages/vscode-extension/src/submit/index.ts`:

```ts
import * as vscode from 'vscode';
import { formatReview, type PlanDocument, type ReviewComment, type ReviewVerdict } from '@plan-review/core';
// ... (rest of imports unchanged)

export async function runSubmit(args: {
  planFsPath: string;
  document: PlanDocument;
  comments: ReviewComment[];
  verdict: ReviewVerdict;
  summary: string;
}): Promise<{ submitted: boolean }> {
  const settings = getSettings();

  let targets: SubmitTarget[];
  // ... (askBeforeSubmit branch unchanged)

  const docWithComments: PlanDocument = { ...args.document, comments: args.comments };
  const formatted = formatReview(docWithComments, {
    verdict: args.verdict,
    summary: args.summary,
  });

  // ... (Promise.allSettled fan-out unchanged)
  // ... (success/failure messaging unchanged)

  return { submitted: true };
}
```

(Apply only the diff that adds `verdict` + `summary` to args, threads them into the `formatReview` call, and updates the import. Leave all UI / fan-out logic intact.)

- [ ] **Step 2: Wire `runSubmit` to `createMessageHandlers` deps**

Find where `createMessageHandlers({ submit: runSubmit })` is set up:

Run: `grep -rn "createMessageHandlers\|runSubmit" packages/vscode-extension/src/extension.ts packages/vscode-extension/src 2>/dev/null | head -20`

The existing wiring should already pass through whatever args `submit` is called with. With Task 10 + this task, the call chain (dispatcher → handlers.submitReview → deps.submit → runSubmit) carries `verdict` + `summary` end-to-end. Spot-check the wiring file (likely `extension.ts`) and confirm no lambda there strips the new fields. If it does, update.

- [ ] **Step 3: Typecheck**

Run: `npm --workspace @plan-review/vscode-extension run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add packages/vscode-extension/src/submit/index.ts packages/vscode-extension/src/extension.ts
git commit -m "feat(vscode): runSubmit takes verdict + summary"
```

---

## Task 12: Update VS Code unit tests for new submission shape

**Files:**
- Modify: `packages/vscode-extension/test/unit/messageDispatch.test.ts`
- Modify: `packages/vscode-extension/test/unit/submit.fanOut.test.ts`

- [ ] **Step 1: Inspect both test files for submit-related cases**

Run: `grep -n "submitReview\|verdict\|summary\|params:" packages/vscode-extension/test/unit/messageDispatch.test.ts packages/vscode-extension/test/unit/submit.fanOut.test.ts`

- [ ] **Step 2: Update `messageDispatch.test.ts`**

Find any line that dispatches `submitReview` like:

```ts
{ id: 'r4', kind: 'req', method: 'submitReview', params: { comments: [] } }
```

Update params to:

```ts
{ id: 'r4', kind: 'req', method: 'submitReview', params: { comments: [], verdict: null, summary: '' } }
```

Find any assertion on `handlers.submitReview` call args like:

```ts
expect(h.submitReview).toHaveBeenCalledWith({
  planFsPath: '/path/to/plan.md',
  document: fakeDoc,
  comments: [],
});
```

Update to include `verdict` and `summary`:

```ts
expect(h.submitReview).toHaveBeenCalledWith({
  planFsPath: '/path/to/plan.md',
  document: fakeDoc,
  comments: [],
  verdict: null,
  summary: '',
});
```

Add at least one new test case that passes `verdict: 'approved'` and `summary: 'X'` and asserts they propagate end-to-end.

- [ ] **Step 3: Update `submit.fanOut.test.ts`**

Any direct invocation of `runSubmit({ planFsPath, document, comments })` becomes `runSubmit({ planFsPath, document, comments, verdict: null, summary: '' })`. The fan-out behavior is independent of verdict — existing assertions should still pass.

Add one new test that asserts the formatted review string contains `**Verdict:** Approved` when `verdict: 'approved'` is passed.

```ts
it('passes verdict + summary into formatReview output', async () => {
  // existing setup, then:
  await runSubmit({
    planFsPath: '/p.md',
    document: doc,
    comments: [],
    verdict: 'approved',
    summary: 'LGTM',
  });
  // assert one of the captured submit destinations received a string
  // containing "**Verdict:** Approved" and "## Overall Comments"
});
```

(Adjust to whatever capture mechanism the existing fan-out test uses — clipboard mock, file mock, etc.)

- [ ] **Step 4: Run vscode-extension unit tests**

Run: `npm --workspace @plan-review/vscode-extension test`
Expected: passes.

- [ ] **Step 5: Run vscode-extension typecheck**

Run: `npm --workspace @plan-review/vscode-extension run typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add packages/vscode-extension/test/unit/messageDispatch.test.ts packages/vscode-extension/test/unit/submit.fanOut.test.ts
git commit -m "test(vscode): submit dispatch + fan-out cover verdict + summary"
```

---

## Task 13: Full-monorepo verification

**Files:** none

- [ ] **Step 1: Run all tests**

Run: `npm test -ws --if-present`
Expected: all packages pass.

- [ ] **Step 2: Run all typechecks**

Run: `npm run typecheck`
Expected: all packages pass.

- [ ] **Step 3: Build everything**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4 (manual smoke — only if running locally with a UI):**

Skip in subagent runs. If executing inline locally:

```bash
# from a checked-in markdown plan
node packages/cli/dist/index.js path/to/plan.md
```

Verify in the browser:
- Click `Submit Review ▾` — popover opens with `Approve` selected by default and an empty summary textarea.
- With `Approve` selected: inner Submit is enabled.
- Switch to `Comment` with empty summary and zero comments: inner Submit is disabled.
- Type into summary: enables.
- Press `Esc`: popover closes.
- Click outside: popover closes.
- Submit Approve with empty summary: review markdown contains `**Verdict:** Approved`, no `## Overall Comments` block.
- Submit Comment with summary "Need refactor": markdown contains `**Verdict:** Comment` and `## Overall Comments\n\nNeed refactor`.

If you're running as a subagent, omit this step and report the manual smoke is pending user verification.

- [ ] **Step 5: Final commit (if any leftover changes)**

If steps above produced no diff, skip. Otherwise:

```bash
git add -p
git commit -m "chore: tidy up after PR-style submit"
```

---

## Out of Scope

- Persisting verdict / summary across reload (transient by design — see spec).
- Keyboard shortcut for submit (e.g. Cmd+Enter inside popover).
- Showing the verdict on the post-submit "Review submitted" confirmation screen.
- Adding a "Request changes" verdict.
- Adding verdict + summary collection to CLI (TTY) interactive mode — current plan defaults to `{ verdict: null, summary: '' }` for that branch.
