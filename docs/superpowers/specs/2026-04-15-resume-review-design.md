# Resume Review — Design Spec

**Date:** 2026-04-15
**Status:** Draft

## Overview

Save and restore review state so that closing the terminal or browser tab doesn't lose work. Sessions are stored centrally at `~/.plan-review/sessions/` and loaded automatically on next run.

## Session File

### Location

`~/.plan-review/sessions/<pathHash>.json`

`pathHash` is the first 16 hex characters of the SHA-256 of the absolute plan file path.

### Schema

```json
{
  "version": 1,
  "planPath": "/absolute/path/to/plan.md",
  "contentHash": "sha256:abc123def456...",
  "comments": [
    {
      "sectionId": "1.2",
      "text": "Needs error handling",
      "timestamp": "2026-04-15T18:30:00.000Z",
      "anchor": {
        "type": "lines",
        "startLine": 3,
        "endLine": 5,
        "lineTexts": ["line 3", "line 4", "line 5"]
      }
    }
  ],
  "activeSection": "1.2",
  "lastModified": "2026-04-15T18:30:00.000Z"
}
```

- `version`: schema version for future migrations.
- `planPath`: absolute path of the reviewed plan file, for human identification.
- `contentHash`: SHA-256 of the plan file content at session creation. Used for staleness detection.
- `comments`: array of `ReviewComment` objects, serialized with ISO timestamp strings.
- `activeSection`: last active section ID, or `null`.
- `lastModified`: ISO timestamp of last save.

## Session Module

New file: `src/session.ts`

### Types

```typescript
interface SessionData {
  version: number;
  planPath: string;
  contentHash: string;
  comments: ReviewComment[];
  activeSection: string | null;
  lastModified: string;
}

interface SessionLoadResult {
  comments: ReviewComment[];
  activeSection: string | null;
  stale: boolean;
}
```

### Exports

```typescript
getSessionDir(): string
```
Returns `~/.plan-review/sessions/`. Creates the directory (recursive) if it doesn't exist.

```typescript
loadSession(planPath: string, currentContentHash: string): SessionLoadResult | null
```
Computes `pathHash` from the absolute plan path. Reads the session file if it exists. Returns `null` if no session found. Sets `stale: true` if stored `contentHash` differs from `currentContentHash`.

```typescript
saveSession(planPath: string, contentHash: string, comments: ReviewComment[], activeSection: string | null): void
```
Writes session file. Called on every comment add/edit/delete. Best-effort: errors logged to stderr, never thrown.

```typescript
clearSession(planPath: string): void
```
Deletes session file. Called after successful review submission.

```typescript
computeContentHash(content: string): string
```
Returns `sha256:<hex>` of the given string content.

```typescript
listSessions(): Array<{ planPath: string; commentCount: number; lastModified: string; stale: boolean | null }>
```
Reads all session files in `~/.plan-review/sessions/`. For each, returns the plan path, comment count, and last modified date. `stale` is `true` if the plan file still exists and its content hash differs, `false` if it matches, `null` if the plan file no longer exists.

All functions use synchronous fs operations (`readFileSync`, `writeFileSync`, `unlinkSync`). Session files are small and sync keeps calling code simple.

## CLI Integration

### New flags

- `--fresh` — skip session resume, start clean. Clears any existing session for the plan file.

### New subcommand

- `plan-review sessions` — list all saved sessions. Output:

  ```
  Saved review sessions (~/.plan-review/sessions/):

    /path/to/plan.md
      5 comments | last modified 2h ago

    /path/to/other-plan.md
      12 comments | last modified 3d ago | plan file changed since last review

    /path/to/deleted-plan.md
      3 comments | last modified 1w ago | plan file not found
  ```

  Shows plan path, comment count, relative time, and staleness/missing warnings. Plan path and comment count are always available from the session file data, even if the original plan file has been deleted.

### Resume flow in `index.ts`

1. Read plan file content.
2. Compute `contentHash`.
3. If `--fresh`: call `clearSession()`, skip to step 7.
4. Call `loadSession(planPath, contentHash)`.
5. If session exists and not stale: print "Resuming review (N comments)." Pre-load comments.
6. If session exists and stale: print "Plan changed since last review. Resume with N comments? [y/n]". If yes, pre-load. If no, `clearSession()` and start fresh.
7. Proceed to review (terminal or browser mode).
8. After successful submit: `clearSession()`.

### Auto-save hooks

**Terminal mode (`navigator.ts`):**
- After each comment push in `linearReview()`, call `saveSession()` with current comments and active section ID.
- `navigate()` accepts a `onCommentChange` callback from `index.ts` that triggers the save.

**Browser mode:**
- New `PUT /api/session` endpoint. Route handler receives `{ comments, activeSection }` and delegates to `saveSession()`.
- `App.tsx`: `useEffect` watching `comments` array fires `PUT /api/session` debounced at 500ms.
- `POST /api/review` handler also calls `clearSession()` after forwarding to `onSubmit`.

### RouteContext changes

`RouteContext` interface gains:

```typescript
onSessionSave: (comments: ReviewComment[], activeSection: string | null) => void;
```

Provided by `index.ts` when constructing the transport context.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Session file corrupt/invalid JSON | Log warning, delete file, return `null` from `loadSession()` |
| `~/.plan-review/sessions/` missing | `getSessionDir()` creates it silently |
| Disk full / permission denied on save | Log warning to stderr, continue review. Session save is best-effort. |
| Multiple concurrent reviews of same plan | Last write wins. Not worth file locking for 1.x. |
| Plan file deleted between save and resume | `loadSession()` returns session, but `index.ts` fails earlier on `readFileSync` of the plan file. |
| Browser tab closed mid-review | Comments already auto-saved. Next run resumes. Server timeout kills old process. |

## README Update

Add a "Saved sessions" section to README.md covering:

- Sessions are auto-saved to `~/.plan-review/sessions/`.
- On next run for the same plan, you're prompted to resume.
- `--fresh` flag to start a clean review.
- `plan-review sessions` to list all saved sessions.
- Manual cleanup: delete files in `~/.plan-review/sessions/`.

## Testing

### Unit tests (`session.test.ts`)
- save/load/clear round-trip: save comments, load returns same data
- `computeContentHash` is deterministic and differs for different content
- `loadSession` returns `null` when no session file exists
- `loadSession` returns `stale: true` when content hash differs
- `loadSession` returns `stale: false` when content hash matches
- `loadSession` handles corrupt JSON: logs warning, deletes file, returns `null`
- `saveSession` creates `~/.plan-review/sessions/` directory if missing
- `saveSession` logs warning and continues when write fails (permission denied)
- `clearSession` deletes session file, no error if already missing
- `listSessions` returns empty array when no sessions exist
- `listSessions` returns plan path, comment count, lastModified for each session
- `listSessions` marks stale sessions (`stale: true`), current sessions (`stale: false`), and missing plan files (`stale: null`)

### Business rule tests
- Resume flow: save session, re-load same plan → comments pre-loaded
- Stale detection: save session, modify plan content, re-load → `stale: true`
- `--fresh` flag: existing session cleared, review starts with zero comments
- Auto-save fires after each comment add/edit/delete (terminal and browser)
- Submit clears session: after `POST /api/review`, session file is deleted
- Session keyed by path: same file at two different paths = two independent sessions

### Integration tests
- `routes.test.ts` — `PUT /api/session` endpoint accepts comments and delegates to save
- `index.test.ts` — `--fresh` flag starts clean review
- `App.test.tsx` — `useEffect` fires `PUT /api/session` on comment state change

## Out of Scope

- Session migration across schema versions (just `version` field for future use).
- File locking for concurrent access.
- Session expiry / automatic cleanup.
- Syncing sessions across machines.
