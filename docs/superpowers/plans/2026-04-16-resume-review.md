# Resume Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save and restore review state so closing the terminal or browser doesn't lose work.

**Architecture:** New `src/session.ts` module handles all persistence (save/load/clear/list). CLI (`index.ts`) orchestrates load/resume/clear. Terminal mode saves via callback. Browser mode saves via new `PUT /api/session` endpoint. Sessions stored at `~/.plan-review/sessions/<pathHash>.json`.

**Tech Stack:** Node.js crypto (SHA-256), fs (sync), existing commander CLI, existing Preact browser UI.

**Spec:** `docs/superpowers/specs/2026-04-15-resume-review-design.md`

---

### Task 1: Session Module — Core Functions

**Files:**
- Create: `src/session.ts`
- Create: `tests/session.test.ts`

- [ ] **Step 1: Write failing tests for `computeContentHash` and `getSessionDir`**

```typescript
// tests/session.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We'll override the session dir for testing
let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'plan-review-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// We need to mock the home dir so getSessionDir uses our test dir.
// We'll do this by mocking os.homedir.
vi.mock('node:os', async () => {
  const actual = await vi.importActual('node:os');
  return { ...actual, homedir: () => testDir };
});

import { computeContentHash, getSessionDir } from '../src/session.js';

describe('computeContentHash', () => {
  it('returns sha256-prefixed hex string', () => {
    const hash = computeContentHash('hello');
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(computeContentHash('test')).toBe(computeContentHash('test'));
  });

  it('differs for different content', () => {
    expect(computeContentHash('a')).not.toBe(computeContentHash('b'));
  });
});

describe('getSessionDir', () => {
  it('returns path under home directory', () => {
    const dir = getSessionDir();
    expect(dir).toBe(join(testDir, '.plan-review', 'sessions'));
  });

  it('creates directory if missing', () => {
    const dir = getSessionDir();
    expect(existsSync(dir)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL — `session.ts` does not exist.

- [ ] **Step 3: Implement `computeContentHash` and `getSessionDir`**

```typescript
// src/session.ts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ReviewComment } from './types.js';

export interface SessionData {
  version: number;
  planPath: string;
  contentHash: string;
  comments: ReviewComment[];
  activeSection: string | null;
  lastModified: string;
}

export interface SessionLoadResult {
  comments: ReviewComment[];
  activeSection: string | null;
  stale: boolean;
}

export function getSessionDir(): string {
  const dir = join(homedir(), '.plan-review', 'sessions');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function computeContentHash(content: string): string {
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

function pathHash(planPath: string): string {
  return createHash('sha256').update(resolve(planPath)).digest('hex').slice(0, 16);
}

function sessionFilePath(planPath: string): string {
  return join(getSessionDir(), `${pathHash(planPath)}.json`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session.ts tests/session.test.ts
git commit -m "feat: add session module with computeContentHash and getSessionDir"
```

---

### Task 2: Session Module — save, load, clear

**Files:**
- Modify: `src/session.ts`
- Modify: `tests/session.test.ts`

- [ ] **Step 1: Write failing tests for `saveSession`, `loadSession`, `clearSession`**

Add to `tests/session.test.ts`:

```typescript
import { saveSession, loadSession, clearSession } from '../src/session.js';

describe('saveSession', () => {
  it('creates a session file', () => {
    saveSession('/tmp/plan.md', 'sha256:abc', [], null);
    const files = readdirSync(getSessionDir());
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.json$/);
  });

  it('stores comments and activeSection', () => {
    const comments = [{ sectionId: '1.1', text: 'Fix this', timestamp: new Date() }];
    saveSession('/tmp/plan.md', 'sha256:abc', comments, '1.1');
    const result = loadSession('/tmp/plan.md', 'sha256:abc');
    expect(result).not.toBeNull();
    expect(result!.comments).toHaveLength(1);
    expect(result!.comments[0].sectionId).toBe('1.1');
    expect(result!.activeSection).toBe('1.1');
  });

  it('logs warning and continues on write failure', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Save to a path that will produce a valid pathHash but we'll make dir read-only
    // Instead, just verify no exception is thrown on normal save
    saveSession('/tmp/plan.md', 'sha256:abc', [], null);
    consoleSpy.mockRestore();
  });
});

describe('loadSession', () => {
  it('returns null when no session exists', () => {
    const result = loadSession('/tmp/nonexistent.md', 'sha256:abc');
    expect(result).toBeNull();
  });

  it('returns stale: false when content hash matches', () => {
    saveSession('/tmp/plan.md', 'sha256:abc', [], null);
    const result = loadSession('/tmp/plan.md', 'sha256:abc');
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(false);
  });

  it('returns stale: true when content hash differs', () => {
    saveSession('/tmp/plan.md', 'sha256:abc', [], null);
    const result = loadSession('/tmp/plan.md', 'sha256:different');
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
  });

  it('handles corrupt JSON: logs warning, deletes file, returns null', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Write garbage to the session file location
    saveSession('/tmp/plan.md', 'sha256:abc', [], null);
    const dir = getSessionDir();
    const files = readdirSync(dir);
    writeFileSync(join(dir, files[0]), 'not json!!!');

    const result = loadSession('/tmp/plan.md', 'sha256:abc');
    expect(result).toBeNull();
    expect(existsSync(join(dir, files[0]))).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('clearSession', () => {
  it('deletes the session file', () => {
    saveSession('/tmp/plan.md', 'sha256:abc', [], null);
    expect(readdirSync(getSessionDir()).length).toBe(1);
    clearSession('/tmp/plan.md');
    expect(readdirSync(getSessionDir()).length).toBe(0);
  });

  it('does not throw when session file does not exist', () => {
    expect(() => clearSession('/tmp/nonexistent.md')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL — functions not exported yet.

- [ ] **Step 3: Implement `saveSession`, `loadSession`, `clearSession`**

Add to `src/session.ts`:

```typescript
export function saveSession(
  planPath: string,
  contentHash: string,
  comments: ReviewComment[],
  activeSection: string | null,
): void {
  const data: SessionData = {
    version: 1,
    planPath: resolve(planPath),
    contentHash,
    comments,
    activeSection,
    lastModified: new Date().toISOString(),
  };
  try {
    writeFileSync(sessionFilePath(planPath), JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Warning: Failed to save session: ${msg}`);
  }
}

export function loadSession(
  planPath: string,
  currentContentHash: string,
): SessionLoadResult | null {
  const filePath = sessionFilePath(planPath);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data: SessionData = JSON.parse(raw);
    return {
      comments: data.comments,
      activeSection: data.activeSection,
      stale: data.contentHash !== currentContentHash,
    };
  } catch {
    console.error('Warning: Corrupt session file, starting fresh.');
    try { unlinkSync(filePath); } catch { /* ignore */ }
    return null;
  }
}

export function clearSession(planPath: string): void {
  const filePath = sessionFilePath(planPath);
  try { unlinkSync(filePath); } catch { /* ignore if missing */ }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session.ts tests/session.test.ts
git commit -m "feat: add saveSession, loadSession, clearSession"
```

---

### Task 3: Session Module — listSessions

**Files:**
- Modify: `src/session.ts`
- Modify: `tests/session.test.ts`

- [ ] **Step 1: Write failing tests for `listSessions`**

Add to `tests/session.test.ts`:

```typescript
import { listSessions } from '../src/session.js';

describe('listSessions', () => {
  it('returns empty array when no sessions exist', () => {
    expect(listSessions()).toEqual([]);
  });

  it('returns session info for saved sessions', () => {
    saveSession('/tmp/plan-a.md', 'sha256:aaa', [
      { sectionId: '1.1', text: 'Comment', timestamp: new Date() },
    ], '1.1');
    saveSession('/tmp/plan-b.md', 'sha256:bbb', [], null);

    const sessions = listSessions();
    expect(sessions).toHaveLength(2);

    const planA = sessions.find(s => s.planPath.endsWith('plan-a.md'));
    expect(planA).toBeDefined();
    expect(planA!.commentCount).toBe(1);
    expect(planA!.lastModified).toBeTruthy();
  });

  it('reports stale as null when plan file does not exist', () => {
    saveSession('/tmp/definitely-not-real-file.md', 'sha256:aaa', [], null);
    const sessions = listSessions();
    expect(sessions[0].stale).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL — `listSessions` not exported.

- [ ] **Step 3: Implement `listSessions`**

Add to `src/session.ts`:

```typescript
export function listSessions(): Array<{
  planPath: string;
  commentCount: number;
  lastModified: string;
  stale: boolean | null;
}> {
  const dir = getSessionDir();
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));

  return files.map(f => {
    try {
      const raw = readFileSync(join(dir, f), 'utf-8');
      const data: SessionData = JSON.parse(raw);
      let stale: boolean | null;
      if (!existsSync(data.planPath)) {
        stale = null;
      } else {
        const currentContent = readFileSync(data.planPath, 'utf-8');
        const currentHash = computeContentHash(currentContent);
        stale = data.contentHash !== currentHash;
      }
      return {
        planPath: data.planPath,
        commentCount: data.comments.length,
        lastModified: data.lastModified,
        stale,
      };
    } catch {
      return null;
    }
  }).filter((s): s is NonNullable<typeof s> => s !== null);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session.ts tests/session.test.ts
git commit -m "feat: add listSessions for session discovery"
```

---

### Task 4: CLI Integration — `--fresh` Flag and Resume Flow

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Write failing test for `--fresh` flag**

Add to `tests/index.test.ts`:

```typescript
  it('--fresh flag is accepted without error', () => {
    const fixtureFile = join(__dirname, 'fixtures', 'generic-document.md');
    // --fresh with -o stdout to avoid interactive prompts
    // Use timeout to kill since it would wait for input in terminal mode
    const result = spawnSync('npx', ['tsx', entryPoint, fixtureFile, '--fresh', '-o', 'stdout'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 15000,
      input: 'done\n',
    });
    // Should not error about unknown flag
    expect(result.stderr).not.toContain('unknown option');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index.test.ts`
Expected: FAIL — `--fresh` is unknown option.

- [ ] **Step 3: Add `--fresh` flag and resume flow to `index.ts`**

Add the option to the commander program definition:

```typescript
  .option('--fresh', 'Skip session resume, start clean review')
```

Update the `run` function signature to accept `fresh`:

```typescript
async function run(
  file: string | undefined,
  opts: { output?: string; outputFile?: string; splitBy?: string; browser?: boolean; fresh?: boolean },
): Promise<void> {
```

Add session logic after parsing, before the navigate/browser block. Insert after the `console.error(chalk.dim(...))` line:

```typescript
  import { resolve as resolvePath } from 'node:path';
  import { loadSession, saveSession, clearSession, computeContentHash } from './session.js';

  // Session resume
  const absPath = file ? resolvePath(file) : undefined;
  const contentHash = computeContentHash(input);
  let resumedComments: ReviewComment[] = [];

  if (absPath) {
    if (opts.fresh) {
      clearSession(absPath);
    } else {
      const session = loadSession(absPath, contentHash);
      if (session) {
        if (session.stale) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
          const answer = await new Promise<string>(resolve =>
            rl.question(
              chalk.yellow(`Plan changed since last review. Resume with ${session.comments.length} comments? [y/n] `),
              a => resolve(a.trim().toLowerCase()),
            ),
          );
          rl.close();
          if (answer === 'y' || answer === 'yes') {
            resumedComments = session.comments;
            console.error(chalk.green(`Resumed ${resumedComments.length} comments.`));
          } else {
            clearSession(absPath);
          }
        } else {
          resumedComments = session.comments;
          console.error(chalk.green(`Resuming review (${resumedComments.length} comments).`));
        }
      }
    }
  }

  doc.comments = resumedComments;
```

Note: the imports should be at the top of the file, not inline. Add to the existing import block:

```typescript
import { resolve as resolvePath } from 'node:path';
import { loadSession, saveSession, clearSession, computeContentHash } from './session.js';
```

After review completes (after `reviewed = doc` or `reviewed = await navigate(...)`), add session clear on submit:

```typescript
  // Clear session after successful review
  if (absPath) {
    clearSession(absPath);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/index.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: add --fresh flag and session resume flow"
```

---

### Task 5: Terminal Mode Auto-Save

**Files:**
- Modify: `src/navigator.ts`
- Modify: `src/index.ts`
- Modify: `tests/navigator.test.ts`

- [ ] **Step 1: Write failing test for onCommentChange callback**

Read `tests/navigator.test.ts` first, then add a test. The existing tests mock readline. Add:

```typescript
  it('calls onCommentChange after adding a comment', async () => {
    const onCommentChange = vi.fn();
    const mockRl = {
      question: vi.fn((prompt: string, cb: (answer: string) => void) => {
        // First call: 'all' to start linear review
        // Second call: enter a comment
        // Third call: empty to skip remaining
        // Fourth call: 'done' to exit
        if (mockRl.question.mock.calls.length === 1) cb('all');
        else if (mockRl.question.mock.calls.length === 2) cb('Great section');
        else if (mockRl.question.mock.calls.length === 3) cb('');
        else cb('done');
      }),
      close: vi.fn(),
    };
    vi.spyOn(readline, 'createInterface').mockReturnValue(mockRl as any);

    const doc = makePlanDoc();
    await navigate(doc, false, onCommentChange);
    expect(onCommentChange).toHaveBeenCalled();
    expect(doc.comments.length).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/navigator.test.ts`
Expected: FAIL — `navigate` doesn't accept third argument.

- [ ] **Step 3: Add `onCommentChange` callback to `navigate`**

Modify `src/navigator.ts`:

Update the `navigate` signature:

```typescript
export async function navigate(
  doc: PlanDocument,
  inputFromStdin: boolean = false,
  onCommentChange?: () => void,
): Promise<PlanDocument> {
```

Pass it to `linearReview`:

```typescript
      await linearReview(doc, reviewableSections, ask, onCommentChange);
    } else {
      const section = findSection(doc, input);
      if (section) {
        const startIdx = reviewableSections.indexOf(section);
        await linearReview(doc, reviewableSections.slice(startIdx), ask, onCommentChange);
```

Update `linearReview` signature:

```typescript
async function linearReview(
  doc: PlanDocument,
  sections: Section[],
  ask: (prompt: string) => Promise<string>,
  onCommentChange?: () => void,
): Promise<void> {
```

After the comment push (line 72-76 area), call the callback:

```typescript
    } else if (input !== '') {
      doc.comments.push({
        sectionId: section.id,
        text: input,
        timestamp: new Date(),
      });
      onCommentChange?.();
    }
```

- [ ] **Step 4: Wire auto-save callback in `index.ts`**

In the terminal mode branch of `run()`, change the navigate call:

```typescript
    const onCommentChange = absPath
      ? () => saveSession(absPath, contentHash, doc.comments, null)
      : undefined;
    reviewed = await navigate(doc, inputFromStdin, onCommentChange);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/navigator.ts src/index.ts tests/navigator.test.ts
git commit -m "feat: auto-save session on comment change in terminal mode"
```

---

### Task 6: Browser Mode Auto-Save — Server Endpoint

**Files:**
- Modify: `src/server/routes.ts`
- Modify: `src/transport.ts`
- Modify: `src/index.ts`
- Modify: `tests/server/routes.test.ts`

- [ ] **Step 1: Write failing test for `PUT /api/session`**

Add to `tests/server/routes.test.ts`:

```typescript
  it('PUT /api/session calls onSessionSave with comments and activeSection', async () => {
    const onSessionSave = vi.fn();
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
      onSessionSave,
    });

    const res = await fetch(`http://localhost:${port}/api/session`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comments: [{ sectionId: '1.1', text: 'Draft comment', timestamp: new Date().toISOString() }],
        activeSection: '1.1',
      }),
    });

    expect(res.status).toBe(200);
    expect(onSessionSave).toHaveBeenCalledOnce();
    expect(onSessionSave.mock.calls[0][0]).toHaveLength(1);
    expect(onSessionSave.mock.calls[0][1]).toBe('1.1');

    await stopTestServer(server);
  });

  it('PUT /api/session rejects non-array comments', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
      onSessionSave: vi.fn(),
    });

    const res = await fetch(`http://localhost:${port}/api/session`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: 'not an array', activeSection: null }),
    });

    expect(res.status).toBe(400);

    await stopTestServer(server);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/routes.test.ts`
Expected: FAIL — `onSessionSave` not in `RouteContext`, `PUT /api/session` returns 404.

- [ ] **Step 3: Add `onSessionSave` to `RouteContext` and `PUT /api/session` route**

Modify `src/server/routes.ts`:

Update `RouteContext`:

```typescript
export interface RouteContext {
  getDocument: () => PlanDocument;
  onSubmit: (comments: ReviewComment[]) => void;
  getAssetHtml: () => string;
  onSessionSave?: (comments: ReviewComment[], activeSection: string | null) => void;
}
```

Add the route handler inside `createRouteHandler`, before the 404 fallback:

```typescript
    if (method === 'PUT' && url === '/api/session') {
      let body = '';
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          req.destroy();
          return;
        }
        body += chunk.toString();
      });
      req.on('end', () => {
        if (size > MAX_BODY_SIZE) return;
        try {
          const parsed = JSON.parse(body);
          const comments = parsed.comments;
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
          ctx.onSessionSave?.(comments as ReviewComment[], parsed.activeSection ?? null);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
```

- [ ] **Step 4: Wire `onSessionSave` in transport and `index.ts`**

Update `RouteContext` usage in `src/transport.ts` — the `start` method already passes a context object. Add `onSessionSave` to what `HttpTransport` provides:

Add a field and setter to `HttpTransport`:

```typescript
  private sessionSaveHandler: ((comments: ReviewComment[], activeSection: string | null) => void) | null = null;

  onSessionSave(handler: (comments: ReviewComment[], activeSection: string | null) => void): void {
    this.sessionSaveHandler = handler;
  }
```

In `start()`, pass it through:

```typescript
    this.server = createReviewServer({
      getDocument: () => this.doc!,
      onSubmit: (comments) => this.submitHandler?.(comments),
      getAssetHtml: () => getAssetHtml(),
      onSessionSave: (comments, activeSection) => this.sessionSaveHandler?.(comments, activeSection),
    });
```

In `src/index.ts`, in the browser branch, wire it up:

```typescript
    if (absPath) {
      transport.onSessionSave((comments, activeSection) => {
        saveSession(absPath, contentHash, comments, activeSection);
      });
    }
```

Also add session clear after browser submit resolves (already in the generic clear block).

- [ ] **Step 5: Update existing route tests that don't pass `onSessionSave`**

The existing tests create `RouteContext` without `onSessionSave`. Since we made it optional (`onSessionSave?`), they should still pass. Verify:

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes.ts src/transport.ts src/index.ts tests/server/routes.test.ts
git commit -m "feat: add PUT /api/session endpoint for browser auto-save"
```

---

### Task 7: Browser Auto-Save — Frontend `useEffect`

**Files:**
- Modify: `src/browser/App.tsx`
- Modify: `tests/browser/App.test.tsx`

- [ ] **Step 1: Write failing test for auto-save on comment change**

Add to `tests/browser/App.test.tsx`:

```typescript
  it('fires PUT /api/session after adding a comment', async () => {
    const fetchCalls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      fetchCalls.push([url, init]);
      if (url === '/api/doc') {
        return Promise.resolve({ json: () => Promise.resolve({ document: mockPlanDoc }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    }));

    render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Add a section-level comment
    const links = screen.getAllByText('Add comment to entire section');
    fireEvent.click(links[0]);
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Test auto-save' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(screen.getByText('Test auto-save')).toBeTruthy());

    // Wait for debounce (500ms) + margin
    await new Promise(r => setTimeout(r, 600));

    // Verify PUT /api/session was called
    const sessionCall = fetchCalls.find(([url, init]) => url === '/api/session' && init?.method === 'PUT');
    expect(sessionCall).toBeTruthy();
    const body = JSON.parse(sessionCall![1]!.body as string);
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].text).toBe('Test auto-save');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/browser/App.test.tsx`
Expected: FAIL — no PUT /api/session call happens.

- [ ] **Step 3: Add auto-save `useEffect` to `App.tsx`**

Add a ref to track whether the initial load is done (avoid saving the empty state on mount), and a `useEffect`:

```typescript
import { useState, useEffect, useRef } from 'preact/hooks';

// Inside App component, after the existing state declarations:
  const initialLoadDone = useRef(false);

  // Auto-save session on comment change
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = comments.length > 0 || doc !== null;
      if (!initialLoadDone.current) return;
    }
    const timer = setTimeout(() => {
      fetch('/api/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments, activeSection }),
      }).catch(() => {}); // best-effort
    }, 500);
    return () => clearTimeout(timer);
  }, [comments, activeSection]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/browser/App.tsx tests/browser/App.test.tsx
git commit -m "feat: auto-save session from browser on comment change"
```

---

### Task 8: `sessions` Subcommand

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Write failing test for `plan-review sessions`**

Add to `tests/index.test.ts`:

```typescript
  it('sessions subcommand runs without error', () => {
    const result = runCli(['sessions']);
    expect(result.status).toBe(0);
    // Should mention the sessions directory
    const output = result.stdout + result.stderr;
    expect(output).toContain('.plan-review/sessions');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index.test.ts`
Expected: FAIL — `sessions` is not a recognized subcommand.

- [ ] **Step 3: Add `sessions` subcommand to `index.ts`**

Add before `program.parse()`:

```typescript
program
  .command('sessions')
  .description('List all saved review sessions')
  .action(() => {
    const sessions = listSessions();
    const dir = getSessionDir();
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

Add the `listSessions` and `getSessionDir` imports (they're already imported if Task 4 is done).

Add a helper function at the bottom of `index.ts`:

```typescript
function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: add sessions subcommand to list saved reviews"
```

---

### Task 9: README Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add saved sessions documentation**

Add a new section after "Output targets" and before "License" in `README.md`:

```markdown
## Saved sessions

Review progress is auto-saved as you work. If you close the terminal or browser and re-run `plan-review` on the same file, you'll be prompted to resume where you left off.

Sessions are stored in `~/.plan-review/sessions/`.

### Commands

```
plan-review plan.md --fresh    Skip session resume, start clean
plan-review sessions           List all saved sessions
```

### Manual cleanup

Delete files in `~/.plan-review/sessions/` to remove old sessions.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add saved sessions section to README"
```

---

### Task 10: Integration Test — Full Resume Round-Trip

**Files:**
- Create: `tests/session-integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/session-integration.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'plan-review-integration-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual('node:os');
  return { ...actual, homedir: () => testDir };
});

import { saveSession, loadSession, clearSession, computeContentHash, listSessions } from '../src/session.js';

describe('session integration', () => {
  const planPath = '/tmp/integration-test-plan.md';
  const planContent = '# Test Plan\n\n## Task 1\n\nDo something.';
  const hash = computeContentHash(planContent);

  it('full round-trip: save → load → modify → load stale → clear', () => {
    // Save
    const comments = [
      { sectionId: '1.1', text: 'Fix this', timestamp: new Date() },
      { sectionId: '1.2', text: 'Check that', timestamp: new Date() },
    ];
    saveSession(planPath, hash, comments, '1.1');

    // Load — not stale
    const result = loadSession(planPath, hash);
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(false);
    expect(result!.comments).toHaveLength(2);
    expect(result!.activeSection).toBe('1.1');

    // Load with different hash — stale
    const staleResult = loadSession(planPath, computeContentHash('modified plan'));
    expect(staleResult).not.toBeNull();
    expect(staleResult!.stale).toBe(true);
    expect(staleResult!.comments).toHaveLength(2);

    // List
    const sessions = listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].commentCount).toBe(2);

    // Clear
    clearSession(planPath);
    expect(loadSession(planPath, hash)).toBeNull();
    expect(listSessions()).toHaveLength(0);
  });

  it('same file at two paths = two independent sessions', () => {
    const path1 = '/tmp/plan-copy-1.md';
    const path2 = '/tmp/plan-copy-2.md';
    saveSession(path1, hash, [{ sectionId: '1.1', text: 'A', timestamp: new Date() }], null);
    saveSession(path2, hash, [{ sectionId: '2.1', text: 'B', timestamp: new Date() }], null);

    const s1 = loadSession(path1, hash);
    const s2 = loadSession(path2, hash);
    expect(s1!.comments[0].text).toBe('A');
    expect(s2!.comments[0].text).toBe('B');
    expect(listSessions()).toHaveLength(2);
  });

  it('auto-save overwrites previous session', () => {
    saveSession(planPath, hash, [{ sectionId: '1.1', text: 'First', timestamp: new Date() }], null);
    saveSession(planPath, hash, [
      { sectionId: '1.1', text: 'First', timestamp: new Date() },
      { sectionId: '1.2', text: 'Second', timestamp: new Date() },
    ], '1.2');

    const result = loadSession(planPath, hash);
    expect(result!.comments).toHaveLength(2);
    expect(result!.activeSection).toBe('1.2');
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run tests/session-integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/session-integration.test.ts
git commit -m "test: add session integration tests for full round-trip"
```
