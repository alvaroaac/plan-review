# PR-Style Submit (Verdict + Summary)

**Status:** Approved (design)
**Date:** 2026-04-29
**Branch:** `feat/ask-before-submit`

## Goal

Replace the single "Submit Review" button with a GitHub PR-review-style flow: the reviewer chooses a verdict (Approve or Comment-only) and may include an overall summary text, in addition to the existing per-section/inline comments.

## Motivation

Today's flow forces reviewers to leave at least one inline comment to submit anything, and emits no top-level verdict. Reviewers approving a clean plan must invent filler. Reviewers wanting to leave a holistic note (without anchoring to a specific section) have nowhere to put it.

## Verdict semantics

```ts
type ReviewVerdict = 'approved' | null;
```

- `'approved'` — reviewer endorses the plan. Allowed with zero comments and empty summary.
- `null` — "Comment" path. No endorsement, just feedback. Requires either a non-empty summary OR at least one inline comment.

There is no "Request changes" verdict. A reviewer who wants changes leaves comments with `verdict = null`.

## UX

### Header split-button

Top-bar single button is replaced by a split-button + popover, anchored under the button.

```
[ Submit Review ▾ ]
```

Click opens a popover:

```
○ Approve
○ Comment

[ Summary textarea — placeholder: "Leave a summary…" ]

[ Cancel ]   [ Submit ]
```

- Radio defaults to `Approve`.
- Popover closes on click-outside or `Esc`.
- After successful submit, App flips `submitted = true` (existing path); popover unmounts with the rest of the page.

### Popover Submit-button gating

| Verdict      | Summary           | Inline comments | Submit enabled |
|--------------|-------------------|-----------------|----------------|
| `approved`   | any               | any             | ✅ always       |
| `null` (Comment) | non-empty     | any             | ✅              |
| `null` (Comment) | empty         | ≥1              | ✅              |
| `null` (Comment) | empty         | 0               | ❌              |

The outer split-button itself is enabled whenever the document is loaded (not gated on comment count, unlike today).

### Persistence

Verdict and summary are **transient popover state**. They are NOT persisted to the session autosave. If the user closes the tab mid-popover, the typed summary is discarded; comments are persisted as today. Rationale: the autosave debounces on comment edits; verdict + summary are part of the submit action, and once submitted the server shuts down — there's no reload-while-submitting case worth preserving.

## Architecture

### New types — `@plan-review/core`

```ts
export type ReviewVerdict = 'approved' | null;

export interface ReviewSubmission {
  comments: ReviewComment[];
  verdict: ReviewVerdict;
  summary: string; // empty string allowed for verdict='approved'
}
```

`PlanDocument` and `ReviewComment` are unchanged. Verdict + summary live only at submit time.

### `ReviewClient` signature change

```ts
// before
submitReview(comments: ReviewComment[]): Promise<void>;

// after
submitReview(submission: ReviewSubmission): Promise<void>;
```

Both implementations updated:
- `HttpReviewClient` (browser-app, used by CLI) — POSTs the submission as JSON to `/api/review`.
- `PostMessageReviewClient` (used by VS Code webview) — sends `submitReview` request with the submission as `params`.

### Webview protocol — `packages/vscode-extension/src/protocol.ts`

`WebviewRequest` for `method: 'submitReview'` carries `params: ReviewSubmission` (was `params: ReviewComment[]`). Type guards updated accordingly.

### CLI HTTP server — `packages/cli/src/server/routes.ts`

The `POST /api/review` handler (currently parses `{ comments }`) is updated to parse `{ comments, verdict, summary }` and call `formatReview(doc, { verdict, summary })`. Old shape `{ comments }` is no longer accepted; this is a coordinated rev across the monorepo (no external API consumers). Validation: `verdict` must be `'approved'` or `null`, `summary` must be a string.

### `runSubmit` — `packages/vscode-extension/src/submit/index.ts`

Signature gains `verdict` and `summary`:

```ts
runSubmit({
  planFsPath,
  document,
  comments,
  verdict,
  summary,
}): Promise<{ submitted: boolean }>
```

The function passes `(document, { verdict, summary })` to `formatReview` — comments stay attached to the doc as today via `docWithComments`, verdict + summary go through the opts arg.

### Formatter — `packages/core/src/formatter.ts`

```ts
export function formatReview(
  doc: PlanDocument,
  opts: { verdict: ReviewVerdict; summary: string }
): string;
```

Emits the same template, with two additions inside the existing structure:

```md
# Plan Review: <title>

## Review Summary
- **Verdict:** Approved | Comment
- **Sections reviewed:** N/M
- **Comments:** N
- **Skipped:** N sections without comments

## Overall Comments

<escaped summary>

---

## Section <id>: …
…
```

- Verdict label: `'approved' → "Approved"`, `null → "Comment"`.
- `## Overall Comments` block is omitted entirely when `summary.trim() === ''`.
- Per-section blocks unchanged. Approve + zero comments produces the same template with no per-section blocks (a short but valid markdown doc).

### New UI component — `packages/browser-app/src/SubmitReviewPanel.tsx`

```ts
interface Props {
  commentCount: number;
  disabled?: boolean; // when doc not loaded
  onSubmit: (verdict: ReviewVerdict, summary: string) => Promise<void>;
}
```

Internal state: `open`, `verdict`, `summary`. Owns the split-button, the popover, click-outside / `Esc` handling, and the submit-gating table above. Calls `onSubmit` on confirm; the parent (`App.tsx`) wraps that to update its own `submitted` state.

CSS lives in [styles.css](packages/browser-app/src/styles.css). Popover is absolute-positioned within the header, no portal.

### `App.tsx` changes

- Replace the single `<button class="submit-btn">` at line 192 with `<SubmitReviewPanel commentCount={comments.length} disabled={!doc} onSubmit={…}>`.
- `submitReview` becomes `submitReview(verdict, summary)` and calls `client.submitReview({ comments, verdict, summary })`.
- The on-screen comment count next to the button stays.

## Files touched

```
packages/core/src/types.ts                       # add ReviewVerdict, ReviewSubmission (export)
packages/core/src/formatter.ts                   # signature change + verdict/summary rendering
packages/core/src/reviewClient.ts                # submitReview(submission)
packages/core/src/index.ts                       # re-exports
packages/browser-app/src/httpClient.ts           # HttpReviewClient.submitReview body
packages/browser-app/src/App.tsx                 # use new component, plumb verdict/summary
packages/browser-app/src/SubmitReviewPanel.tsx   # NEW
packages/browser-app/src/styles.css              # popover styles
packages/vscode-extension/src/protocol.ts        # request param type
packages/vscode-extension/src/messageHandlers.ts # unpack submission, forward
packages/vscode-extension/src/submit/index.ts    # runSubmit signature + formatReview opts
packages/cli/src/server/routes.ts                # /api/review handler body shape
```

## Tests

- **Update:** `packages/vscode-extension/test/unit/messageDispatch.test.ts` and `submit.fanOut.test.ts` (already in-flight on this branch) for the new submission shape.
- **New:** `packages/core` formatter test — verdict line + Overall Comments block emitted/omitted correctly across the matrix (approved/empty, approved/with-summary, comment/with-summary, comment/with-comments only).
- **New:** `SubmitReviewPanel` component test exercising the gating table.

## Out of scope

- Persisting verdict / summary across reload (transient by design).
- Keyboard shortcut for submit (e.g. Cmd+Enter).
- Showing the verdict on the post-submit confirmation screen.
- Adding "Request changes" — explicitly excluded.

## Open questions

None as of design approval.
