# Seed New Reviews From the Last Approved Review

**Goal:** When a new review starts on a plan file, pre-fill answers from that file's most recent approved review, matched by item id. Unchanged items show as answered; items whose text changed show as `changed` with the previous answer, exactly like a later round of a multi-round review.

**Why:** An approved review is closed, so a revised plan starts a fresh review with `answers: {}`. Every unchanged block must be answered again (observed 2026-10-17: rv_ixaq8mp0 → rv_rlz7v20k on `decolamkt/thoughts/features/clube-quem-constroi/mvp.md`).

**Scope:** One task, core only, plus one skill line. No new dependencies, no schema change to `Review` or `Answer`.

## Decided

- **Where:** `openResolvedReview` in `packages/core/src/rounds.ts`, in the branch that creates a new review (`if (!review)`). All hosts (CLI browser, CLI terminal, VS Code) go through `openReview`, so they all get it with no host changes.
- **When it seeds:** only when all hold: a new review is being created, `input.planPath` is set, and `input.fresh` is not true. Stdin plans (no `planPath`) never seed. `--fresh` never seeds: it means "start clean".
- **Source:** the most recently updated review with `status: 'approved'` and the same `planPath`. Found via the existing `store.list({ status: 'approved' })` (already sorted by `updatedAt` desc), so the `ReviewStore` interface does not change and test fakes keep working.
- **What is copied:** answers whose id is an item id in the new document, copied verbatim (`choice`, `note`, `itemHash`, `round`, `updatedAt`). The existing `itemHash` check does the rest: same hash → `done`/`deferred`; different hash → `changed` with the old answer shown. `Answer.round` is only validated, never read, so keeping the source value is harmless.
- **What is not copied:** threads (closed discussion of the old document), and answers to ids absent from the new document.
- **Deferred answers** carry as `deferred`. In an approved review a deferred item is still open, so it stays visibly deferred.
- **Source review untouched:** seeding only reads the approved review.

```decision id=seed-banner
label: Tell the reviewer answers were pre-filled
question: Should the review UI say that answers were carried over from the last approved review?
quote: pre-fill answers from that file's most recent approved review
context: Without a note, a reviewer opening a "new" review may be surprised that items are already answered.
- A: Add a banner on the opening that seeded | New `Banner` value `'seededFromApproved'`, one line in `DocView.tsx`: "Answers carried over from the last approved review of this file." [pick]
- B: No banner | Zero UI change; answered items speak for themselves
```

## Files

| File | Change |
|---|---|
| `packages/core/src/rounds.ts` | Seed answers in the new-review branch of `openResolvedReview`; set banner when seeding copied ≥1 answer (if `seed-banner` = A) |
| `packages/core/src/types.ts` | `Banner` gains `'seededFromApproved'` (if A) |
| `packages/browser-app/src/components/DocView.tsx` | Render the banner, same pattern as `planUnchanged` (if A) |
| `packages/core/tests/rounds.test.ts` | Tests below |
| `skills/plan-review/SKILL.md` | Notes: replace "An approved review is closed. `--review` on it fails; start a new review without the flag." with the same sentence plus: "The new review pre-fills answers from the file's last approved review; edited items reopen with the previous answer shown. `--fresh` starts empty." |

```assumption id=skill-copies
label: Skill copies stay in sync
statement: `skills/plan-review/SKILL.md` is the only source; the CLI build bundles it and `~/.claude/skills/plan-review/SKILL.md` is refreshed by `plan-review install-skill`, not edited by hand.
context: install-skill.ts copies the skill from the CLI package; I have not checked the build step that puts it there.
```

## Tests (`packages/core/tests/rounds.test.ts`)

1. New review on a file with an approved review, item text unchanged → answer present, `itemState` = `done`.
2. Item text changed (different hash) → answer present, `itemState` = `changed`, previous choice/note intact.
3. Id in approved review but not in the new document → not copied.
4. Two approved reviews on the same path → seeds from the most recently updated one.
5. Approved review on a different `planPath` → nothing seeded.
6. `fresh: true` → `answers` empty.
7. No `planPath` (stdin) → `answers` empty.
8. An open review exists for the path → it is resumed as today; no seeding into it.
9. Threads are not copied.
10. Approved source review is unchanged on disk after seeding.
11. (if A) Banner `seededFromApproved` set when ≥1 answer was copied; absent when none was.

## Validation

```bash
npm run typecheck && npm test
```

Manual check: approve a review on a scratch plan, edit one block, run `plan-review <file> -o stdout`, confirm one item shows `changed` and the rest answered.

## Execution roster

| Task | Model + effort | Reason |
|---|---|---|
| Implement + tests (single task above) | Sonnet 5.5 | Every decision made here; tests + typecheck are the done-check |
| Review the diff | GPT-6 Astra via `codex-review` | Small change; one cold cross-model check is enough |
