# SessionStore + Autosave Refactor — Design

> **Status:** Draft
> **Generated:** 2026-05-17
> **Repo:** `plan-review`
> **Package:** `@plan-review/core`
> **Companion:** Forge "embed plan-review" spec (separate repo, parallel work)

---

## Task Summary

Refactor `@plan-review/core`'s session persistence so the storage location and backend are injectable, and extract the browser-app's autosave debounce/flush loop into a framework-neutral helper exported from core. Goal: let downstream consumers (the CLI today, Forge tomorrow) embed plan-review's session machinery without inheriting the hardcoded `~/.plan-review/sessions/` location or duplicating the 500ms-debounce wiring.

The disk-on-format stays compatible so existing user sessions keep working. The module-level `saveSession`/`loadSession`/`clearSession`/`listSessions`/`getSessionDir` functions are removed (TS error at upgrade time — fail loud).

---

## Context

### Where session persistence lives today

- **`packages/core/src/session.ts`** — node-fs module. Exports module-level `saveSession(planPath, contentHash, comments, activeSection)`, `loadSession(planPath, currentContentHash)`, `clearSession(planPath)`, `listSessions()`, `getSessionDir()`, `computeContentHash(content)`. Session dir hardcoded to `~/.plan-review/sessions/`. Filenames are `sha256(absolute(planPath)).slice(0,16) + '.json'`.
- **`packages/core/src/reviewClient.ts`** — defines a higher-level async `ReviewClient` interface (`loadDocument` / `saveSession({ comments, activeSection, contentHash })` / `submitReview`) that the browser-app talks to via HTTP. Implementations live outside core (`HttpReviewClient` in CLI's web layer, `PostMessageReviewClient` in the VS Code extension).
- **`packages/browser-app/src/App.tsx`** — autosave loop. 500ms debounce on `useEffect([comments, activeSection, client, contentHash])` + `beforeunload` flush. Calls `client.saveSession(...)`. Doesn't touch the node-fs `saveSession` directly — that's the CLI's HTTP handler's job.
- **`packages/cli/`** — wraps core's node-fs functions behind HTTP routes (`/api/session`) that the browser-app talks to. Also implements `--resume` and `--fresh` flags via the same module-level functions.

### Conventions

- Pure TS, ESM-only. Each package builds via `tsc`. Tests via `vitest`.
- Public API is what's re-exported from `packages/core/src/index.ts`. Anything not re-exported is internal.
- Existing user sessions on disk in `~/.plan-review/sessions/*.json` are end-user state — must keep loading after the refactor.

### Downstream consumers

- **CLI (today)** — wraps session in HTTP. Owns its own session-dir choice but currently inherits the hardcoded default.
- **VS Code extension (today)** — has its own `PostMessageReviewClient` and does not consume core's node-fs session module directly. Unaffected by this refactor at runtime; type signatures stay stable.
- **Forge (incoming)** — wants sessions stored inside the project tree (e.g. `<project>/thoughts/tasks/<issueId>/.review-draft.json`-ish), not in `~/.plan-review/`. Driving requirement for the refactor.

---

## Suggested Approach

### 1. Replace module-level functions with `SessionStore` interface

`packages/core/src/session.ts` (full rewrite):

```ts
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ReviewComment } from './types.js';

export interface SessionData {
  version: number;
  planPath: string;
  contentHash: string;
  comments: ReviewComment[];
  activeSection: string | null;
  lastModified: string;
}

export interface SessionMeta {
  key: string;
  commentCount: number;
  lastModified: string;
  // (no inline staleness — caller computes against current content if it cares)
}

export interface SessionStore {
  save(key: string, data: SessionData): Promise<void>;
  load(key: string): Promise<SessionData | null>;
  clear(key: string): Promise<void>;
  list(): Promise<SessionMeta[]>;
}

export const DEFAULT_SESSION_DIR: string = join(homedir(), '.plan-review', 'sessions');

export function computeContentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export interface FileSessionStoreOptions {
  dir: string;            // required — no implicit homedir fallback
  keyHashLength?: number; // default 16
}

export class FileSessionStore implements SessionStore {
  constructor(private readonly opts: FileSessionStoreOptions) {}
  // implementation per Approach §2
}
```

**Decisions baked in:**

- `key` is opaque to the store — CLI passes `resolve(planPath)`, Forge passes its own scheme (e.g. `forge:FUL-42:spec`). Store hashes whatever it receives.
- `dir` is required. Consumers wanting today's default call `new FileSessionStore({ dir: DEFAULT_SESSION_DIR })`. Forces an explicit choice; no surprise writes to `~/`.
- All methods async. `FileSessionStore` uses `fs/promises` internally — does not block the event loop.
- `save` throws on I/O failure. Old `console.warn`-and-continue behavior was a footgun; consumers wrap in try/catch if they want silent failure.
- Corrupt JSON on `load` is auto-deleted from disk (preserves today's behavior). Reason: sessions live in a dotfile dir users can't see; stranding bad files there is worse than silent cleanup. Logged via `console.warn` like today.

### 2. `FileSessionStore` implementation

```ts
export class FileSessionStore implements SessionStore {
  private readonly dir: string;
  private readonly keyHashLength: number;

  constructor(opts: FileSessionStoreOptions) {
    this.dir = opts.dir;
    this.keyHashLength = opts.keyHashLength ?? 16;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private filePath(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex').slice(0, this.keyHashLength);
    return join(this.dir, `${hash}.json`);
  }

  async save(key: string, data: SessionData): Promise<void> {
    await this.ensureDir();
    await writeFile(this.filePath(key), JSON.stringify(data, null, 2), 'utf-8');
  }

  async load(key: string): Promise<SessionData | null> {
    const filePath = this.filePath(key);
    if (!existsSync(filePath)) return null;

    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }

    let data: SessionData;
    try {
      data = JSON.parse(raw) as SessionData;
    } catch {
      console.warn(`[plan-review] Corrupt session file, removing: ${filePath}`);
      try { await unlink(filePath); } catch {}
      return null;
    }

    // Restore Date objects on comment timestamps (matches today)
    return {
      ...data,
      comments: data.comments.map((c) => ({ ...c, timestamp: new Date(c.timestamp) })),
    };
  }

  async clear(key: string): Promise<void> {
    try {
      await unlink(this.filePath(key));
    } catch {
      // missing file is not an error
    }
  }

  async list(): Promise<SessionMeta[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }

    const results: SessionMeta[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(this.dir, file);
      try {
        const raw = await readFile(filePath, 'utf-8');
        const data = JSON.parse(raw) as SessionData;
        results.push({
          key: data.planPath,  // best available "key" identifier — caller's choice on what to put in SessionData.planPath
          commentCount: data.comments.length,
          lastModified: data.lastModified,
        });
      } catch {
        console.warn(`[plan-review] Skipping corrupt session file: ${filePath}`);
      }
    }
    return results;
  }
}
```

**Notes:**
- Stale-vs-current-content is no longer computed inside `list()`. That was a CLI-specific concern (re-reads `planPath` from disk to recompute hash). Push it up to consumers: today's behavior moves into CLI's `listSessions` HTTP handler / wrapper.
- `SessionMeta.key` returns `data.planPath` for backwards-compatibility with `listSessions()`'s old shape. If the consumer's `key` differs from `planPath` (Forge case), they should also set `data.planPath` to something meaningful for the meta view, or stop using `list()` for their own surface.

### 3. `createAutosave` helper — new module

`packages/core/src/autosave.ts`:

```ts
export interface AutosaveOptions<T> {
  delayMs: number;
  save: (snapshot: T) => Promise<void>;
  onError?: (err: unknown) => void;
}

export interface Autosave<T> {
  schedule(snapshot: T): void;
  flush(): Promise<void>;
  cancel(): void;
}

export function createAutosave<T>(opts: AutosaveOptions<T>): Autosave<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingSnapshot: T | null = null;
  let pendingResolve: ((value: void) => void) | null = null;
  let pendingPromise: Promise<void> | null = null;

  function ensurePromise(): Promise<void> {
    if (!pendingPromise) {
      pendingPromise = new Promise<void>((resolve) => {
        pendingResolve = resolve;
      });
    }
    return pendingPromise;
  }

  async function fire(): Promise<void> {
    if (pendingSnapshot === null) return;
    const snapshot = pendingSnapshot;
    pendingSnapshot = null;
    timer = null;
    const resolveCurrent = pendingResolve;
    pendingResolve = null;
    pendingPromise = null;
    try {
      await opts.save(snapshot);
      resolveCurrent?.();
    } catch (err) {
      resolveCurrent?.();  // flush() still resolves on error; error goes through onError
      if (opts.onError) {
        opts.onError(err);
      } else {
        setTimeout(() => { throw err; }, 0);  // surface as unhandled
      }
    }
  }

  return {
    schedule(snapshot: T) {
      pendingSnapshot = snapshot;
      ensurePromise();
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fire, opts.delayMs);
    },
    flush(): Promise<void> {
      if (timer === null) return Promise.resolve();
      clearTimeout(timer);
      const promise = ensurePromise();
      void fire();
      return promise;
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pendingSnapshot = null;
      const resolveCurrent = pendingResolve;
      pendingResolve = null;
      pendingPromise = null;
      resolveCurrent?.();  // any awaiter sees an immediate resolve (no save happened)
    },
  };
}
```

**Semantics:**
- `schedule` replaces any pending snapshot and resets the debounce timer.
- `flush` resolves once the most recently scheduled save has run (or no-op if nothing pending).
- `cancel` drops the pending snapshot; any in-flight `flush()` awaiter resolves immediately without a save.
- `onError` receives rejections from `save`. Default: re-throw asynchronously so the host's unhandled-rejection handler sees it.
- No DOM/Node deps. Uses `setTimeout`/`clearTimeout` only.

### 4. Public-API surface (`packages/core/src/index.ts`)

```ts
export * from './types.js';
export * from './parser.js';
export * from './formatter.js';
export * from './reviewClient.js';
export {
  computeContentHash,
  DEFAULT_SESSION_DIR,
  FileSessionStore,
  type FileSessionStoreOptions,
  type SessionData,
  type SessionMeta,
  type SessionStore,
} from './session.js';
export {
  createAutosave,
  type Autosave,
  type AutosaveOptions,
} from './autosave.js';
```

Removed exports: `saveSession`, `loadSession`, `clearSession`, `listSessions`, `getSessionDir`, `SessionLoadResult`. Bump `@plan-review/core` minor (still `0.0.x` → call this `0.1.0`).

### 5. CLI migration

`packages/cli` is the only consumer of the removed module-level functions today. Identify each call site (search for `saveSession\|loadSession\|clearSession\|listSessions\|getSessionDir` under `packages/cli/`) and rewire through a single shared instance:

```ts
// packages/cli/src/server.ts (or wherever HTTP routes live — locate during impl)
import { FileSessionStore, DEFAULT_SESSION_DIR } from '@plan-review/core';
const store = new FileSessionStore({ dir: DEFAULT_SESSION_DIR });
// pass `store` to HTTP handlers (/api/session GET/POST), --resume flag handler, --fresh flag handler, etc.
```

CLI keeps its existing `key = resolve(planPath)` convention so user sessions persist across the upgrade (same filename hash).

For `list()` callers that need staleness vs current-content: re-implement the re-read-planPath-and-compare logic in the CLI layer (it was always a CLI concern — see Approach §2 notes).

### 6. Browser-app migration

`packages/browser-app/src/App.tsx`: replace the in-component debounce + beforeunload effects with `createAutosave`:

```ts
import { createAutosave, type Autosave } from '@plan-review/core';

// inside App component:
const autosave = useMemo<Autosave<{ comments: ReviewComment[]; activeSection: string | null; contentHash: string }>>(
  () => createAutosave({
    delayMs: 500,
    save: (snap) => client.saveSession(snap),
  }),
  [client],
);

useEffect(() => {
  if (contentHash === null) return;
  if (!initialLoadDone.current) {
    initialLoadDone.current = comments.length > 0 || doc !== null;
    if (!initialLoadDone.current) return;
  }
  autosave.schedule({ comments, activeSection, contentHash });
}, [autosave, comments, activeSection, contentHash, doc]);

useEffect(() => {
  const flush = () => { autosave.flush().catch(() => {}); };
  window.addEventListener('beforeunload', flush);
  return () => window.removeEventListener('beforeunload', flush);
}, [autosave]);
```

Same user-visible behavior; the debounce logic is now reusable.

### 7. Tests

`packages/core/tests/session.test.ts` — rewrite around `FileSessionStore`:

- Round-trip: `save(key, data)` then `load(key)` returns equal `SessionData` (with `Date` objects restored on comment timestamps).
- `load(key)` returns `null` for missing file.
- `load(key)` auto-deletes corrupt JSON file and returns null; second `load(key)` confirms file gone.
- `clear(key)` removes the file; second `clear(key)` is a no-op (no throw).
- `list()` returns empty array if dir doesn't exist.
- `list()` returns one entry per saved key, with correct `commentCount` and `lastModified`.
- `list()` skips corrupt JSON without throwing.
- Use `mkdtemp(tmpdir(), 'plan-review-session-')` per test for isolation.

`packages/core/tests/autosave.test.ts` — new, fake timers:

- `schedule` then advance `delayMs` → `save` called once with the snapshot.
- Two `schedule` calls within `delayMs` → `save` called once with the second (latest) snapshot.
- `flush` after `schedule` resolves once `save` completes; advances no timers needed.
- `flush` with nothing pending resolves immediately.
- `cancel` drops the pending snapshot; advancing timers triggers no `save`.
- `cancel` resolves any awaited `flush()` immediately.
- `save` rejection with `onError` set → `onError` receives the error, `flush` still resolves.
- `save` rejection without `onError` → error surfaces asynchronously (test via `process.once('uncaughtException', ...)` or vitest's unhandled-rejection capture).

`packages/cli/tests/` — update existing session HTTP-handler tests to inject a `FakeSessionStore` (in-memory `Map`). Keep one integration test against a real `FileSessionStore` writing to a temp dir.

`packages/browser-app/tests/` — existing `App.tsx` tests should pass unchanged (autosave behavior is identical). Optionally add: `beforeunload` event triggers `client.saveSession` exactly once even if a debounce was pending.

`packages/core/tests/public-api.test.ts` — new. Imports every name from `@plan-review/core` and asserts presence + type shape. Failures here mean the public surface changed unintentionally.

### 8. Documentation

- Update `packages/core/README.md` (if present) with the new public API examples (CLI consumer pattern + autosave pattern).
- Add a short `MIGRATION.md` at repo root or under `docs/` listing the removed symbols and their replacements. One example per removed function.
- Update any spec/docs referencing `saveSession`/`loadSession` to point at `FileSessionStore`.

---

## Resolved Decisions

- [x] **API shape** — class-based `SessionStore` interface + `FileSessionStore` impl.
- [x] **`dir` default** — required, no implicit homedir fallback. Consumers explicitly pass `DEFAULT_SESSION_DIR` for legacy location.
- [x] **`fs` strategy** — `fs/promises` async throughout.
- [x] **Error policy on `save`** — throws; consumers wrap in try/catch if they want silent failure.
- [x] **Corrupt-file handling on `load`** — auto-delete preserved. Reason: session dir is hidden under `~/.plan-review/`; users have no other cleanup path.
- [x] **Module-level functions** — removed (not deprecated). Fail loud at type-check time on upgrade.
- [x] **Disk format** — JSON shape unchanged. Existing `~/.plan-review/sessions/*.json` keep working with new `FileSessionStore({ dir: DEFAULT_SESSION_DIR })`.
- [x] **Autosave helper** — shipped from core, framework-neutral, no DOM/Node deps.
- [x] **Staleness check** — moves out of core's `list()` into CLI layer (was always a CLI concern; Forge will compute its own staleness against its own artifacts).
- [x] **Version bump** — `0.0.x → 0.1.0`. Major-ish surface change marked by minor bump while still pre-1.0.

---

## Out of Scope

- **Renaming `SessionData.planPath`** to something more neutral (`SessionData.key` or similar). Would force a disk-format break for existing users. Defer until the next breaking-format pass.
- **CLI command for cleaning up the session dir** (e.g. `plan-review sessions prune`). Mentioned in discussion as the cure for a no-auto-delete policy; we kept auto-delete, so this command isn't urgent. Logged as a tech-debt candidate.
- **IndexedDB / BroadcastChannel backends** for browser-only contexts. The `SessionStore` interface supports them; nobody needs one today.
- **Migration tooling** for users with bespoke session dirs. Not a real population today.
- **`@plan-review/react` adapter package**. The autosave helper is framework-neutral and consumers wire it themselves. A React-hook wrapper would be ~10 lines; skip until two React consumers exist (Forge will be the first; revisit when the second appears).
