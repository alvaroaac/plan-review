# Plan Review v2 — Decisions, Deferrals, Threads, Rounds — Design

> **Status:** Draft
> **Generated:** 2026-10-15
> **Repo:** `plan-review`
> **Packages:** `@plan-review/core`, `plan-review` (cli), `browser-app`, `vscode-extension`, `skills/plan-review`
> **Design source:** claude.ai/design project `a3b1d2c8-5dbd-417b-8f9d-01e15f950ffe`, file `Plan Review Simple.html` (`window.LAYOUT="rail"`, `window.VARIANT="stepper"`) + `simple_app.jsx`, `simple_parts.jsx`, `simple_data.jsx`, `simple.css`

---

## Task Summary

Plans written by agents often contain open decisions and unverified assumptions. v2 lets the agent surface them as structured items inside the plan, lets the reviewer answer, defer, or flag them in a redesigned UI, and returns structured answers to the agent. Reviews become multi-round: state persists per review across plan revisions and pauses, until the reviewer approves.

Users: one human reviewer working with one agent, possibly over several rounds. No multi-user features now; the data model leaves room for them (comment `author`).

### Success criteria

1. An agent can write `decision` / `assumption` blocks in a plan; the UI renders them as answerable items with highlights in the prose.
2. The reviewer can answer, defer (with a note), change answers, comment on paragraphs, reply to and resolve threads.
3. Closing the tab mid-review pauses it; re-running resumes with all state intact.
4. Round N+1 (revised plan, same review id) carries answers, deferrals, and unresolved threads forward; changed items reopen; agent `reply` blocks appear in threads.
5. The agent receives a markdown review listing decisions, assumptions, deferrals, open threads, verdict, and the review id to continue with.
6. Browser and VS Code hosts get the v2 UI; terminal (`--cli`) mode degrades gracefully.

---

## Context (current state)

- Input: markdown file or stdin → `parse()` in `core/src/parser.ts` → `PlanDocument { title, metadata, mode, sections, comments }`. Plan mode (`##` milestones / `###` tasks) or generic mode.
- Comments: `ReviewComment { sectionId, text, timestamp, anchor?: LineAnchor }`; identity is array index; no threads, ids, replies, resolve, or author.
- Persistence: `FileSessionStore` → `~/.plan-review/sessions/<hash(planPath)>.json` holding comments + activeSection only. Stdin plans have no session.
- Submit: `{ comments, verdict: 'approved' | null, summary }` → `formatReview()` markdown → stdout/clipboard/file/claude.
- Browser app: Preact 10 + esbuild, single inlined HTML; `App.tsx` holds all state in `useState`; plain CSS, dark-only; layout TOC | content | comment sidebar.
- Known bug: browser-mode resume is non-functional since refactor #3 (`HttpReviewClient.loadDocument` never supplies `restoredSession`). v2 replaces this path.
- No concept of decisions / assumptions / defer anywhere.

---

## §1 Authoring format (agent → plan)

Three fenced block types, parsed by core. Info string is `<type> <key>=<value>`.

````md
```decision id=retry-backoff
label: Retry backoff
question: How should token refresh retries back off when the auth server is slow?
quote: how token refresh retries back off
context: The Aug 14 incident was caused by unbounded retries.
- A: Exponential backoff, capped at 5 s | Simple; invisible to client [pick]
- B: Circuit breaker after 90 s of failures | Needs a health probe
```

```assumption id=subtlecrypto
label: Browser crypto support
statement: Every supported browser exposes SubtleCrypto for S256.
quote: every supported browser exposes SubtleCrypto
context: Based on browserslist in package.json.
```

```reply thread=t_4k2
Reworded to "never exposed to the browser".
```
````

### Field rules

| Field | Block | Required | Notes |
|---|---|---|---|
| `id` (info string) | decision, assumption | yes | `[a-z0-9-]+`, unique per plan. Carry-forward key across rounds. |
| `label` | both | no | Defaults to humanized id. Shown in stepper, TOC, cards. |
| `question` | decision | yes | |
| `statement` | assumption | yes | |
| `quote` | both | no | Exact phrase to highlight in the nearest preceding paragraph of the same section (case-sensitive substring match on rendered text). |
| `context` | both | no | |
| option lines `- <KEY>: <text> \| <detail> [pick]` | decision | ≥ 2 | KEY is a single uppercase letter; `\| detail` optional; `[pick]` marks author's pick (at most one). |
| `thread` (info string) | reply | yes | Body = reply text (multi-line allowed). |

Single-line `key: value` fields; unknown keys are ignored with a warning.

### Parsing behaviour

- An item belongs to the section it appears in (drives TOC dots, stepper order, output grouping). Item order = document order.
- `quote` matched → inline highlight in that paragraph. Not matched or absent → marker chip rendered where the block sits.
- **Malformed** block (missing id / question / statement, < 2 options, duplicate id, > 1 pick, bad key) → rendered as an ordinary code block; a warning is added to `warnings[]` and shown as a banner. Never throws.
- `reply` blocks are removed from rendered section bodies and applied to the thread with that id (`author: 'agent'`). Unknown thread id → warning.
- Blocks are recognised only as top-level fenced code blocks with exactly these info-string types; other fences are untouched.

---

## §2 Data model and storage

New types in `core/src/types.ts` (closed shapes; names are contractual):

```ts
type ItemKind = 'decision' | 'assumption';

interface ReviewItem {
  id: string; kind: ItemKind; label: string;
  question: string;            // statement for assumptions
  context?: string; quote?: string;
  options?: { key: string; text: string; detail?: string; pick: boolean }[]; // decisions only
  sectionId: string;
  hash: string;                // hash(kind, question, options) — change detection
}

type AssumptionVerdict = 'holds' | 'unsure' | 'no';

interface Answer {
  choice: string;              // option key | 'other' | AssumptionVerdict | 'deferred'
  note: string;                // required when choice is 'other' or 'no'
  itemHash: string;            // ReviewItem.hash at time of answering
  round: number;
  updatedAt: string;           // ISO
}

interface ThreadComment { id: string; author: 'reviewer' | 'agent'; body: string; createdAt: string }

interface Thread {
  id: string;                  // 't_' + short random
  sectionId: string;
  anchor: LineAnchor | null;   // null = whole section
  resolved: boolean;
  outdated: boolean;
  createdRound: number;
  comments: ThreadComment[];
}

interface Round {
  n: number;                   // 1-based
  plan: string;                // raw markdown snapshot
  contentHash: string;
  startedAt: string;
  submittedAt?: string;
  verdict?: 'changes_requested' | 'approved';
  summary?: string;
}

interface Review {
  version: 2;
  id: string;                  // 'rv_' + 8 base36 chars
  title: string;
  planPath?: string;           // absolute; absent for stdin
  status: 'open' | 'approved';
  createdAt: string; updatedAt: string;
  answers: Record<string, Answer>;   // keyed by item id, spans rounds
  threads: Thread[];                  // spans rounds
  rounds: Round[];                    // last is active iff !submittedAt
}
```

Derived (not stored): item state `open | done | deferred | changed` (`changed` = answer exists but `itemHash !== item.hash`).

### Store

```ts
interface ReviewStore {
  get(id: string): Promise<Review | null>;
  save(review: Review): Promise<void>;
  list(filter?: { status?: Review['status'] }): Promise<Review[]>;
  findOpenByPlanPath(planPath: string): Promise<Review | null>; // most recently updated
}
```

- `FileReviewStore(dir = ~/.plan-review/reviews)` writes `<id>.json` atomically (tmp + rename), validates on read with a hand-written `isReview` guard (same pattern as `isSessionData`); corrupt files are skipped by `list` and returned as `null` by `get` (not deleted — reviews are user data).
- Exported from `@plan-review/core` (node entry) alongside existing exports. `FileSessionStore` stays exported (deprecated) until the next major; v2 no longer reads `~/.plan-review/sessions/`. No migration (v1 sessions were single-round and short-lived).
- Rationale for JSON files over a DB: no dependency, works inside the VS Code extension (no native modules), inspectable; listing is a directory scan. The `ReviewStore` interface is the seam for a SQLite/Postgres backend later (e.g. Forge).

---

## §3 Round lifecycle and CLI

### Invocation

`plan-review <file|-> [--review <id>]` (existing output flags unchanged). New: `plan-review list`.

### Review resolution

1. `--review <id>`: load. Unknown id → error exit 1 `Review <id> not found`. Approved → error exit 1 `Review <id> is approved; run without --review to start a new review`.
2. No flag + file path: `findOpenByPlanPath` → resume if found, else create.
3. No flag + stdin: create.

### Opening a round

- Active (unsubmitted) round exists:
  - same `contentHash` → resume as-is;
  - different hash → replace the round's `plan`/`contentHash`, run carry-forward, banner `planChangedWhilePaused`.
- Last round submitted (or none) → append round N+1; if content identical to round N → banner `planUnchanged`.

### Carry-forward (pure function in core, runs on every round open)

1. Parse items. For each stored answer: item present and hash equal → kept; hash differs → item state `changed` (card reopens showing prior answer); item absent → answer kept in store, hidden in UI and output.
2. Re-anchor every non-resolved thread with an anchor: find a block run whose texts equal `anchor.lineTexts` in the section with the same heading; else anywhere in the plan; on success update `sectionId`/`startLine`/`endLine` and clear `outdated`; else set `outdated = true`. Threads whose section heading disappeared and have no anchor → `outdated`.
3. Apply `reply` blocks: append `ThreadComment { author: 'agent' }` to the matching thread, deduplicated by body so re-emitted replies in later rounds are not duplicated.

### Outcomes

| Event | Effect | CLI stdout | Exit |
|---|---|---|---|
| Request changes | round frozen (`verdict: changes_requested`) | v2 review output | 0 |
| Approve | round frozen, `status: approved` | v2 review output, approved footer | 0 |
| Tab closed / heartbeat lost / idle ceiling | nothing to do — state already autosaved | paused notice | 0 |

Paused replaces today's "Review cancelled" rejection. Exit 0 so agents do not treat it as a crash; the notice tells them to wait.

### `plan-review list`

Table of open reviews: id, title, round, last updated, `answered/deferred/open` counts. `--all` includes approved.

### HTTP API (cli/src/server/routes.ts)

| Route | Body / response |
|---|---|
| `GET /api/doc` | → `{ document, items, warnings, review: { id, round, status, answers, threads, banner? } }` |
| `PUT /api/session` | ← `{ answers, threads }`; validated (hand-written validators, existing pattern); server merges into the active round's review and saves |
| `POST /api/review` | ← `{ verdict: 'changes_requested' \| 'approved', summary }` |
| heartbeat / pause / cancel / `_assets` | unchanged semantics, except cancel → paused outcome |

The server owns merge + persistence. `ReviewClient` (core) is updated to this shape; `FakeReviewClient` follows.

### VS Code

`protocol.ts` request/response types mirror the HTTP API. Review resolution uses `findOpenByPlanPath` (panels are per file). Submit fan-out (claudeCode, clipboard, file, outputChannel) receives the v2 formatted output.

### Terminal mode (`--cli`)

Decision/assumption blocks render as readable text (label, question, options with pick). No answering. Output includes `N decisions/assumptions unanswered (answer them in browser mode)`. Review id/rounds still apply.

---

## §4 Output to the agent

`formatReview(review, items, opts)` in `core/src/formatter.ts`. Markdown. Sections omitted when empty.

````md
# Plan Review: <title>
Review `rv_8f3a` · Round 2 · **Changes requested**

## Summary
<reviewer summary, if any>
- Decisions: 2 answered, 1 deferred, 1 unanswered · Assumptions: 1 holds, 1 doesn't hold
- Threads: 2 open (1 new this round), 1 resolved this round

## Decisions
### `retry-backoff` · Retry backoff — **B**: Circuit breaker after 90 s (your pick was A)
> rationale note
### `legacy-window` · Legacy callback window — **Deferred**
> Needs mobile-team input on reopen rates
### `cookie-scope` · Refresh cookie scope — *Unanswered*

## Assumptions
### `auth-latency` · Auth server latency — **Doesn't hold**
> p99 spikes to 900 ms during deploys

## Open threads
### `t_4k2` · § 04 Token exchange
> never leaves the client
- **Reviewer:** It does leave the client…
- **Agent:** Reworded…

---
**Next:** revise the plan and re-run with `--review rv_8f3a`. Keep item ids stable.
Re-emit deferred items unchanged unless you resolve them. Answer threads with
```` ```reply thread=<id>``` ```` blocks.
````

Rules:
- "(your pick was X)" only when the answer differs from the author's pick. "Something else" renders as **Other** followed by the note.
- Assumption verdict labels: `Holds`, `Not sure`, `Doesn't hold`.
- Open threads: all unresolved, non-outdated threads; outdated threads listed under `## Outdated threads` with their last anchor text.
- Approved footer: `Approved. N deferred items remain open — track them during implementation.` (deferred list still printed above).
- Paused notice (entire output): `Review \`rv_8f3a\` paused at round 2 (3/5 items answered). The user has not finished reviewing — wait for them. Resume with: plan-review --review rv_8f3a`.
- Plans with no items and no threads: Summary + footer only (equivalent to today's minimal output plus id).
- `SubmitFailureView` fallback shows this same text.

---

## §5 UI (browser app, Preact)

Port of the design's **rail + stepper** variant. Design files are the visual source of truth for spacing, colour, and copy; vendor them into `docs/superpowers/specs/assets/plan-review-v2/` as reference (not shipped).

### Layout

`header 52px` / `main` grid `TOC 232px | doc | rail 380px`; breakpoints per `simple.css` (≤1240: 200/340; ≤1040: TOC collapses to 52px icon column).

### Components

| Component | Responsibility |
|---|---|
| `TopBar` | brand, crumb (plan title), `Stepper`, theme toggle, Submit review |
| `Stepper` | one segment per item in doc order; colours: decision indigo, assumption teal, done sage, deferred amber hatched, focused outlined; "N of M answered · K deferred"; Next button jumps to next open item |
| `TocPanel` | sections with item dots + open-thread count; plan mode: milestones as group headers, tasks as rows; scroll-spy active state |
| `DocView` | header (kicker `Plan · Round N`, title, meta: updated time + review id, legend), banners (stale/changed/unchanged/warnings), sections |
| `SectionView` / paragraph blocks | hover `+` starts paragraph comment; existing shift-click range extension kept; `Q` highlight for item quotes with `?`/`A`/`✓`/`–` badge; marker chip when quote unmatched; amber `Hl` for thread anchors |
| `Rail` | tabs **Decisions** (count of open) / **Comments** (count of open threads); Decisions tab and Stepper hidden when plan has no items |
| `ItemCard` | per design: kind tag, label, loc button, question, context; options with Author's pick + "Something else" / verdict buttons; rationale textarea; Defer panel with optional note; Save / Change / Answer now / Cancel; `changed since you answered` tag for `changed` state |
| Decisions list | groups: Needs your answer (includes `changed`) / Deferred / Answered |
| `ThreadCard` | loc, quote, comments with avatar (`You` / `Agent`), reply input (reviewer), Resolve / Reopen |
| Comments list | chips Open / Resolved / All; `Outdated` group at the bottom; `Composer` at top while composing |
| `SubmitPopover` | summary textarea; soft-gate list of open + deferred items (click jumps to item); buttons **Request changes** and **Approve** |
| Toast + submitted view | after success; existing failure fallback retained |

Interaction rules from the design: clicking a highlight focuses its card (switching tab as needed) and vice versa; focus ring on card + highlight; assumption `Doesn't hold` and `Something else` require a note before Save.

### State

Replace `App.tsx`'s `useState` pile with one reducer + `ReviewContext` (`useReview()`), holding `doc, items, warnings, review (answers, threads, round), ui (tab, filter, focus, composing, theme)`. Autosave `{ answers, threads }` via core `createAutosave` (500 ms, flush on `beforeunload`).

### Theme and fonts

- Tokens from `simple.css` as CSS variables, light + dark. Default follows `prefers-color-scheme`; toggle persisted in `localStorage` (try/catch). In VS Code, follow the editor theme body class.
- No network fonts (VS Code CSP, offline CLI). Stacks: `"Geist", ui-sans-serif, system-ui` / `"Newsreader", Georgia, serif` / `"Geist Mono", ui-monospace, Menlo`.
- `styles.css` is rewritten from `simple.css`; existing renderer styles (mermaid roles, KaTeX, footnotes, admonitions, images) are retained and re-themed for light mode.

---

## §6 Testing, phasing, scope

### Phases

1. **Core** — block parser + warnings, types, item hash, `ReviewStore` / `FileReviewStore`, carry-forward + re-anchoring + reply application (pure), formatter v2, `ReviewClient` update.
2. **Hosts** — CLI review resolution, rounds, routes + validators, paused outcome, `list`, terminal-mode degradation; VS Code protocol + handlers.
3. **UI** — tokens/theme, shell, TOC, doc highlights, rail/tabs, ItemCard, threads, stepper, submit popover.
4. **Agent contract** — `examples/demo-plan.md` with decision/assumption blocks; `skills/plan-review/SKILL.md` update (wording requires user sign-off before shipping).

### Tests

- **Core (Vitest):** block parsing incl. every malformed case; quote match/miss; item hash changes on question/options edits only; carry-forward kept/changed/removed; re-anchor same-section/moved/outdated; reply apply + dedupe + unknown thread warning; formatter snapshots for changes-requested, approved-with-deferred, paused, no-items; store round-trip, atomic write, corrupt file → null, `findOpenByPlanPath`.
- **CLI:** review resolution matrix (flag/path/stdin × open/approved/unknown); route validation rejects bad shapes; cancel → paused output, exit 0; `list` output.
- **Browser app (testing-library):** ItemCard answer / defer / change / note-required; rail grouping incl. `changed`; thread reply / resolve / outdated group; Decisions tab hidden with no items; submit popover soft gate.
- **Playwright e2e:** rewrite `tests/e2e/submit-failure.spec.ts` for v2 selectors; new specs: (a) answer + defer + comment → Request changes → assert stdout content; (b) close tab → paused → rerun with `--review` → state restored; (c) round 2 with edited decision + agent reply → `changed` tag and reply visible. Adapt `tests/visual/renderer.spec.ts` selectors.
- `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run test:visual` green.

### Out of scope

- Multiple human reviewers / identities beyond `reviewer | agent`.
- Answering items in terminal mode.
- Diff view between rounds (round snapshots enable it later).
- Any database.
- `@plan-review/react` changes.
