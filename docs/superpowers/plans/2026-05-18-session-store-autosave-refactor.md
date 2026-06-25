# Session Store Autosave Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded module-level session persistence with injectable session stores, extract reusable autosave behavior, and publish `@plan-review/core` plus a new `@plan-review/react` adapter at `0.1.0`.

**Architecture:** `@plan-review/core` owns framework-neutral primitives: `FileSessionStore`, `SessionStore`, `computeContentHash`, and `createAutosave`. CLI and VS Code explicitly construct a `FileSessionStore({ dir: DEFAULT_SESSION_DIR })` and keep stale-session decisions in host code. Browser-app consumes core autosave directly; React consumers use `@plan-review/react` hooks.

**Tech Stack:** TypeScript ESM, npm workspaces, Vitest, Preact browser-app, React peer adapter, Node `fs/promises`.

---

## Current-State Notes

- Repo-local Git email was set to `alvaroaaac@gmail.com` before this plan was written.
- Current branch state is `main...origin/main [ahead 5]`, with untracked `docs/ultra-review.zip`. Do not touch the zip while implementing this plan.
- The original spec says the VS Code extension is unaffected, but the current code imports `loadSession`, `saveSession`, and tests `clearSession` directly. This plan includes the VS Code migration.

## File Map

- Modify `packages/core/src/session.ts`: replace sync module-level functions with async `SessionStore` interface and `FileSessionStore` class.
- Create `packages/core/src/autosave.ts`: framework-neutral debounce/flush/cancel helper.
- Modify `packages/core/src/index.ts`: export only the new public session/autosave API.
- Replace `packages/core/tests/session.test.ts`: unit tests for `FileSessionStore`.
- Replace `packages/core/tests/session-integration.test.ts`: integration tests against temp `FileSessionStore`.
- Create `packages/core/tests/autosave.test.ts`: fake-timer tests for `createAutosave`.
- Create `packages/core/tests/public-api.test.ts`: intentional public API guard.
- Modify `packages/cli/src/index.ts`: construct a default store, replace removed function calls, and compute staleness for `sessions`.
- Modify `packages/cli/src/browser-review.ts`: save through injected/default `SessionStore`.
- Modify `packages/cli/src/server/routes.ts`: accept async `onSessionSave`.
- Modify CLI tests under `packages/cli/tests/**`: adapt to async saves and current session shape.
- Modify `packages/vscode-extension/src/messageHandlers.ts`: accept injectable/default `SessionStore`.
- Modify `packages/vscode-extension/test/unit/messageHandlers.saveSession.test.ts`: test through temp `FileSessionStore`.
- Modify `packages/browser-app/src/App.tsx`: replace local debounce effects with `createAutosave`.
- Modify `packages/browser-app/tests/App.test.tsx`: keep existing autosave assertions and add unload-pending coverage.
- Create `packages/react/package.json`, `packages/react/tsconfig.json`, `packages/react/src/index.ts`, `packages/react/src/useAutosave.ts`, and tests.
- Modify `package.json`, `package-lock.json`, `packages/core/package.json`, `packages/cli/package.json`: publishing metadata and workspace deps.
- Create/update docs: `packages/core/README.md`, `packages/react/README.md`, `docs/MIGRATION-0.1.0.md`.

---

### Task 1: Core SessionStore API

**Files:**
- Modify: `packages/core/src/session.ts`
- Replace: `packages/core/tests/session.test.ts`

- [ ] **Step 1: Write failing tests for `FileSessionStore`**

Replace `packages/core/tests/session.test.ts` with:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ReviewComment } from '../src/types.js';
import {
  computeContentHash,
  DEFAULT_SESSION_DIR,
  FileSessionStore,
  type SessionData,
} from '../src/session.js';

let dir: string;

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    sectionId: 'task-1',
    text: 'Looks good',
    timestamp: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    version: 1,
    planPath: '/tmp/plan.md',
    contentHash: 'sha256:abc123',
    comments: [makeComment()],
    activeSection: 'task-1',
    lastModified: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

async function filesInSessionDir(): Promise<string[]> {
  return (await readdir(dir)).filter((file) => file.endsWith('.json'));
}

describe('FileSessionStore', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plan-review-session-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('exports the legacy default session directory constant without creating it', () => {
    expect(DEFAULT_SESSION_DIR).toContain('.plan-review');
    expect(DEFAULT_SESSION_DIR).toContain('sessions');
  });

  it('computes deterministic sha256 content hashes', () => {
    expect(computeContentHash('hello')).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(computeContentHash('same')).toBe(computeContentHash('same'));
    expect(computeContentHash('one')).not.toBe(computeContentHash('two'));
  });

  it('round-trips session data and restores Date timestamps', async () => {
    const store = new FileSessionStore({ dir });
    const data = makeSession({ comments: [makeComment({ text: 'My review' })] });

    await store.save('/tmp/plan.md', data);
    const loaded = await store.load('/tmp/plan.md');

    expect(loaded).toMatchObject({
      version: 1,
      planPath: '/tmp/plan.md',
      contentHash: 'sha256:abc123',
      activeSection: 'task-1',
      lastModified: '2026-01-15T10:00:00.000Z',
    });
    expect(loaded?.comments[0].text).toBe('My review');
    expect(loaded?.comments[0].timestamp).toBeInstanceOf(Date);
    expect(loaded?.comments[0].timestamp.toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });

  it('returns null when loading a missing session', async () => {
    const store = new FileSessionStore({ dir });
    await expect(store.load('/tmp/missing.md')).resolves.toBeNull();
  });

  it('uses the opaque key hash and preserves legacy 16-character filenames by default', async () => {
    const store = new FileSessionStore({ dir });
    await store.save('/tmp/plan.md', makeSession());

    const files = await filesInSessionDir();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{16}\.json$/);
  });

  it('supports a custom key hash length', async () => {
    const store = new FileSessionStore({ dir, keyHashLength: 8 });
    await store.save('forge:FUL-42:spec', makeSession({ planPath: 'forge:FUL-42:spec' }));

    const files = await filesInSessionDir();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{8}\.json$/);
  });

  it('throws when saving fails', async () => {
    const fileInsteadOfDir = join(dir, 'not-a-directory');
    await writeFile(fileInsteadOfDir, 'x');
    const store = new FileSessionStore({ dir: fileInsteadOfDir });

    await expect(store.save('/tmp/plan.md', makeSession())).rejects.toThrow();
  });

  it('auto-deletes corrupt JSON on load and returns null', async () => {
    const store = new FileSessionStore({ dir });
    await store.save('/tmp/plan.md', makeSession());
    const [file] = await filesInSessionDir();
    const filePath = join(dir, file);
    await writeFile(filePath, '{{{CORRUPT JSON!!!');

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(store.load('/tmp/plan.md')).resolves.toBeNull();
    expect(existsSync(filePath)).toBe(false);
    await expect(store.load('/tmp/plan.md')).resolves.toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Corrupt session file'));
    consoleSpy.mockRestore();
  });

  it('clears an existing session and treats missing sessions as a no-op', async () => {
    const store = new FileSessionStore({ dir });
    await store.save('/tmp/plan.md', makeSession());
    expect(await filesInSessionDir()).toHaveLength(1);

    await store.clear('/tmp/plan.md');
    expect(await filesInSessionDir()).toHaveLength(0);
    await expect(store.clear('/tmp/plan.md')).resolves.toBeUndefined();
  });

  it('lists empty when the session directory does not exist', async () => {
    const missingDir = join(dir, 'missing');
    const store = new FileSessionStore({ dir: missingDir });

    await expect(store.list()).resolves.toEqual([]);
  });

  it('lists saved sessions with metadata but no staleness', async () => {
    const store = new FileSessionStore({ dir });
    await store.save('/tmp/one.md', makeSession({
      planPath: '/tmp/one.md',
      comments: [makeComment(), makeComment({ text: 'Second' })],
    }));
    await store.save('/tmp/two.md', makeSession({
      planPath: '/tmp/two.md',
      comments: [],
      activeSection: null,
      lastModified: '2026-01-16T10:00:00.000Z',
    }));

    await expect(store.list()).resolves.toEqual(expect.arrayContaining([
      { key: '/tmp/one.md', commentCount: 2, lastModified: '2026-01-15T10:00:00.000Z' },
      { key: '/tmp/two.md', commentCount: 0, lastModified: '2026-01-16T10:00:00.000Z' },
    ]));
  });

  it('skips non-json and corrupt files while listing', async () => {
    const store = new FileSessionStore({ dir });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'notes.txt'), 'ignore me');
    await writeFile(join(dir, 'corrupt.json'), '{{NOPE');
    await store.save('/tmp/plan.md', makeSession());

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sessions = await store.list();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].key).toBe('/tmp/plan.md');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping corrupt session file'));
    consoleSpy.mockRestore();
  });

  it('stores sessions for two opaque keys independently', async () => {
    const store = new FileSessionStore({ dir });
    await store.save('forge:FUL-1', makeSession({ planPath: 'forge:FUL-1', comments: [makeComment({ text: 'A' })] }));
    await store.save('forge:FUL-2', makeSession({ planPath: 'forge:FUL-2', comments: [makeComment({ text: 'B' })] }));

    expect((await store.load('forge:FUL-1'))?.comments[0].text).toBe('A');
    expect((await store.load('forge:FUL-2'))?.comments[0].text).toBe('B');
    expect(await store.list()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the core session tests and verify RED**

Run:

```bash
npm test -w @plan-review/core -- packages/core/tests/session.test.ts
```

Expected: FAIL because `DEFAULT_SESSION_DIR`, `FileSessionStore`, and the new methods do not exist yet.

- [ ] **Step 3: Implement `SessionStore` and `FileSessionStore`**

Replace `packages/core/src/session.ts` with:

```ts
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  dir: string;
  keyHashLength?: number;
}

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
    const path = this.filePath(key);
    if (!existsSync(path)) return null;

    let raw: string;
    try {
      raw = await readFile(path, 'utf-8');
    } catch {
      return null;
    }

    let data: SessionData;
    try {
      data = JSON.parse(raw) as SessionData;
    } catch {
      console.warn(`[plan-review] Corrupt session file, removing: ${path}`);
      try {
        await unlink(path);
      } catch {
        // best-effort cleanup
      }
      return null;
    }

    return {
      ...data,
      comments: data.comments.map((comment) => ({
        ...comment,
        timestamp: new Date(comment.timestamp),
      })),
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
      const path = join(this.dir, file);
      try {
        const data = JSON.parse(await readFile(path, 'utf-8')) as SessionData;
        results.push({
          key: data.planPath,
          commentCount: data.comments.length,
          lastModified: data.lastModified,
        });
      } catch {
        console.warn(`[plan-review] Skipping corrupt session file: ${path}`);
      }
    }

    return results;
  }
}
```

- [ ] **Step 4: Run the core session tests and verify GREEN**

Run:

```bash
npm test -w @plan-review/core -- packages/core/tests/session.test.ts
```

Expected: PASS.

---

### Task 2: Core Autosave Helper

**Files:**
- Create: `packages/core/src/autosave.ts`
- Create: `packages/core/tests/autosave.test.ts`

- [ ] **Step 1: Write failing autosave tests**

Create `packages/core/tests/autosave.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAutosave } from '../src/autosave.js';

describe('createAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves a scheduled snapshot after the debounce delay', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave<string>({ delayMs: 500, save });

    autosave.schedule('first');
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('first');
  });

  it('coalesces multiple schedules and saves only the latest snapshot', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave<string>({ delayMs: 500, save });

    autosave.schedule('first');
    await vi.advanceTimersByTimeAsync(250);
    autosave.schedule('second');
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('second');
  });

  it('flushes a pending snapshot immediately and resolves after save completes', async () => {
    let release!: () => void;
    const save = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const autosave = createAutosave<string>({ delayMs: 500, save });

    autosave.schedule('pending');
    const flushed = autosave.flush();
    expect(save).toHaveBeenCalledWith('pending');

    let resolved = false;
    flushed.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    release();
    await flushed;
    expect(resolved).toBe(true);
  });

  it('flush resolves immediately when nothing is pending', async () => {
    const autosave = createAutosave<string>({ delayMs: 500, save: vi.fn() });
    await expect(autosave.flush()).resolves.toBeUndefined();
  });

  it('cancel drops the pending snapshot', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave<string>({ delayMs: 500, save });

    autosave.schedule('pending');
    autosave.cancel();
    await vi.advanceTimersByTimeAsync(500);

    expect(save).not.toHaveBeenCalled();
  });

  it('cancel resolves any waiting flush without saving', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave<string>({ delayMs: 500, save });

    autosave.schedule('pending');
    const flushed = autosave.flush();
    autosave.cancel();

    await expect(flushed).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it('routes save errors through onError and still resolves flush', async () => {
    const err = new Error('save failed');
    const onError = vi.fn();
    const autosave = createAutosave<string>({
      delayMs: 500,
      save: vi.fn().mockRejectedValue(err),
      onError,
    });

    autosave.schedule('pending');
    await expect(autosave.flush()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(err);
  });

  it('surfaces save errors asynchronously when onError is omitted', async () => {
    const err = new Error('save failed');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const autosave = createAutosave<string>({
      delayMs: 500,
      save: vi.fn().mockRejectedValue(err),
    });

    autosave.schedule('pending');
    await autosave.flush();

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
  });
});
```

- [ ] **Step 2: Run autosave tests and verify RED**

Run:

```bash
npm test -w @plan-review/core -- packages/core/tests/autosave.test.ts
```

Expected: FAIL because `packages/core/src/autosave.ts` does not exist.

- [ ] **Step 3: Implement `createAutosave`**

Create `packages/core/src/autosave.ts`:

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
  let pendingResolve: (() => void) | null = null;
  let pendingPromise: Promise<void> | null = null;
  let inFlightPromise: Promise<void> | null = null;

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

    inFlightPromise = opts.save(snapshot).catch((err) => {
      if (opts.onError) {
        opts.onError(err);
      } else {
        setTimeout(() => {
          throw err;
        }, 0);
      }
    }).finally(() => {
      resolveCurrent?.();
      inFlightPromise = null;
    });

    await inFlightPromise;
  }

  return {
    schedule(snapshot: T): void {
      pendingSnapshot = snapshot;
      ensurePromise();
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        void fire();
      }, opts.delayMs);
    },
    flush(): Promise<void> {
      if (timer === null && pendingSnapshot === null) return inFlightPromise ?? Promise.resolve();
      if (timer !== null) clearTimeout(timer);
      const promise = ensurePromise();
      void fire();
      return promise;
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pendingSnapshot = null;
      const resolveCurrent = pendingResolve;
      pendingResolve = null;
      pendingPromise = null;
      resolveCurrent?.();
    },
  };
}
```

- [ ] **Step 4: Run autosave tests and verify GREEN**

Run:

```bash
npm test -w @plan-review/core -- packages/core/tests/autosave.test.ts
```

Expected: PASS.

---

### Task 3: Core Public API and Integration Tests

**Files:**
- Modify: `packages/core/src/index.ts`
- Replace: `packages/core/tests/session-integration.test.ts`
- Create: `packages/core/tests/public-api.test.ts`

- [ ] **Step 1: Write failing public API and integration tests**

Replace `packages/core/tests/session-integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileSessionStore,
  computeContentHash,
  type ReviewComment,
  type SessionData,
} from '../src/index.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plan-review-integration-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function session(planPath: string, contentHash: string, comments: ReviewComment[], activeSection: string | null): SessionData {
  return {
    version: 1,
    planPath,
    contentHash,
    comments,
    activeSection,
    lastModified: new Date('2026-01-15T10:00:00.000Z').toISOString(),
  };
}

describe('session integration', () => {
  const planPath = '/tmp/integration-test-plan.md';
  const planContent = '# Test Plan\n\n## Task 1\n\nDo something.';
  const hash = computeContentHash(planContent);

  it('round-trips, detects staleness in host code, and clears', async () => {
    const store = new FileSessionStore({ dir });
    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'Fix this', timestamp: new Date() },
      { sectionId: '1.2', text: 'Check that', timestamp: new Date() },
    ];

    await store.save(planPath, session(planPath, hash, comments, '1.1'));

    const result = await store.load(planPath);
    expect(result).not.toBeNull();
    expect(result!.contentHash === hash).toBe(true);
    expect(result!.comments).toHaveLength(2);
    expect(result!.activeSection).toBe('1.1');

    const staleResult = await store.load(planPath);
    expect(staleResult!.contentHash !== computeContentHash('modified plan')).toBe(true);

    const sessions = await store.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].commentCount).toBe(2);

    await store.clear(planPath);
    expect(await store.load(planPath)).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });

  it('overwrites previous session for the same key', async () => {
    const store = new FileSessionStore({ dir });
    await store.save(planPath, session(planPath, hash, [{ sectionId: '1.1', text: 'First', timestamp: new Date() }], null));
    await store.save(planPath, session(planPath, hash, [
      { sectionId: '1.1', text: 'First', timestamp: new Date() },
      { sectionId: '1.2', text: 'Second', timestamp: new Date() },
    ], '1.2'));

    const result = await store.load(planPath);
    expect(result!.comments).toHaveLength(2);
    expect(result!.activeSection).toBe('1.2');
  });
});
```

Create `packages/core/tests/public-api.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as core from '../src/index.js';

describe('@plan-review/core public API', () => {
  it('exports session store and autosave APIs', () => {
    expect(core.computeContentHash).toEqual(expect.any(Function));
    expect(core.DEFAULT_SESSION_DIR).toEqual(expect.any(String));
    expect(core.FileSessionStore).toEqual(expect.any(Function));
    expect(core.createAutosave).toEqual(expect.any(Function));
  });

  it('does not export removed module-level session helpers', () => {
    expect('saveSession' in core).toBe(false);
    expect('loadSession' in core).toBe(false);
    expect('clearSession' in core).toBe(false);
    expect('listSessions' in core).toBe(false);
    expect('getSessionDir' in core).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -w @plan-review/core -- packages/core/tests/session-integration.test.ts packages/core/tests/public-api.test.ts
```

Expected: FAIL because `createAutosave` is not exported and removed helpers are still exported by `export * from './session.js'` until the index file is narrowed.

- [ ] **Step 3: Narrow core exports**

Replace `packages/core/src/index.ts`:

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

- [ ] **Step 4: Run core tests and typecheck**

Run:

```bash
npm test -w @plan-review/core
npm run typecheck -w @plan-review/core
```

Expected: PASS for core only.

---

### Task 4: CLI Session Migration

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/browser-review.ts`
- Modify: `packages/cli/src/server/routes.ts`
- Modify: `packages/cli/tests/index.test.ts`
- Modify: `packages/cli/tests/server/routes.test.ts`

- [ ] **Step 1: Write failing CLI tests for store-backed behavior**

In `packages/cli/tests/index.test.ts`, replace the existing `sessions subcommand runs without error` test with this narrower no-session assertion:

```ts
it('sessions subcommand runs without error and prints the default session dir', () => {
  const result = runCli(['sessions']);
  expect(result.status).toBe(0);
  const output = result.stdout + result.stderr;
  expect(output).toContain('No saved sessions.');
  expect(output).toContain('.plan-review/sessions');
});
```

In `packages/cli/tests/server/routes.test.ts`, change the `/api/session` test to expect async handler support:

```ts
it('PUT /api/session awaits async onSessionSave before responding', async () => {
  const onSessionSave = vi.fn().mockResolvedValue(undefined);
  const { server, port } = await startTestServer({
    getDocument: () => mockDoc,
    onSubmit: vi.fn(),
    onSessionSave,
    getAssetHtml: () => '<html></html>',
  });

  const comments: ReviewComment[] = [
    { sectionId: '1.1', text: 'Save me', timestamp: new Date('2026-04-13') },
  ];

  const res = await fetch(`http://localhost:${port}/api/session`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comments, activeSection: '1.1' }),
  });

  expect(res.status).toBe(200);
  expect(onSessionSave).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ sectionId: '1.1', text: 'Save me' }),
  ]), '1.1');

  await stopTestServer(server);
});
```

- [ ] **Step 2: Run CLI tests and verify RED**

Run:

```bash
npm test -w plan-review -- packages/cli/tests/server/routes.test.ts packages/cli/tests/index.test.ts
npm run typecheck -w plan-review
```

Expected: FAIL because CLI imports removed core helpers and route `onSessionSave` is sync.

- [ ] **Step 3: Add CLI session helpers inside `packages/cli/src/index.ts`**

Update imports:

```ts
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import chalk from 'chalk';
import {
  parse,
  formatReview,
  FileSessionStore,
  DEFAULT_SESSION_DIR,
  computeContentHash,
  type SessionData,
  type SessionStore,
} from '@plan-review/core';
```

Add near the top after `program`:

```ts
const sessionStore = new FileSessionStore({ dir: DEFAULT_SESSION_DIR });

interface RestoredSession {
  comments: PlanDocument['comments'];
  activeSection: string | null;
  stale: boolean;
}

async function saveReviewSession(
  store: SessionStore,
  planPath: string,
  contentHash: string,
  comments: PlanDocument['comments'],
  activeSection: string | null,
): Promise<void> {
  const data: SessionData = {
    version: 1,
    planPath,
    contentHash,
    comments,
    activeSection,
    lastModified: new Date().toISOString(),
  };
  await store.save(planPath, data);
}

async function loadReviewSession(
  store: SessionStore,
  planPath: string,
  contentHash: string,
): Promise<RestoredSession | null> {
  const data = await store.load(planPath);
  if (!data) return null;
  return {
    comments: data.comments,
    activeSection: data.activeSection,
    stale: data.contentHash !== contentHash,
  };
}

async function listReviewSessions(store: SessionStore): Promise<Array<{
  planPath: string;
  commentCount: number;
  lastModified: string;
  stale: boolean | null;
}>> {
  const sessions = await store.list();
  return sessions.map((session) => {
    let stale: boolean | null;
    if (!existsSync(session.key)) {
      stale = null;
    } else {
      try {
        const currentContent = readFileSync(session.key, 'utf-8');
        const currentHash = computeContentHash(currentContent);
        const stored = sessions.find((candidate) => candidate.key === session.key);
        stale = stored ? currentHash !== currentHash && false : null;
      } catch {
        stale = null;
      }
    }
    return {
      planPath: session.key,
      commentCount: session.commentCount,
      lastModified: session.lastModified,
      stale,
    };
  });
}
```

Immediately correct the `stale` implementation by loading each session data instead of comparing metadata:

```ts
async function listReviewSessions(store: SessionStore): Promise<Array<{
  planPath: string;
  commentCount: number;
  lastModified: string;
  stale: boolean | null;
}>> {
  const sessions = await store.list();
  const results: Array<{
    planPath: string;
    commentCount: number;
    lastModified: string;
    stale: boolean | null;
  }> = [];

  for (const session of sessions) {
    const data = await store.load(session.key);
    let stale: boolean | null = null;
    if (data && existsSync(session.key)) {
      try {
        stale = computeContentHash(readFileSync(session.key, 'utf-8')) !== data.contentHash;
      } catch {
        stale = null;
      }
    }
    results.push({
      planPath: session.key,
      commentCount: session.commentCount,
      lastModified: session.lastModified,
      stale,
    });
  }

  return results;
}
```

- [ ] **Step 4: Replace CLI call sites**

Make the `sessions` command action async and use the explicit dir:

```ts
.action(async () => {
  const sessions = await listReviewSessions(sessionStore);
  const dir = DEFAULT_SESSION_DIR;
  if (sessions.length === 0) {
    console.error(chalk.dim(`No saved sessions. (${dir})`));
    process.exit(0);
  }
  console.error(chalk.bold(`Saved review sessions (${dir}):\n`));
  for (const s of sessions) {
    const age = formatRelativeTime(s.lastModified);
    let status = '';
    if (s.stale === true) status = chalk.yellow(' | plan file changed since last review');
    else if (s.stale === null) status = chalk.red(' | plan file not found');
    console.error(`  ${s.planPath}`);
    console.error(chalk.dim(`    ${s.commentCount} comment${s.commentCount !== 1 ? 's' : ''} | last modified ${age}${status}\n`));
  }
});
```

Inside `run`:

```ts
if (opts.fresh) {
  await sessionStore.clear(absPath);
} else {
  const session = await loadReviewSession(sessionStore, absPath, contentHash);
  // keep the existing resume/stale prompt branches unchanged
}
```

Replace stale rejection and final cleanup:

```ts
await sessionStore.clear(absPath);
```

Replace CLI-mode autosave:

```ts
const onCommentChange = absPath
  ? () => {
      void saveReviewSession(sessionStore, absPath, contentHash, doc.comments, null);
    }
  : undefined;
```

- [ ] **Step 5: Migrate browser review save**

In `packages/cli/src/browser-review.ts`, replace the core `saveSession` import with:

```ts
import {
  DEFAULT_SESSION_DIR,
  FileSessionStore,
  type ReviewComment,
  type ReviewSubmission,
  type SessionData,
  type SessionStore,
} from '@plan-review/core';
```

Add:

```ts
const defaultSessionStore = new FileSessionStore({ dir: DEFAULT_SESSION_DIR });

async function saveReviewSession(
  store: SessionStore,
  planPath: string,
  contentHash: string,
  comments: ReviewComment[],
  activeSection: string | null,
): Promise<void> {
  const data: SessionData = {
    version: 1,
    planPath,
    contentHash,
    comments,
    activeSection,
    lastModified: new Date().toISOString(),
  };
  await store.save(planPath, data);
}
```

Change the route context callback:

```ts
onSessionSave: absPath
  ? async (comments, activeSection) => {
      await saveReviewSession(defaultSessionStore, absPath, contentHash, comments, activeSection);
    }
  : undefined,
```

- [ ] **Step 6: Make route session save async**

In `packages/cli/src/server/routes.ts`, change:

```ts
onSessionSave?: (comments: ReviewComment[], activeSection: string | null) => void | Promise<void>;
```

Change the `/api/session` `req.on('end', ...)` handler to async:

```ts
req.on('end', async () => {
  if (size > MAX_BODY_SIZE) return;
  try {
    // existing validation unchanged
    await ctx.onSessionSave?.(comments as ReviewComment[], activeSection);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
  }
});
```

- [ ] **Step 7: Run CLI tests and typecheck**

Run:

```bash
npm test -w plan-review
npm run typecheck -w plan-review
```

Expected: PASS. If stale-session tests fail, inspect `listReviewSessions`; the correct comparison is current file hash against `SessionData.contentHash` loaded from the same key.

---

### Task 5: VS Code Extension Session Migration

**Files:**
- Modify: `packages/vscode-extension/src/messageHandlers.ts`
- Modify: `packages/vscode-extension/test/unit/messageHandlers.saveSession.test.ts`

- [ ] **Step 1: Write failing VS Code handler test with injected store**

Replace `packages/vscode-extension/test/unit/messageHandlers.saveSession.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMessageHandlers } from '../../src/messageHandlers.js';
import { computeContentHash, FileSessionStore } from '@plan-review/core';

let tmp: string;
let planPath: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pr-'));
  planPath = join(tmp, 'plan.md');
  await writeFile(planPath, '# P\n## S\nbody\n');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('messageHandlers.saveSession', () => {
  it('persists comments via injected SessionStore so loadDocument restores them', async () => {
    const store = new FileSessionStore({ dir: join(tmp, 'sessions') });
    const handlers = createMessageHandlers({ sessionStore: store });
    const contentHash = computeContentHash('# P\n## S\nbody\n');

    await handlers.saveSession({
      planFsPath: planPath,
      contentHash,
      comments: [{ sectionId: 's', text: 'hi', timestamp: new Date() }],
      activeSection: 's',
    });

    const loaded = await handlers.loadDocument({ planFsPath: planPath });
    expect(loaded.restoredSession?.comments).toHaveLength(1);
    expect(loaded.restoredSession?.comments[0].text).toBe('hi');
    expect(loaded.restoredSession?.activeSection).toBe('s');
    expect(loaded.restoredSession?.stale).toBe(false);
  });
});
```

- [ ] **Step 2: Run VS Code test and verify RED**

Run:

```bash
npm test -w @plan-review/vscode-extension -- packages/vscode-extension/test/unit/messageHandlers.saveSession.test.ts
```

Expected: FAIL because `createMessageHandlers` does not accept `sessionStore` and imports removed helpers.

- [ ] **Step 3: Implement injected/default session store**

In `packages/vscode-extension/src/messageHandlers.ts`, replace session imports with:

```ts
import {
  parse,
  computeContentHash,
  DEFAULT_SESSION_DIR,
  FileSessionStore,
  type PlanDocument,
  type ReviewComment,
  type ReviewVerdict,
  type SessionData,
  type SessionStore,
} from '@plan-review/core';
```

Add before `createMessageHandlers`:

```ts
const defaultSessionStore = new FileSessionStore({ dir: DEFAULT_SESSION_DIR });

function restoredSession(data: SessionData | null, contentHash: string): {
  comments: ReviewComment[];
  activeSection: string | null;
  stale: boolean;
} | undefined {
  if (!data) return undefined;
  return {
    comments: data.comments,
    activeSection: data.activeSection,
    stale: data.contentHash !== contentHash,
  };
}
```

Extend deps:

```ts
export function createMessageHandlers(deps?: {
  sessionStore?: SessionStore;
  submit?: (args: {
    planFsPath: string;
    document: PlanDocument;
    comments: ReviewComment[];
    verdict: ReviewVerdict;
    summary: string;
  }) => Promise<{ submitted: boolean }>;
}): MessageHandlers {
  const sessionStore = deps?.sessionStore ?? defaultSessionStore;
```

Replace load/save bodies:

```ts
const restored = await sessionStore.load(planFsPath);
return { document, contentHash, restoredSession: restoredSession(restored, contentHash) };
```

```ts
const data: SessionData = {
  version: 1,
  planPath: planFsPath,
  contentHash,
  comments,
  activeSection,
  lastModified: new Date().toISOString(),
};
await sessionStore.save(planFsPath, data);
```

- [ ] **Step 4: Run VS Code tests and typecheck**

Run:

```bash
npm test -w @plan-review/vscode-extension
npm run typecheck -w @plan-review/vscode-extension
```

Expected: PASS.

---

### Task 6: Browser-App Autosave Migration

**Files:**
- Modify: `packages/browser-app/src/App.tsx`
- Modify: `packages/browser-app/tests/App.test.tsx`

- [ ] **Step 1: Add failing browser-app unload-pending autosave test**

In `packages/browser-app/tests/App.test.tsx`, add this test after `calls client.saveSession after adding a comment`:

```ts
it('flushes the pending debounced save on beforeunload', async () => {
  vi.useFakeTimers();
  const client = new FakeReviewClient({ document: mockPlanDoc, contentHash: 'hash-abc' });

  render(<App client={client} />);
  await waitFor(() => screen.getByText('Test Plan'));

  const links = screen.getAllByText('Add comment to entire section');
  fireEvent.click(links[0]);
  const textarea = screen.getByPlaceholderText('Add a comment...');
  fireEvent.input(textarea, { target: { value: 'Flush me' } });
  fireEvent.click(screen.getByText('Add'));
  await waitFor(() => expect(screen.getByText('Flush me')).toBeTruthy());

  expect(client.sessionSaves).toHaveLength(0);
  window.dispatchEvent(new Event('beforeunload'));
  await Promise.resolve();

  expect(client.sessionSaves).toHaveLength(1);
  expect(client.sessionSaves[0]).toMatchObject({ contentHash: 'hash-abc' });
  expect(client.sessionSaves[0].comments[0].text).toBe('Flush me');
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run browser-app test and verify RED or baseline**

Run:

```bash
npm test -w @plan-review/browser-app -- packages/browser-app/tests/App.test.tsx
```

Expected before implementation: existing code may PASS this behavior. If it passes, keep it as a regression guard and continue; the refactor’s RED is covered by type failure once `createAutosave` import is added.

- [ ] **Step 3: Replace local debounce with `createAutosave`**

In `packages/browser-app/src/App.tsx`, update imports:

```ts
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import type {
  Autosave,
  PlanDocument,
  ReviewComment,
  LineAnchor,
  ReviewClient,
  ReviewVerdict,
} from '@plan-review/core';
import { createAutosave } from '@plan-review/core';
```

Add near the component body after refs:

```ts
type AutosaveSnapshot = {
  comments: ReviewComment[];
  activeSection: string | null;
  contentHash: string;
};

const autosave = useMemo<Autosave<AutosaveSnapshot>>(
  () => createAutosave({
    delayMs: 500,
    save: (snapshot) => client.saveSession(snapshot),
  }),
  [client],
);
```

Replace the existing autosave effect:

```ts
useEffect(() => {
  if (!initialLoadDone.current) {
    initialLoadDone.current = comments.length > 0 || doc !== null;
    if (!initialLoadDone.current) return;
  }
  if (contentHash === null) return;
  autosave.schedule({ comments, activeSection, contentHash });
}, [autosave, comments, activeSection, contentHash, doc]);
```

Replace the unload session effect:

```ts
useEffect(() => {
  const flush = () => {
    autosave.flush().catch(() => {});
  };
  window.addEventListener('beforeunload', flush);
  return () => window.removeEventListener('beforeunload', flush);
}, [autosave]);
```

Add cleanup:

```ts
useEffect(() => () => autosave.cancel(), [autosave]);
```

- [ ] **Step 4: Run browser-app tests and typecheck**

Run:

```bash
npm test -w @plan-review/browser-app
npm run typecheck -w @plan-review/browser-app
```

Expected: PASS.

---

### Task 7: React Adapter Package

**Files:**
- Create: `packages/react/package.json`
- Create: `packages/react/tsconfig.json`
- Create: `packages/react/src/index.ts`
- Create: `packages/react/src/useAutosave.ts`
- Create: `packages/react/tests/useAutosave.test.tsx`
- Create: `packages/react/tests/public-api.test.ts`

- [ ] **Step 1: Create failing tests and package skeleton**

Create `packages/react/package.json`:

```json
{
  "name": "@plan-review/react",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@plan-review/core": "*"
  },
  "peerDependencies": {
    "react": ">=18"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.0.0",
    "jsdom": "^29.0.2",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "typescript": "^6.0.2",
    "vitest": "^4.1.4"
  }
}
```

Create `packages/react/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx",
    "types": ["vitest/globals", "jsdom"]
  },
  "include": ["src"],
  "exclude": ["dist", "tests"]
}
```

Create `packages/react/tests/useAutosave.test.tsx`:

```tsx
import React, { useCallback } from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAutosave, useAutosaveSnapshot, useFlushOnUnload } from '../src/index.js';

describe('@plan-review/react autosave hooks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a stable autosave instance when options are stable', () => {
    const seen: unknown[] = [];
    const save = vi.fn().mockResolvedValue(undefined);
    function Probe({ value }: { value: string }) {
      const stableSave = useCallback(save, []);
      seen.push(useAutosave({ delayMs: 500, save: stableSave }));
      return <div>{value}</div>;
    }

    const { rerender } = render(<Probe value="a" />);
    rerender(<Probe value="b" />);

    expect(seen[0]).toBe(seen[1]);
  });

  it('schedules snapshots and coalesces saves', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    function Probe({ snapshot }: { snapshot: string }) {
      const stableSave = useCallback(save, []);
      useAutosaveSnapshot(snapshot, { delayMs: 500, save: stableSave });
      return <div>{snapshot}</div>;
    }

    const { rerender } = render(<Probe snapshot="first" />);
    rerender(<Probe snapshot="second" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('second');
  });

  it('does not schedule when disabled', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    function Probe() {
      const stableSave = useCallback(save, []);
      useAutosaveSnapshot('snapshot', { delayMs: 500, save: stableSave }, { enabled: false });
      return <div>disabled</div>;
    }

    render(<Probe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('cancels pending saves on unmount', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    function Probe() {
      const stableSave = useCallback(save, []);
      useAutosaveSnapshot('snapshot', { delayMs: 500, save: stableSave });
      return <div>mounted</div>;
    }

    const { unmount } = render(<Probe />);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(save).not.toHaveBeenCalled();
  });

  it('flushes on beforeunload and removes listener on unmount', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    function Probe() {
      const stableSave = useCallback(save, []);
      const autosave = useAutosaveSnapshot('snapshot', { delayMs: 500, save: stableSave });
      useFlushOnUnload(autosave);
      return <div>mounted</div>;
    }

    const { unmount } = render(<Probe />);
    window.dispatchEvent(new Event('beforeunload'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledOnce();

    unmount();
    window.dispatchEvent(new Event('beforeunload'));
    expect(save).toHaveBeenCalledOnce();
  });
});
```

Create `packages/react/tests/public-api.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as react from '../src/index.js';

describe('@plan-review/react public API', () => {
  it('exports autosave hooks', () => {
    expect(react.useAutosave).toEqual(expect.any(Function));
    expect(react.useAutosaveSnapshot).toEqual(expect.any(Function));
    expect(react.useFlushOnUnload).toEqual(expect.any(Function));
  });
});
```

- [ ] **Step 2: Run React tests and verify RED**

Run:

```bash
npm test -w @plan-review/react
```

Expected: FAIL because `src/index.ts` and hooks are missing. If npm reports missing workspace dependencies first, run `npm install` once to refresh the lockfile and then rerun.

- [ ] **Step 3: Implement React hooks**

Create `packages/react/src/useAutosave.ts`:

```ts
import { useEffect, useMemo } from 'react';
import {
  createAutosave,
  type Autosave,
  type AutosaveOptions,
} from '@plan-review/core';

export function useAutosave<T>(opts: AutosaveOptions<T>): Autosave<T> {
  const autosave = useMemo(
    () => createAutosave(opts),
    [opts.delayMs, opts.save, opts.onError],
  );
  useEffect(() => () => autosave.cancel(), [autosave]);
  return autosave;
}

export function useAutosaveSnapshot<T>(
  snapshot: T,
  opts: AutosaveOptions<T>,
  options?: { enabled?: boolean },
): Autosave<T> {
  const autosave = useAutosave(opts);
  useEffect(() => {
    if (options?.enabled === false) return;
    autosave.schedule(snapshot);
  }, [autosave, snapshot, options?.enabled]);
  return autosave;
}

export function useFlushOnUnload<T>(autosave: Autosave<T>): void {
  useEffect(() => {
    const handler = () => {
      autosave.flush().catch(() => {});
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [autosave]);
}
```

Create `packages/react/src/index.ts`:

```ts
export { useAutosave, useAutosaveSnapshot, useFlushOnUnload } from './useAutosave.js';
```

- [ ] **Step 4: Run React tests and typecheck**

Run:

```bash
npm test -w @plan-review/react
npm run typecheck -w @plan-review/react
```

Expected: PASS.

---

### Task 8: Publishing Metadata and Dependency Ranges

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/react/package.json`
- Modify: `packages/cli/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add package metadata assertions**

Use these package metadata checks as the RED/GREEN guard:

```bash
node -e "const p=require('./packages/core/package.json'); if (p.private) process.exit(1); if (p.version !== '0.1.0') process.exit(1);"
node -e "const p=require('./packages/react/package.json'); if (p.private) process.exit(1); if (p.version !== '0.1.0') process.exit(1);"
```

- [ ] **Step 2: Verify metadata RED**

Run the two `node -e` checks above.

Expected: FAIL because core is still private/version `0.0.0` and React starts private from the skeleton.

- [ ] **Step 3: Update package metadata**

In `packages/core/package.json`:

```json
{
  "name": "@plan-review/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js"
  },
  "files": ["dist"],
  "publishConfig": {
    "access": "public"
  }
}
```

Keep existing scripts, dependencies, and devDependencies.

In `packages/react/package.json`, remove `"private": true`, add:

```json
"files": ["dist"],
"publishConfig": {
  "access": "public"
}
```

In `packages/cli/package.json`, set:

```json
"@plan-review/core": "^0.1.0"
```

In `package.json`, add:

```json
"release:packages": "npm run build -ws --if-present && npm publish -w @plan-review/core -w @plan-review/react"
```

Run:

```bash
npm install
```

Expected: `package-lock.json` updates for the new workspace and React dev dependencies.

- [ ] **Step 4: Verify package metadata**

Run:

```bash
node -e "const p=require('./packages/core/package.json'); if (p.private) process.exit(1); if (p.version !== '0.1.0') process.exit(1); if (p.publishConfig.access !== 'public') process.exit(1);"
node -e "const p=require('./packages/react/package.json'); if (p.private) process.exit(1); if (p.version !== '0.1.0') process.exit(1); if (p.publishConfig.access !== 'public') process.exit(1);"
npm run typecheck -ws --if-present
```

Expected: PASS.

---

### Task 9: Documentation and Migration Notes

**Files:**
- Create: `packages/core/README.md`
- Create: `packages/react/README.md`
- Create: `docs/MIGRATION-0.1.0.md`
- Modify: any docs found by `rg "saveSession|loadSession|clearSession|listSessions|getSessionDir|SessionLoadResult" README.md docs packages -g '*.md'`

- [ ] **Step 1: Search docs for removed API references**

Run:

```bash
rg "saveSession|loadSession|clearSession|listSessions|getSessionDir|SessionLoadResult" README.md docs packages -g '*.md'
```

Expected before edits: matches in historical specs and any stale README/package docs.

- [ ] **Step 2: Create core README**

Create `packages/core/README.md`:

```md
# @plan-review/core

Framework-neutral parser, formatter, review client types, session persistence, and autosave utilities for plan-review.

## File Sessions

```ts
import {
  DEFAULT_SESSION_DIR,
  FileSessionStore,
  computeContentHash,
  type SessionData,
} from '@plan-review/core';

const store = new FileSessionStore({ dir: DEFAULT_SESSION_DIR });
const planPath = '/path/to/plan.md';
const contentHash = computeContentHash(markdown);

const data: SessionData = {
  version: 1,
  planPath,
  contentHash,
  comments: [],
  activeSection: null,
  lastModified: new Date().toISOString(),
};

await store.save(planPath, data);
const restored = await store.load(planPath);
const stale = restored ? restored.contentHash !== contentHash : false;
```

`FileSessionStore` treats keys as opaque strings. Pass an absolute plan path for legacy CLI-compatible storage, or pass your own stable key for embedded hosts.

## Autosave

```ts
import { createAutosave } from '@plan-review/core';

const autosave = createAutosave({
  delayMs: 500,
  save: (snapshot) => client.saveSession(snapshot),
  onError: (err) => console.warn(err),
});

autosave.schedule({ comments, activeSection, contentHash });
await autosave.flush();
autosave.cancel();
```
```

- [ ] **Step 3: Create React README**

Create `packages/react/README.md`:

```md
# @plan-review/react

React hooks for plan-review autosave behavior.

```tsx
import { useCallback } from 'react';
import { useAutosaveSnapshot, useFlushOnUnload } from '@plan-review/react';

export function ReviewDraft({ client, comments, activeSection, contentHash }) {
  const save = useCallback(
    (snapshot) => client.saveSession(snapshot),
    [client],
  );

  const autosave = useAutosaveSnapshot(
    { comments, activeSection, contentHash },
    { delayMs: 500, save },
    { enabled: contentHash !== null },
  );

  useFlushOnUnload(autosave);
  return null;
}
```

Keep `save` referentially stable with `useCallback`; changing it creates a new autosave instance and cancels the previous pending debounce.
```

- [ ] **Step 4: Create migration guide**

Create `docs/MIGRATION-0.1.0.md`:

```md
# Migrating to @plan-review/core 0.1.0

`@plan-review/core` 0.1.0 removes module-level session helpers. Create an explicit store instead.

## Removed APIs

- `getSessionDir()` -> `DEFAULT_SESSION_DIR`
- `saveSession(planPath, contentHash, comments, activeSection)` -> `store.save(key, sessionData)`
- `loadSession(planPath, currentContentHash)` -> `store.load(key)` plus host-level stale comparison
- `clearSession(planPath)` -> `store.clear(key)`
- `listSessions()` -> `store.list()` plus host-level stale comparison when needed
- `SessionLoadResult` -> host-defined result shape

## Legacy CLI-Compatible Storage

```ts
import {
  DEFAULT_SESSION_DIR,
  FileSessionStore,
  computeContentHash,
  type SessionData,
} from '@plan-review/core';

const store = new FileSessionStore({ dir: DEFAULT_SESSION_DIR });
const key = planPath;
const contentHash = computeContentHash(markdown);

const data: SessionData = {
  version: 1,
  planPath,
  contentHash,
  comments,
  activeSection,
  lastModified: new Date().toISOString(),
};

await store.save(key, data);
const restored = await store.load(key);
const stale = restored ? restored.contentHash !== contentHash : false;
```

Existing files under `~/.plan-review/sessions/*.json` keep loading when callers pass the same absolute plan path key and `DEFAULT_SESSION_DIR`.
```

- [ ] **Step 5: Update stale docs**

For any remaining markdown references from Step 1:

- If the file is an old dated spec, add a note that the shipped API is `FileSessionStore`/`createAutosave`.
- If the file is user-facing README content, replace removed helper examples with the migration guide pattern.

- [ ] **Step 6: Verify docs search is clean enough**

Run:

```bash
rg "saveSession|loadSession|clearSession|listSessions|getSessionDir|SessionLoadResult" README.md docs packages -g '*.md'
```

Expected: only migration-guide removed API references and historical spec references remain.

---

### Task 10: Full Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test -ws --if-present
```

Expected: PASS.

- [ ] **Step 2: Run full typecheck**

Run:

```bash
npm run typecheck -ws --if-present
```

Expected: PASS.

- [ ] **Step 3: Run full build**

Run:

```bash
npm run build
```

Expected: PASS and `dist/` output exists for `@plan-review/core`, `@plan-review/react`, browser-app, CLI, and VS Code extension as applicable.

- [ ] **Step 4: Confirm removed core exports fail at type level**

Run:

```bash
node -e "import('./packages/core/dist/index.js').then((m)=>{ for (const k of ['saveSession','loadSession','clearSession','listSessions','getSessionDir']) if (k in m) process.exit(1); })"
```

Expected: PASS exit code 0 after `npm run build`.

- [ ] **Step 5: Inspect final git diff**

Run:

```bash
git status --short
git diff --stat
git diff -- packages/core/src/session.ts packages/core/src/autosave.ts packages/core/src/index.ts
```

Expected: changes are scoped to this plan plus lockfile updates. `docs/ultra-review.zip` remains untracked and untouched.

---

## Self-Review Checklist

- [ ] Spec coverage: injectable session backend, explicit default dir, async file store, corrupt-file load cleanup, removed module helpers, unchanged disk format, headless autosave, browser migration, React package, publishing metadata, migration docs.
- [ ] Current-code correction: VS Code extension direct session usage is included.
- [ ] TDD coverage: every behavior-changing task starts with a failing test or an explicit baseline/regression test.
- [ ] Type consistency: `SessionStore.save/load/clear/list`, `SessionData`, `SessionMeta.key`, and `Autosave<T>` names match across tasks.
- [ ] Publishing readiness: both public packages build to `dist`, have `files: ["dist"]`, and use `publishConfig.access = "public"`.
