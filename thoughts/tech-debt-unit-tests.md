# Tech Debt: Missing Unit Tests

Modules with testable logic that currently lack unit tests.

---

## src/navigator.ts

Interactive module — skipped tests during initial build. Several pure functions could be extracted and tested:

- **`findSection(doc, input)`** — section lookup by ID or numeric index. Testable: exact match, numeric fallback, not-found case, out-of-range index.
- **`getReviewableSections(doc)`** — filters sections by mode. Testable: plan mode returns level 3 only, generic mode returns level >= 2.
- **`printSummary(doc)`** — computes commented/skipped/total counts. Could capture stderr output and assert counts.
- **`linearReview` navigation logic** — back/toc/skip/comment branching. Would need readline mock or extracted state machine.

**Suggested approach:** Export `findSection` and `getReviewableSections` as named exports. Pure functions, easy to test. Leave `linearReview` and `navigate` as integration-tested only (Task 10 manual testing).

---

## src/output.ts

Has tests for helpers (`getClipboardCommand`, `isClaudeAvailable`, `writeOutput` stdout path) but missing:

- **`writeOutput` file target** — writes file to disk. Testable with tmp dir: verify file created, correct content, correct path derivation (custom path vs input.review.md vs review.md fallback).
- **`writeOutput` clipboard target** — harder to test without mocking `execSync`, but could verify fallback behavior on unsupported platform.
- **`writeToFile` path resolution** — three branches (outputFile, inputFile-derived, default). Each branch testable with mock fs or tmp dirs.

**Suggested approach:** Test `writeOutput('content', 'file', ...)` with a tmp dir and verify file contents. Use `vi.mock` for clipboard/claude tests.

---

## src/index.ts

Entry point — no unit tests. Testable pieces:

- **`readInput(file)`** — file reading with existence check, stdin detection, help fallback. Could test file-not-found error, valid file read.
- **Output target validation** — invalid target throws specific error message.
- **Split strategy mapping** — 'heading'/'separator'/default maps correctly.

**Suggested approach:** Extract `readInput` and validation logic into testable functions. Or test via integration (spawn process, assert exit codes and stderr).

---

## Priority

1. **navigator.ts** — highest value. `findSection` and `getReviewableSections` are pure and used in hot path.
2. **output.ts file target** — moderate value. File path derivation has three branches, easy to get wrong.
3. **index.ts** — lowest priority. Integration testing (Task 10) covers most paths.
