# Plan Review v2 Implementation Plan

**Goal:** Ship decision/assumption items, deferrals, threaded comments and persisted multi-round reviews across core, CLI, VS Code and the browser app, per the v2 spec.

**Architecture:** Core owns everything host-agnostic: item extraction from fenced blocks, the `Review` model, a `ReviewStore` (JSON files), round opening + carry-forward, and output formatting. Hosts (CLI HTTP server, VS Code extension) call one core entry point (`openReview`) and persist whatever the UI sends back. The browser app is rewritten around a reducer + context, porting the design's rail + stepper layout. Block splitting is DOM-free and lives in core (`packages/core/src/lineBlocks.ts`), shared with the browser, so carry-forward (`rounds.ts`) re-anchors threads to exact lines on the server, updating `sectionId`/`startLine`/`endLine`/`lineTexts` or marking them outdated.

**Tech Stack:** TypeScript strict ESM, Preact 10, esbuild, marked (already a core dependency), Vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-15-plan-review-v2-design.md`

## Global Constraints

- Spec section numbers (§1–§6) are binding; type names and fields in spec §2 are contractual and must match exactly.
- No new runtime or dev dependencies in any package.
- Browser-safe modules (`types`, `reviewModel`, `items`, `rounds`, `formatter`, `autosave`, `reviewClient`) must not import `node:*`. Only `reviewStore.ts` and `session.ts` may.
- No network fonts, no CDN assets in the browser bundle (VS Code CSP, offline CLI).
- All persisted timestamps are ISO strings; all "now" values are injected (`now: Date` param) in core so tests are deterministic.
- Never delete files under `~/.plan-review/`; corrupt reviews are skipped, not removed.
- `packages/react` is untouched.
- Hand-written validators for every untrusted payload (HTTP body, postMessage, JSON file); no Zod (not a repo dependency).
- Between Task 1 and Task 15, `browser-app` and `vscode-extension` typecheck may be red; each task's Verify names the scope that must be green. Whole-repo `npm run typecheck && npm test` must be green at the end of Task 9 (excluding browser-app) and at the end of Task 16 (everything).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TDD: each task's **Behavior** bullets are its test list — write failing tests from them first, then implement. Commit per task.

## File Map

| File | Responsibility |
|---|---|
| `docs/superpowers/specs/assets/plan-review-v2/*` | Vendored design files (reference, not shipped) |
| `packages/core/src/types.ts` | + v2 types from spec §2 |
| `packages/core/src/reviewModel.ts` (new) | Browser-safe helpers: `hashItem`, `itemState`, `itemCounts`, `newReviewId`, `newThreadId`, `newCommentId` |
| `packages/core/src/items.ts` (new) | Fenced-block extraction → items, replies, warnings, reply-stripped doc |
| `packages/core/src/reviewStore.ts` (new) | `ReviewStore`, `FileReviewStore`, `isReview` |
| `packages/core/src/rounds.ts` (new) | `openReview`, `carryForward`, `saveProgress`, `submitRound`, errors |
| `packages/core/src/formatter.ts` | + `formatReviewOutput`, `formatPausedNotice`; legacy `formatReview` removed in Task 16 |
| `packages/core/src/reviewClient.ts` | v2 `ReviewClient` + `FakeReviewClient` |
| `packages/core/src/index.ts`, `package.json` | exports + subpaths `./review`, `./items`, `./client` |
| `packages/cli/src/server/routes.ts`, `transport.ts` | v2 HTTP API + validators |
| `packages/cli/src/browser-review.ts`, `index.ts` | review resolution, rounds, paused outcome, `--review`, `list` |
| `packages/cli/src/renderer.ts`, `navigator.ts` | terminal-mode degradation |
| `packages/vscode-extension/src/{protocol,messageHandlers,postMessageClient,extension,webviewPanelManager}.ts`, `submit/*` | VS Code v2 |
| `packages/browser-app/src/state/*` (new) | reducer, `ReviewContext`, `useReview` |
| `packages/browser-app/src/components/*` (new) | TopBar, Stepper, TocPanel, DocView, SectionView, Rail, ItemCard, ThreadCard, Composer, SubmitPopover, Toast |
| `packages/browser-app/src/{App,index,httpClient,lineRenderer}.tsx?` | rewired; old components deleted in Task 14 |
| `packages/browser-app/src/styles.css` | rewritten from `simple.css` + retained renderer styles |
| `examples/demo-plan.md`, `skills/plan-review/SKILL.md` | agent contract |
| `tests/e2e/*.spec.ts`, `tests/visual/renderer.spec.ts` | Playwright |

---

## Phase 0 — Reference

### Task 0: Vendor design files

**Files:**
- Create: `docs/superpowers/specs/assets/plan-review-v2/{Plan Review Simple.html,simple_app.jsx,simple_parts.jsx,simple_data.jsx,simple.css}`

**Behavior:**
- Files are byte-identical copies of the design project `a3b1d2c8-5dbd-417b-8f9d-01e15f950ffe`, pulled via DesignSync.

**Verify:**
- Run: `ls docs/superpowers/specs/assets/plan-review-v2`
- Expected: 5 files present; committed.

---

## Phase 1 — Core

### Task 1: v2 types, review model helpers, ReviewClient v2

**Files:**
- Modify: `packages/core/src/types.ts`, `packages/core/src/reviewClient.ts`, `packages/core/src/index.ts`, `packages/core/package.json`
- Create: `packages/core/src/reviewModel.ts`
- Test: `packages/core/tests/reviewModel.test.ts`, `packages/core/tests/reviewClient.test.ts`, `packages/core/tests/public-api.test.ts`

**Interfaces:**
- Produces (types.ts): exactly the spec §2 types `ItemKind`, `ReviewItem`, `AssumptionVerdict`, `Answer`, `ThreadComment`, `Thread`, `Round`, `Review`, plus:
  ```ts
  type ItemState = 'open' | 'done' | 'deferred' | 'changed';
  type Banner = 'planChangedWhilePaused' | 'planUnchanged';
  type SubmitVerdict = 'changes_requested' | 'approved';
  interface ReviewView { id: string; round: number; status: Review['status']; answers: Record<string, Answer>; threads: Thread[]; banner?: Banner }
  interface LoadedReview { document: PlanDocument; items: ReviewItem[]; warnings: string[]; review: ReviewView }
  interface ProgressUpdate { answers: Record<string, Answer>; threads: Thread[] }
  interface SubmitRequest { verdict: SubmitVerdict; summary: string }
  ```
- Produces (reviewModel.ts):
  `hashItem(item: Pick<ReviewItem,'kind'|'question'|'options'>): string`,
  `itemState(item: ReviewItem, answer: Answer | undefined): ItemState`,
  `itemCounts(items: ReviewItem[], answers: Record<string, Answer>): { decisions: {answered: number; deferred: number; open: number}; assumptions: {holds: number; unsure: number; no: number; deferred: number; open: number} }`,
  `newReviewId(): string`, `newThreadId(): string`, `newCommentId(): string`,
  `contentHash(markdown: string): string` (browser-safe FNV-1a hex; `session.ts` keeps its own sha256 `computeContentHash`).
- Produces (reviewClient.ts):
  ```ts
  interface ReviewClient {
    loadDocument(): Promise<LoadedReview>;
    saveProgress(update: ProgressUpdate): Promise<void>;
    submitReview(req: SubmitRequest): Promise<{ ok: true; output: string }>;
  }
  ```
  `FakeReviewClient(opts: { loaded: LoadedReview })` records `progressSaves: ProgressUpdate[]` and `submits: SubmitRequest[]`, returns `output: ''`. Old `SessionState` type removed.
- Produces (package.json exports): `./review` → reviewModel, `./client` → reviewClient (types + Fake), alongside existing `./formatter`, `./autosave`. `./items` added in Task 2.

**Behavior:**
- `hashItem` is FNV-1a 32-bit over `JSON.stringify([kind, question, options?.map(o => [o.key, o.text, o.detail ?? ''])])`, returned as 8-char lowercase hex. `pick`, `label`, `context`, `quote` do NOT affect the hash (changing the author's pick or wording of context must not reopen an answered item).
- Hash changes when question text changes, when an option is added/removed, or an option's text/detail changes.
- `itemState`: no answer → `open`; `answer.itemHash !== item.hash` → `changed` (takes precedence over deferred); `choice === 'deferred'` → `deferred`; else `done`.
- `itemCounts` counts `changed` as open; ignores answers whose item id is not in `items`.
- `newReviewId()` matches `/^rv_[0-9a-z]{8}$/`; `newThreadId()` matches `/^t_[0-9a-z]{6}$/`; `newCommentId()` matches `/^c_[0-9a-z]{8}$/`; use `crypto.getRandomValues` (global in Node 22 and browsers).
- `reviewModel.ts` imports nothing from `node:*` (assert in public-api test by reading the built file or source).
- `FakeReviewClient` round-trip: `loadDocument` returns `opts.loaded`; save/submit calls are recorded in order.

**Verify:**
- Run: `npm test -w @plan-review/core && npm run typecheck -w @plan-review/core`
- Expected: green.

### Task 2: Item block extraction

**Files:**
- Create: `packages/core/src/items.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json` (`./items` subpath)
- Test: `packages/core/tests/items.test.ts`

**Interfaces:**
- Consumes: `ReviewItem`, `hashItem` (Task 1), `PlanDocument`/`Section`.
- Produces:
  ```ts
  interface AgentReply { threadId: string; body: string; sectionId: string }
  interface ExtractResult { doc: PlanDocument; items: ReviewItem[]; replies: AgentReply[]; warnings: string[] }
  function extractItems(doc: PlanDocument): ExtractResult;
  const ITEM_FENCE_RE: RegExp; // matches info strings `decision id=…` / `assumption id=…`; used by browser lineRenderer
  ```

**Behavior:**
- Uses the marked lexer on each section body; only **top-level** `code` tokens whose info string's first word is exactly `decision`, `assumption` or `reply` are considered; other fences untouched.
- Valid decision: `id` matches `^[a-z0-9-]+$`, `question` present, ≥ 2 option lines `- X: text | detail [pick]` with X a single uppercase letter, unique keys, ≤ 1 `[pick]`. `| detail` optional; `[pick]` is stripped from text/detail; values trimmed.
- Valid assumption: `id` valid, `statement` present (stored in `question`). Option lines in an assumption → warning, ignored.
- `label` absent → humanized id (`retry-backoff` → `Retry backoff`).
- Each item gets `sectionId` of its section and `hash = hashItem(...)`; `items` are in document order across sections.
- Malformed block (each case gets its own test: missing id, bad id chars, missing question, missing statement, < 2 options, duplicate key, > 1 pick, lowercase/multi-letter key, duplicate id across the plan) → not an item; body left as an ordinary code block; one warning string naming the block id (or `line N` when no id) and the reason. Never throws.
- Duplicate id: the first occurrence wins, later ones are malformed.
- Unknown `key: value` field → warning, block still valid.
- `reply thread=<id>` blocks: removed from the returned `doc` section bodies (byte-exact removal of `token.raw`), returned in `replies` with trimmed multi-line body. Missing `thread=` → warning, block removed anyway.
- Item fences stay in section bodies (the browser renders them as markers).
- Input `doc` is not mutated.

**Verify:**
- Run: `npm test -w @plan-review/core`
- Expected: green, including one test per malformed case.

### Task 3: FileReviewStore

**Files:**
- Create: `packages/core/src/reviewStore.ts`
- Modify: `packages/core/src/index.ts` (node entry only)
- Test: `packages/core/tests/reviewStore.test.ts`

**Interfaces:**
- Consumes: `Review` (Task 1).
- Produces: `interface ReviewStore` exactly as spec §2; `class FileReviewStore implements ReviewStore { constructor(opts?: { dir?: string }) }`; `const DEFAULT_REVIEW_DIR = ~/.plan-review/reviews`; `function isReview(x: unknown): x is Review`.

**Behavior:**
- `save` writes `<dir>/<id>.json` via write-to-`<id>.json.tmp-<random>` then `rename`; creates `dir` recursively; pretty-printed JSON.
- `get` of missing id → `null`; of a file that fails JSON.parse or `isReview` → `null` and the file still exists afterwards.
- `get` rejects ids not matching `^rv_[0-9a-z]+$` (returns `null`, never touches paths outside `dir`).
- `isReview` checks `version === 2`, id/title strings, status enum, `answers` object, `threads` array, `rounds` non-empty array with numeric `n` and string `plan`/`contentHash`.
- `list()` returns all valid reviews sorted by `updatedAt` desc, skipping corrupt files and non-`.json` files; `list({status:'open'})` filters.
- `findOpenByPlanPath(p)` returns the most recently updated `open` review with `planPath === p`, else `null`.
- Round-trip: `save` then `get` deep-equals the input.

**Verify:**
- Run: `npm test -w @plan-review/core`
- Expected: green (tests use a temp dir).

### Task 4: Rounds, carry-forward, openReview

**Files:**
- Create: `packages/core/src/rounds.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/rounds.test.ts`

**Interfaces:**
- Consumes: `extractItems`, `ExtractResult`, `AgentReply` (Task 2); `ReviewStore` (Task 3); `parse` (existing parser); `contentHash` (Task 1).
- Produces:
  ```ts
  interface OpenReviewInput { markdown: string; planPath?: string; reviewId?: string; fresh?: boolean; splitBy?: SplitStrategy; now: Date }
  interface OpenedReview { review: Review; loaded: LoadedReview }
  class ReviewNotFoundError extends Error {}   // message: `Review <id> not found`
  class ReviewApprovedError extends Error {}   // message: `Review <id> is approved; run without --review to start a new review`
  function openReview(store: ReviewStore, input: OpenReviewInput): Promise<OpenedReview>;
  function carryForward(review: Review, extract: ExtractResult): Review; // pure
  function saveProgress(store: ReviewStore, reviewId: string, update: ProgressUpdate, now: Date): Promise<Review>;
  function submitRound(store: ReviewStore, reviewId: string, req: SubmitRequest, now: Date): Promise<Review>;
  ```

**Behavior:**
- Resolution: `reviewId` given → `get`; null → `ReviewNotFoundError`; approved → `ReviewApprovedError`. No `reviewId` + `planPath` + not `fresh` → `findOpenByPlanPath` else create. No `planPath` or `fresh` → create. Created review: `newReviewId()`, title from parsed doc, `planPath` as given (caller passes absolute), empty answers/threads/rounds.
- Round opening: last round unsubmitted + same `contentHash` → no change, no banner. Last round unsubmitted + different hash → replace its `plan`/`contentHash`, run `carryForward`, banner `planChangedWhilePaused`. No rounds or last submitted → append round `n+1` with `startedAt = now`; banner `planUnchanged` when hash equals the previous round's.
- The review is saved once by `openReview` (with `updatedAt = now`) before returning.
- `loaded.document` is the reply-stripped doc; `loaded.items` are current items; `loaded.review.answers` contains only answers whose item id is in current items (hidden ones stay in the stored review); `loaded.review.round` is the active round's `n`.
- `carryForward` answers: stored answers are never deleted or modified (state `changed` is derived later by hash).
- `carryForward` threads (skip resolved ones): thread with `anchor` → normalize each `lineTexts` entry and the candidate section body to lowercase alphanumerics only; if the concatenated normalized anchor text is a substring of the normalized body of the section whose heading equals the old section's heading → keep that section, `outdated=false`; else first section in document order where it matches → move `sectionId`, `outdated=false`; else `outdated=true`. On a match, `startLine/endLine/lineTexts` are updated from the core line-block splitter (`lineBlocks.ts`). Thread with `anchor: null` → `outdated=true` only if no section with the old heading exists, else `sectionId` updated to that section. Old heading is looked up in the previous round's plan (re-parse with same `splitBy`).
- `carryForward` replies: for each `AgentReply`, append `{ id: newCommentId(), author: 'agent', body, createdAt: now }` to the thread with that id unless an agent comment with identical trimmed body exists; unknown thread id → warning appended to `loaded.warnings` (`Reply to unknown thread <id> ignored`). A reply to a resolved thread reopens it (`resolved=false`).
- `saveProgress`: replaces `answers` and `threads` wholesale, sets `updatedAt`; throws `ReviewApprovedError` if status approved; review must exist (`ReviewNotFoundError`).
- `submitRound`: sets active round `submittedAt`, `verdict`, `summary`; `approved` sets `status='approved'`; submitting when the last round is already submitted throws `Error('Round already submitted')`.
- All functions take `now` explicitly; tests use fixed dates.

**Verify:**
- Run: `npm test -w @plan-review/core && npm run typecheck -w @plan-review/core`
- Expected: green; tests cover resolution matrix (id unknown/approved/open × path/stdin × fresh), all three round-open cases, re-anchor same-section / moved / outdated / heading-gone, reply append / dedupe / unknown / reopen.

### Task 5: Formatter v2

**Files:**
- Modify: `packages/core/src/formatter.ts`
- Test: `packages/core/tests/formatter.test.ts` (new snapshot cases; legacy tests stay until Task 16)

**Interfaces:**
- Consumes: `Review`, `ReviewItem`, `itemState`, `itemCounts` (Task 1).
- Produces:
  `formatReviewOutput(review: Review, items: ReviewItem[], doc: PlanDocument): string` (doc gives section headings for thread locations; uses the review's last round),
  `formatPausedNotice(review: Review, items: ReviewItem[]): string`.

**Behavior:**
- Output follows spec §4 template exactly (headings, ordering, `·` separators, footer wording); sections with nothing to list are omitted.
- Header line: `` Review `<id>` · Round <n> · **Changes requested** `` or `**Approved**`.
- Decision lines: `` ### `<id>` · <label> — **<KEY>**: <option text> `` + ` (your pick was <PICK>)` only when an author pick exists and differs; `other` → `**Other**`; deferred → `**Deferred**`; no answer → `*Unanswered*`; `changed` → `*Unanswered* (plan changed since your answer)`. Non-empty note rendered as `> note` (multi-line notes: each line prefixed).
- Assumption labels: `Holds`, `Not sure`, `Doesn't hold`, `Deferred`, `*Unanswered*`.
- Open threads: unresolved, non-outdated, with location `§ <section heading>`, anchor text as `> ` quote (joined lineTexts) when anchored, then `- **Reviewer:** …` / `- **Agent:** …`. Outdated threads under `## Outdated threads` with their last anchor text.
- Summary bullets: decision and assumption counts from `itemCounts`; thread line `N open (M new this round), K resolved` where new = `createdRound === current round`. Bullets omitted when zero items / zero threads.
- Footer changes-requested: spec §4 **Next** paragraph with the review id. Approved: `Approved. N deferred items remain open — track them during implementation.` (sentence omitted when N=0, replaced by `Approved.`).
- `formatPausedNotice`: exactly spec §4 paused text; "x/y items answered" counts `done` + `deferred` as answered over current items.
- Snapshot tests: changes-requested with all item states, approved-with-deferred, paused, no-items-no-threads.
- Pure; browser-safe.

**Verify:**
- Run: `npm test -w @plan-review/core`
- Expected: green.

**Phase 1 gate:** Fable 5.1 review of core diff + `codex-review` (Astra) cross-check; fix findings before Phase 2.

---

## Phase 2 — Hosts

### Task 6: CLI HTTP API v2

**Files:**
- Modify: `packages/cli/src/server/routes.ts`, `packages/cli/src/transport.ts`, `packages/cli/src/server/server.ts` (if wiring changes)
- Test: `packages/cli/tests/server/routes.test.ts`, `packages/cli/tests/transport.test.ts`

**Interfaces:**
- Consumes: `LoadedReview`, `ProgressUpdate`, `SubmitRequest` (Task 1).
- Produces: `RouteContext` becomes `{ getLoaded(): LoadedReview; getAssetHtml; getAssetBaseDir?; onProgress(u: ProgressUpdate): Promise<void>; onSubmit(r: SubmitRequest): Promise<string> /* returns formatted output */; onHeartbeat?; onPause?; onCancel? }`. `HttpTransport` gains `setLoaded(l: LoadedReview)`, `onProgress(h)`, `onSubmit(h)`; `sendDocument`, `setInitialActiveSection`, `onSessionSave`, `onReviewSubmit` removed. Exported validators `isProgressUpdate(x): x is ProgressUpdate`, `isSubmitRequest(x): x is SubmitRequest`.

**Behavior:**
- `GET /api/doc` → 200 `LoadedReview` JSON.
- `PUT /api/session` with valid body → handler called, 204; invalid shape → 400 `{error}`; handler throws `ReviewApprovedError` → 409.
- `isProgressUpdate` rejects: non-object answers; answer missing `choice`/`note`/`itemHash`/`round`/`updatedAt` or wrong types; thread missing id/sectionId/resolved/outdated/createdRound/comments; comment author not `reviewer|agent`; anchor neither null nor valid `LineAnchor`.
- `POST /api/review` with `verdict` not in `changes_requested|approved` or non-string summary → 400; valid → 200 `{ ok: true, output }`.
- Body > 1 MB → 413 (existing behaviour kept for both routes).
- Heartbeat / pause / cancel / `_assets` routes unchanged.

**Verify:**
- Run: `npm test -w plan-review -- server transport`
- Expected: green.

### Task 7: CLI review flow, rounds, paused, list

**Files:**
- Modify: `packages/cli/src/browser-review.ts`, `packages/cli/src/index.ts`, `packages/cli/src/output.ts` (only if output plumbing needs it)
- Test: `packages/cli/tests/index.test.ts`, `packages/cli/tests/browser-integration.test.ts`, new `packages/cli/tests/list.test.ts`

**Interfaces:**
- Consumes: `openReview`, `saveProgress`, `submitRound`, `ReviewNotFoundError`, `ReviewApprovedError` (Task 4); `FileReviewStore` (Task 3); `formatReviewOutput`, `formatPausedNotice` (Task 5); `HttpTransport` v2 (Task 6).
- Produces: `browserReview(opts): Promise<{ kind: 'submitted' | 'paused'; output: string }>`; CLI option `--review <id>`; command `plan-review list [--all]`; store dir overridable via env `PLAN_REVIEW_HOME` (default `~/.plan-review`) so tests and e2e never touch the real home.

**Behavior:**
- `plan-review plan.md` → `openReview` with absolute `planPath`; `-` / stdin → no planPath. `--fresh` → `fresh: true` (new review even if one is open for the path). `--review` + unknown/approved id → stderr message from the error, exit 1, no server started.
- Submit → `submitRound`, output = `formatReviewOutput`, written via existing `-o` targets, exit 0.
- Cancel route, tab closed (heartbeat lost) or idle ceiling → output = `formatPausedNotice` to stdout (regardless of `-o`), exit 0. "Review cancelled" error path removed.
- Progress saves go through `saveProgress` (server owns persistence); autosave failures are logged to stderr, not fatal.
- `plan-review list` prints a table `ID  TITLE  ROUND  UPDATED  ANSWERED/DEFERRED/OPEN` for open reviews, newest first; `--all` includes approved with a STATUS column; empty → `No open reviews.`. Counts use the last round's plan items.
- `plan-review sessions` becomes an alias of `list` (v1 sessions are no longer read).
- Old `FileSessionStore` usage removed from the CLI.

**Verify:**
- Run: `npm test -w plan-review && npm run typecheck -w plan-review`
- Expected: green.

### Task 8: Terminal mode degradation

**Files:**
- Modify: `packages/cli/src/renderer.ts`, `packages/cli/src/navigator.ts`, `packages/cli/src/index.ts` (terminal branch)
- Test: `packages/cli/tests/renderer.test.ts`, `packages/cli/tests/navigator.test.ts`

**Interfaces:**
- Consumes: `extractItems`, `ITEM_FENCE_RE` (Task 2); `openReview`, `submitRound`, `saveProgress` (Task 4); `formatReviewOutput` (Task 5).

**Behavior:**
- Valid item fences render as text: `◆ DECISION <label>` / `◇ ASSUMPTION <label>`, the question/statement, options as `  A. text — detail` with ` (author's pick)` suffix, context dimmed. Malformed fences render as code (unchanged).
- Terminal comments become threads: each comment → new `Thread { anchor: null (or LineAnchor if navigator has one), resolved: false, outdated: false, createdRound: current, comments: [{ author: 'reviewer', … }] }`, saved via `saveProgress` before `submitRound`.
- Terminal submit verdict maps: approve → `approved`, otherwise `changes_requested`.
- When current items have open/changed state, output gets an extra line before the footer: `<N> decisions/assumptions unanswered (answer them in browser mode)`.
- Review id and round appear in the output (via `formatReviewOutput`).

**Verify:**
- Run: `npm test -w plan-review`
- Expected: green.

### Task 9: VS Code v2

**Files:**
- Modify: `packages/vscode-extension/src/protocol.ts`, `messageHandlers.ts`, `postMessageClient.ts`, `extension.ts`, `webviewPanelManager.ts`, `submit/index.ts` (+ other `submit/*` only if signatures change)
- Test: `packages/vscode-extension/test/unit/*` (update existing; rename `messageHandlers.saveSession.test.ts` → `messageHandlers.saveProgress.test.ts`)

**Interfaces:**
- Consumes: `ReviewClient` v2, `LoadedReview`, `ProgressUpdate`, `SubmitRequest` (Task 1); `openReview`, `saveProgress`, `submitRound` (Task 4); `FileReviewStore` (Task 3); `formatReviewOutput` (Task 5).
- Produces: protocol methods `loadDocument | saveProgress | submitReview`; params `ProgressUpdate` / `SubmitRequest`; validators `isProgressUpdate`, `isSubmitRequest` (same rules as Task 6 — import them from a shared place only if both packages already share one; otherwise duplicate the ~30 lines, VS Code must not depend on the cli package). Event `planChanged` kept.

**Behavior:**
- Panel open → `openReview({ markdown, planPath: document.uri.fsPath, now })` with `FileReviewStore` default dir; the panel holds the review id for its lifetime.
- `planChanged` (file saved while panel open) → re-run `openReview` with the same review id and push the new `LoadedReview` to the webview.
- Opening a file whose only review is approved → new review (no error; `openReview` without id handles it).
- `saveProgress` / `submitReview` validated; invalid → error response, no store write.
- Submit → `submitRound` then fan-out (claudeCode, clipboard, file, outputChannel) receives `formatReviewOutput` text; response `{ ok: true, output }`.
- Panel disposed without submit → nothing extra (state already autosaved).

**Verify:**
- Run: `npm test -w plan-review-vscode && npm run typecheck -w plan-review-vscode`
- Expected: green. Then `npm run typecheck && npm test` across the repo green except `browser-app`.

**Phase 2 gate:** Fable 5.1 review of hosts diff + `codex-review` (Astra); fix findings.

---

## Phase 3 — UI (browser-app)

Visual source of truth: vendored `simple.css` / `simple_*.jsx` (Task 0). Copy strings in the design are used verbatim unless the spec overrides them.

### Task 10: Shell, theme, state, client

**Files:**
- Create: `packages/browser-app/src/state/reducer.ts`, `state/ReviewContext.tsx`, `components/TopBar.tsx`
- Modify: `packages/browser-app/src/App.tsx`, `index.tsx`, `httpClient.ts`, `styles.css`
- Test: `packages/browser-app/tests/reducer.test.ts`, `tests/httpClient.test.ts`, `tests/App.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `ReviewClient` v2, `LoadedReview`, `Answer`, `Thread`, `ReviewItem` (Task 1) via `@plan-review/core/client` and `/review`; `createAutosave` via `/autosave`.
- Produces: `ReviewState { doc; items; warnings; review: ReviewView; ui: { tab: 'decisions'|'comments'; filter: 'open'|'resolved'|'all'; focus: { kind: 'item'|'thread'; id: string } | null; composing: { sectionId: string; anchor: LineAnchor | null } | null; theme: 'light'|'dark'; submitOpen: boolean; submitted: { output: string } | null; submitError: string | null } }`; actions (discriminated union `type` field): `answer`, `defer`, `clearAnswer`, `startCompose`, `cancelCompose`, `addThread`, `reply`, `resolve`, `reopen`, `focus`, `setTab`, `setFilter`, `toggleTheme`, `openSubmit`, `closeSubmit`, `submitted`, `submitFailed`, `reload`. `useReview(): { state; dispatch }`.

**Behavior:**
- `answer` sets `{ choice, note, itemHash: item.hash, round: review.round, updatedAt }`; `defer` sets `choice: 'deferred'` with optional note; `clearAnswer` removes it.
- `addThread` creates `{ id: newThreadId(), createdRound: round, resolved:false, outdated:false, comments:[reviewer comment] }`; `reply` appends a reviewer comment; `resolve`/`reopen` toggle `resolved`.
- Every answers/threads change schedules autosave of `{ answers, threads }` (500 ms, flush on `beforeunload`); UI-only actions do not.
- Initial `tab` is `decisions` when items exist, else `comments`; Decisions tab and Stepper are not rendered when `items.length === 0`.
- Theme: initial from `localStorage['plan-review-theme']` (try/catch) else `prefers-color-scheme`; inside VS Code (`body.vscode-dark|vscode-light`) follow the body class and hide the toggle; applied as `data-theme` on `<html>`.
- `styles.css`: tokens from `simple.css` as CSS variables for light + dark; layout grid `232px | 1fr | 380px`, header 52px, breakpoints ≤1240 (200/340) and ≤1040 (52px TOC); font stacks from spec §5; existing renderer styles (mermaid, KaTeX, footnotes, admonitions, images) retained and readable in both themes.
- `HttpReviewClient` maps to `GET /api/doc`, `PUT /api/session`, `POST /api/review`; non-2xx → rejected promise with the server's `error` text.
- TopBar shows brand, plan title crumb, theme toggle, Submit review button (opens popover; popover itself is Task 14).

**Verify:**
- Run: `npm test -w @plan-review/browser-app && npm run typecheck -w @plan-review/browser-app`
- Expected: green for the files touched in this task (other component tests may be deleted/rewritten here if they import removed APIs).

### Task 11: TOC, Stepper, document view with highlights

**Files:**
- Create: `components/TocPanel.tsx`, `components/Stepper.tsx`, `components/DocView.tsx`, `components/SectionView.tsx` (replaces old), `anchors.ts`
- Modify: `packages/browser-app/src/lineRenderer.ts`, `LineBlock.tsx`
- Test: `tests/TocPanel.test.tsx`, `tests/Stepper.test.tsx`, `tests/SectionView.test.tsx`, `tests/lineRenderer.test.ts`, `tests/anchors.test.ts`

**Interfaces:**
- Consumes: `ITEM_FENCE_RE` (Task 2), `itemState` (Task 1), `useReview` (Task 10).
- Produces: `LineBlock` gains optional `itemId?: string`; `renderToLineBlocks(markdown, itemIds: Set<string>)`; `resolveAnchor(blocks: LineBlock[], anchor: LineAnchor): { start: number; end: number } | null` in `anchors.ts`.

**Behavior:**
- `renderToLineBlocks` turns a top-level fence matching `ITEM_FENCE_RE` whose id is in `itemIds` into a block with `itemId` set and no code HTML; other fences render as code.
- Quote highlight: for each item with `quote`, find the nearest preceding paragraph block in the same section whose text contains the quote (case-sensitive); wrap the first occurrence in a highlight with state badge (`?` open, `A`/key for decisions done, `✓` holds, `–` deferred, per design); the item's marker block is then hidden. No match / no quote → marker chip rendered at the item block position.
- Clicking a highlight or chip dispatches `focus` item and switches to the Decisions tab.
- Thread highlights: `resolveAnchor` finds the first run of consecutive blocks whose `text` equals `anchor.lineTexts` in order; falls back to the stored `startLine..endLine` if those indices exist and the run is not found; returns `null` otherwise. Anchored, unresolved, non-outdated threads get the amber highlight; clicking focuses the thread (Comments tab).
- Hover `+` on a block starts composing on that block; shift-click extends the range (existing behaviour kept).
- DocView header: kicker `Plan · Round N`, title, meta (updated time, review id), legend; banners for `planChangedWhilePaused`, `planUnchanged`, any `changed` items, and `warnings` (list).
- TOC: sections with item dots (coloured by kind/state) and open-thread count; plan mode groups tasks under milestones; scroll-spy marks active section; ≤1040 collapses to icon column.
- Stepper: one segment per item in doc order with classes for kind and state, focused outlined; text `N of M answered · K deferred`; Next jumps to the next open/changed item after the focused one (wraps).

**Verify:**
- Run: `npm test -w @plan-review/browser-app`
- Expected: green.

### Task 12: Rail + ItemCard (Decisions tab)

**Files:**
- Create: `components/Rail.tsx`, `components/ItemCard.tsx`
- Test: `tests/ItemCard.test.tsx`, `tests/Rail.test.tsx`

**Interfaces:**
- Consumes: `useReview`, actions `answer`/`defer`/`clearAnswer`/`focus`/`setTab` (Task 10); `itemState` (Task 1).

**Behavior:**
- Rail tabs: **Decisions** (badge = open + changed count) and **Comments** (badge = open thread count); Decisions tab absent when no items.
- Decisions list groups in order: Needs your answer (open + changed), Deferred, Answered; empty groups hidden.
- ItemCard open state: kind tag, label, loc button (scrolls doc to item), question, context; decision options with "Author's pick" pill on the picked option, plus "Something else"; assumption verdict buttons Holds / Not sure / Doesn't hold; rationale textarea; Save disabled until a choice is made, and disabled when choice is `other` or `no` with an empty (trimmed) note.
- Defer button opens a panel with optional note; confirming dispatches `defer`.
- Done / deferred cards show the summary and **Change** (done) or **Answer now** (deferred) which reopen the editor prefilled; Cancel restores the previous view without changes.
- `changed` cards show the tag `changed since you answered`, the prior answer, and the editor open.
- Focused card gets the focus ring and is scrolled into view; focusing a card highlights its quote in the doc.

**Verify:**
- Run: `npm test -w @plan-review/browser-app`
- Expected: green.

### Task 13: Threads (Comments tab)

**Files:**
- Create: `components/ThreadCard.tsx`, `components/Composer.tsx`, `components/CommentsList.tsx`
- Test: `tests/ThreadCard.test.tsx`, `tests/CommentsList.test.tsx`

**Interfaces:**
- Consumes: `useReview`, actions `addThread`/`reply`/`resolve`/`reopen`/`cancelCompose`/`setFilter`/`focus` (Task 10); `resolveAnchor` (Task 11).

**Behavior:**
- Filter chips Open / Resolved / All filter non-outdated threads; outdated threads are always listed in a separate `Outdated` group at the bottom with their last anchor text.
- Composer appears at the top of the list while `composing` is set, showing the quoted block text; empty (trimmed) body cannot be posted; Esc / Cancel dispatches `cancelCompose`.
- ThreadCard: loc (section heading), quote, comments with avatar label `You` (reviewer) / `Agent` (agent), reply input, Resolve / Reopen; reply with empty body disabled.
- Agent comments are visually distinct (per design) and not editable.
- Clicking a card focuses its highlight in the doc.

**Verify:**
- Run: `npm test -w @plan-review/browser-app`
- Expected: green.

### Task 14: Submit popover, toast, submitted/failure views, cleanup

**Files:**
- Create: `components/SubmitPopover.tsx`, `components/Toast.tsx`
- Modify: `App.tsx`; delete `CommentCard.tsx`, `CommentInput.tsx`, `CommentSidebar.tsx`, `SubmitReviewPanel.tsx`, `TOCPanel.tsx` and their tests
- Test: `tests/SubmitPopover.test.tsx`, `tests/App.test.tsx`

**Interfaces:**
- Consumes: `ReviewClient.submitReview` (Task 1), `formatReviewOutput` (Task 5) for the failure fallback, `useReview`.

**Behavior:**
- Popover: summary textarea; soft-gate list of open + changed + deferred items (each click focuses the item and closes the popover); buttons **Request changes** and **Approve**; both always enabled (soft gate); when open items exist the list header says how many are unanswered.
- Submit success → flush autosave first, then `submitReview`; toast per design text; app shows the submitted view.
- Submit failure → failure view showing `formatReviewOutput` computed client-side from current state (copy button), matching today's fallback behaviour.
- No legacy component files remain; `npm run build` produces the single inlined HTML.

**Verify:**
- Run: `npm test -w @plan-review/browser-app && npm run typecheck -w @plan-review/browser-app && npm run build`
- Expected: green; build succeeds.

**Phase 3 gate:** Fable 5.1 UI/code review + visual verification against the design via `codex-computer-use` (light + dark, 1440 / 1200 / 1000 widths, plan with items and plan without items).

---

## Phase 4 — Agent contract and end-to-end

### Task 15: Demo plan and skill

**Files:**
- Modify: `examples/demo-plan.md`, `skills/plan-review/SKILL.md`, `README.md` (usage section only)

**Behavior:**
- `examples/demo-plan.md` contains ≥ 2 decisions (one with a pick, one without), ≥ 2 assumptions, one quote that matches and one that does not; parses with zero warnings (asserted by a core test reading the file).
- SKILL.md documents the block syntax (spec §1), `--review <id>` continuation, `reply` blocks, the paused outcome ("wait for the user"), and keeping item ids stable. **Wording is presented to the user for sign-off before commit.**
- README documents `--review`, `list`, and the authoring blocks briefly.

**Verify:**
- Run: `npm test -w @plan-review/core`
- Expected: demo-plan test green; user approved SKILL.md wording.

### Task 16: E2E, visual tests, legacy removal, full verification

**Files:**
- Modify: `tests/e2e/submit-failure.spec.ts`, `tests/visual/renderer.spec.ts`, `packages/core/src/formatter.ts`, `packages/core/src/types.ts`, `packages/core/tests/formatter.test.ts`
- Create: `tests/e2e/review-flow.spec.ts`, `tests/e2e/pause-resume.spec.ts`, `tests/e2e/round-two.spec.ts`

**Behavior:**
- All e2e specs set `PLAN_REVIEW_HOME` to a temp dir.
- `review-flow`: answer one decision, defer one, comment on a paragraph → Request changes → CLI stdout contains the decision answer line, `**Deferred**`, the thread, and `--review rv_`.
- `pause-resume`: answer an item, close the tab → CLI prints paused notice, exit 0 → rerun with `--review <id>` → answer and thread still present.
- `round-two`: submit round 1; edit a decision's question and add a `reply thread=<id>` block → rerun with `--review` → card shows `changed since you answered`, thread shows the Agent reply, header says Round 2.
- `submit-failure` and `renderer` specs updated to v2 selectors and still assert their original intent.
- Legacy `formatReview(doc, opts)`, `ReviewSubmission`, `ReviewVerdict` removed from core with their tests; `ReviewComment` kept only if still referenced (terminal navigator), else removed. `FileSessionStore` stays exported, marked `@deprecated`.

**Verify:**
- Run: `npm run build && npm run typecheck && npm test && npm run test:e2e && npm run test:visual`
- Expected: all green.

**Final gate:** Fable 5.1 whole-branch review + `codex-review` (Astra) adversarial pass; fix findings; re-run Task 16 Verify.

---

## Notes

- Branch base is `origin/main` (9bea32d). The unmerged `feat/forge-embed` branch has CLI commits (loopback bind, `--no-open`, URL-as-JSON, bin symlink) that will conflict with Tasks 6–8 in `packages/cli/src/{index,browser-review,server/*}.ts`; resolve when either branch merges.
