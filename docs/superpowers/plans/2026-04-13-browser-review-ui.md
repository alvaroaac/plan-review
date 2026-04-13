# Browser Review UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-based review mode (`--browser` flag) that serves a three-panel Preact SPA for reviewing parsed markdown plans, then outputs structured review through the existing pipeline.

**Architecture:** HTTP server (Node `http` module) serves a bundled Preact SPA. Transport abstraction decouples CLI from server. SPA fetches document via REST, user adds section-level comments, submits via POST, CLI formats and outputs through existing `formatter.ts` → `output.ts` pipeline. All existing CLI behavior unchanged.

**Tech Stack:** Preact (browser UI), esbuild (browser bundler), Node `http` (server), `marked` (browser markdown rendering), `@testing-library/preact` + jsdom (browser tests), vitest (all tests)

**Spec:** `docs/superpowers/specs/2026-04-13-browser-ui-design.md`

---

## File Map

```
src/
  types.ts                    — MODIFY: add optional anchor field to ReviewComment
  index.ts                    — MODIFY: add --browser flag, wire transport
  transport.ts                — CREATE: Transport interface + HttpTransport
  server/
    routes.ts                 — CREATE: GET /, GET /api/doc, POST /api/review
    server.ts                 — CREATE: createReviewServer, startServer, stopServer
    assets.ts                 — CREATE: getAssetHtml() reads bundled HTML
  browser/
    App.tsx                   — CREATE: root component, state, fetch, submit
    TOCPanel.tsx              — CREATE: section tree navigation
    SectionView.tsx           — CREATE: renders section markdown via marked
    CommentSidebar.tsx        — CREATE: comment list, add/edit/delete
    CommentCard.tsx           — CREATE: single comment display
    CommentInput.tsx          — CREATE: textarea form
    index.tsx                 — CREATE: Preact entry point
    styles.css                — CREATE: dark theme

scripts/
  build-browser.js            — CREATE: esbuild bundler + HTML inliner

tests/
  server/
    routes.test.ts            — CREATE
    server.test.ts            — CREATE
  transport.test.ts           — CREATE
  browser/
    test-utils.ts             — CREATE: shared mock docs
    CommentInput.test.tsx     — CREATE
    CommentCard.test.tsx      — CREATE
    CommentSidebar.test.tsx   — CREATE
    SectionView.test.tsx      — CREATE
    TOCPanel.test.tsx         — CREATE
    App.test.tsx              — CREATE
  build.test.ts               — CREATE: esbuild integration
  browser-integration.test.ts — CREATE: CLI --browser flag

Config:
  package.json                — MODIFY: new deps + scripts
  vitest.config.ts            — MODIFY: tsx glob, jsdom env, esbuild jsx
  tsconfig.json               — MODIFY: exclude src/browser
  tsconfig.browser.json       — CREATE: jsx config for IDE support
```

### Parallelism Guide

After Task 1 completes:
- **Server track** (Tasks 2, 3, 4): Tasks 2+3 parallel → Task 4 after both
- **Browser track** (Tasks 5–9): Tasks 5+7+8 parallel → Task 6 after 5 → Task 9 after all
- Server and browser tracks are fully independent
- Task 10 requires all browser tasks (5–9) complete
- Task 11 requires all tasks complete

---

### Task 1: Project Setup & Type Extension

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Modify: `tsconfig.json`
- Create: `tsconfig.browser.json`
- Modify: `src/types.ts`

- [ ] **Step 1: Install new dependencies**

```bash
cd /Users/alvarocarvalho/desenv/personal/plan-review && npm install preact && npm install -D esbuild @testing-library/preact jsdom
```

- [ ] **Step 2: Add new package.json scripts**

Add to `package.json` scripts:

```json
"build": "tsc && node scripts/build-browser.js",
"build:browser": "node scripts/build-browser.js",
"dev:browser": "node scripts/build-browser.js --watch"
```

Keep existing `dev`, `test`, `test:watch`, `typecheck` unchanged.

- [ ] **Step 3: Update vitest.config.ts**

Replace full contents of `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environmentMatchGlobs: [
      ['tests/browser/**', 'jsdom'],
    ],
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
});
```

- [ ] **Step 4: Update tsconfig.json to exclude browser source**

Add `"src/browser"` to the exclude array in `tsconfig.json`:

```json
"exclude": ["node_modules", "dist", "tests", "src/browser"]
```

- [ ] **Step 5: Create tsconfig.browser.json for IDE support**

Create `tsconfig.browser.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/browser"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 6: Extend ReviewComment with optional anchor field**

In `src/types.ts`, replace the `ReviewComment` interface:

```typescript
export interface ReviewComment {
  sectionId: string;
  text: string;
  timestamp: Date;
  anchor?: {
    type: 'section' | 'range';
    startOffset?: number;
    endOffset?: number;
    selectedText?: string;
  };
}
```

- [ ] **Step 7: Verify all 91 existing tests pass**

Run: `npm test`
Expected: All 91 tests pass. The anchor field is optional so no existing code breaks.

- [ ] **Step 8: Commit**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add package.json package-lock.json vitest.config.ts tsconfig.json tsconfig.browser.json src/types.ts
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "feat: add browser review deps, configs, and anchor type extension"
```

---

### Task 2: Server Routes

**Files:**
- Create: `src/server/routes.ts`
- Create: `tests/server/routes.test.ts`

- [ ] **Step 1: Write failing tests for all routes**

Create `tests/server/routes.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createRouteHandler } from '../../src/server/routes.js';
import type { PlanDocument, ReviewComment } from '../../src/types.js';

const mockDoc: PlanDocument = {
  title: 'Test Plan',
  metadata: {},
  mode: 'plan',
  sections: [
    { id: '1.1', heading: 'Task 1', level: 3, body: 'Task body' },
  ],
  comments: [],
};

function startTestServer(ctx: Parameters<typeof createRouteHandler>[0]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(createRouteHandler(ctx));
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function stopTestServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('server routes', () => {
  it('GET /api/doc returns document JSON', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const res = await fetch(`http://localhost:${port}/api/doc`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(data.document.title).toBe('Test Plan');
    expect(data.document.sections).toHaveLength(1);

    await stopTestServer(server);
  });

  it('POST /api/review calls onSubmit with parsed comments', async () => {
    const onSubmit = vi.fn();
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit,
      getAssetHtml: () => '<html></html>',
    });

    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'Looks good', timestamp: new Date('2026-04-13') },
    ];

    const res = await fetch(`http://localhost:${port}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toHaveLength(1);
    expect(onSubmit.mock.calls[0][0][0].sectionId).toBe('1.1');

    await stopTestServer(server);
  });

  it('POST /api/review rejects invalid body', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const res = await fetch(`http://localhost:${port}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);

    await stopTestServer(server);
  });

  it('GET / serves HTML from getAssetHtml', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html><body>Review App</body></html>',
    });

    const res = await fetch(`http://localhost:${port}/`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('Review App');

    await stopTestServer(server);
  });

  it('returns 404 for unknown routes', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);

    await stopTestServer(server);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/routes.test.ts`
Expected: FAIL — module `../../src/server/routes.js` not found

- [ ] **Step 3: Implement routes.ts**

Create `src/server/routes.ts`:

```typescript
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PlanDocument, ReviewComment } from '../types.js';

export interface RouteContext {
  getDocument: () => PlanDocument;
  onSubmit: (comments: ReviewComment[]) => void;
  getAssetHtml: () => string;
}

export function createRouteHandler(ctx: RouteContext): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const { method, url } = req;

    if (method === 'GET' && url === '/') {
      const html = ctx.getAssetHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (method === 'GET' && url === '/api/doc') {
      const doc = ctx.getDocument();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ document: doc }));
      return;
    }

    if (method === 'POST' && url === '/api/review') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const comments: ReviewComment[] = parsed.comments;
          if (!Array.isArray(comments)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'comments must be an array' }));
            return;
          }
          ctx.onSubmit(comments);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/routes.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add src/server/routes.ts tests/server/routes.test.ts
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "feat: add server route handler with GET/POST endpoints"
```

---

### Task 3: Server Lifecycle

**Files:**
- Create: `src/server/server.ts`
- Create: `tests/server/server.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/server.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createReviewServer, startServer, stopServer } from '../../src/server/server.js';
import type { PlanDocument } from '../../src/types.js';

const mockDoc: PlanDocument = {
  title: 'Test',
  metadata: {},
  mode: 'generic',
  sections: [{ id: 'section-1', heading: 'S1', level: 2, body: 'content' }],
  comments: [],
};

describe('server lifecycle', () => {
  it('createReviewServer returns an http.Server', () => {
    const server = createReviewServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });
    expect(server).toBeDefined();
    expect(typeof server.listen).toBe('function');
  });

  it('startServer binds to port and returns url', async () => {
    const server = createReviewServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const { url } = await startServer(server, 0);
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);

    await stopServer(server);
  });

  it('stopServer closes the server', async () => {
    const server = createReviewServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    await startServer(server, 0);
    await stopServer(server);

    // Server should no longer accept connections
    expect(server.listening).toBe(false);
  });

  it('server responds to requests after start', async () => {
    const server = createReviewServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const { url } = await startServer(server, 0);
    const res = await fetch(`${url}/api/doc`);
    expect(res.status).toBe(200);

    await stopServer(server);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/server.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement server.ts**

Create `src/server/server.ts`:

```typescript
import { createServer, type Server } from 'node:http';
import { createRouteHandler, type RouteContext } from './routes.js';

export function createReviewServer(ctx: RouteContext): Server {
  return createServer(createRouteHandler(ctx));
}

export function startServer(server: Server, port: number): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ url: `http://localhost:${actualPort}` });
    });
  });
}

export function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/server.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add src/server/server.ts tests/server/server.test.ts
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "feat: add server lifecycle (create, start, stop)"
```

---

### Task 4: Transport Layer

**Files:**
- Create: `src/transport.ts`
- Create: `tests/transport.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/transport.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { HttpTransport } from '../src/transport.js';
import type { PlanDocument, ReviewComment } from '../src/types.js';

const mockDoc: PlanDocument = {
  title: 'Test',
  metadata: {},
  mode: 'generic',
  sections: [{ id: 'section-1', heading: 'S1', level: 2, body: 'content' }],
  comments: [],
};

describe('HttpTransport', () => {
  it('starts server and returns url', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);
    const { url } = await transport.start(0);
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);
    await transport.stop();
  });

  it('throws if start called without document', async () => {
    const transport = new HttpTransport();
    await expect(transport.start(0)).rejects.toThrow('No document set');
  });

  it('serves document via GET /api/doc', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);
    const { url } = await transport.start(0);

    const res = await fetch(`${url}/api/doc`);
    const data = await res.json();
    expect(data.document.title).toBe('Test');

    await transport.stop();
  });

  it('fires onReviewSubmit handler on POST /api/review', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);

    const received = new Promise<ReviewComment[]>((resolve) => {
      transport.onReviewSubmit(resolve);
    });

    const { url } = await transport.start(0);

    const comments: ReviewComment[] = [
      { sectionId: 'section-1', text: 'Nice', timestamp: new Date() },
    ];
    await fetch(`${url}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments }),
    });

    const result = await received;
    expect(result).toHaveLength(1);
    expect(result[0].sectionId).toBe('section-1');

    await transport.stop();
  });

  it('stop is safe to call multiple times', async () => {
    const transport = new HttpTransport();
    transport.sendDocument(mockDoc);
    await transport.start(0);
    await transport.stop();
    await transport.stop(); // should not throw
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/transport.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement transport.ts**

Create `src/transport.ts`:

```typescript
import type { Server } from 'node:http';
import type { PlanDocument, ReviewComment } from './types.js';
import { createReviewServer, startServer, stopServer } from './server/server.js';
import { getAssetHtml } from './server/assets.js';

export interface Transport {
  sendDocument(doc: PlanDocument): void;
  onReviewSubmit(handler: (comments: ReviewComment[]) => void): void;
  start(port: number): Promise<{ url: string }>;
  stop(): Promise<void>;
}

export class HttpTransport implements Transport {
  private doc: PlanDocument | null = null;
  private submitHandler: ((comments: ReviewComment[]) => void) | null = null;
  private server: Server | null = null;

  sendDocument(doc: PlanDocument): void {
    this.doc = doc;
  }

  onReviewSubmit(handler: (comments: ReviewComment[]) => void): void {
    this.submitHandler = handler;
  }

  async start(port: number): Promise<{ url: string }> {
    if (!this.doc) throw new Error('No document set');

    this.server = createReviewServer({
      getDocument: () => this.doc!,
      onSubmit: (comments) => this.submitHandler?.(comments),
      getAssetHtml: () => getAssetHtml(),
    });

    return startServer(this.server, port);
  }

  async stop(): Promise<void> {
    if (this.server && this.server.listening) {
      await stopServer(this.server);
      this.server = null;
    }
  }
}
```

- [ ] **Step 4: Create placeholder assets.ts so transport compiles**

Create `src/server/assets.ts`:

```typescript
export function getAssetHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>Plan Review</title></head>
<body><div id="app">Loading...</div></body></html>`;
}
```

This placeholder is replaced in Task 10 with the real bundle reader.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/transport.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All existing tests + new server/transport tests pass

- [ ] **Step 7: Commit**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add src/transport.ts src/server/assets.ts tests/transport.test.ts
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "feat: add Transport interface and HttpTransport implementation"
```

---

### Task 5: Browser Test Utils + CommentInput + CommentCard

**Files:**
- Create: `tests/browser/test-utils.ts`
- Create: `src/browser/CommentInput.tsx`
- Create: `tests/browser/CommentInput.test.tsx`
- Create: `src/browser/CommentCard.tsx`
- Create: `tests/browser/CommentCard.test.tsx`

- [ ] **Step 1: Create shared test fixtures**

Create `tests/browser/test-utils.ts`:

```typescript
import type { PlanDocument } from '../../src/types.js';

export const mockPlanDoc: PlanDocument = {
  title: 'Test Plan',
  metadata: {},
  mode: 'plan',
  sections: [
    { id: 'milestone-1', heading: 'Milestone 1', level: 2, body: 'Setup work' },
    {
      id: '1.1', heading: 'Task 1', level: 3, body: '**Bold** and `code`',
      parent: 'milestone-1',
      dependencies: { dependsOn: [], blocks: ['1.2'] },
    },
    {
      id: '1.2', heading: 'Task 2', level: 3, body: 'Second task content',
      parent: 'milestone-1',
      dependencies: { dependsOn: ['1.1'], blocks: [] },
    },
  ],
  comments: [],
};

export const mockGenericDoc: PlanDocument = {
  title: 'Generic Doc',
  metadata: {},
  mode: 'generic',
  sections: [
    { id: 'section-1', heading: 'Section One', level: 2, body: 'First section' },
    { id: 'section-2', heading: 'Section Two', level: 2, body: 'Second section' },
  ],
  comments: [],
};
```

- [ ] **Step 2: Write failing CommentInput tests**

Create `tests/browser/CommentInput.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { CommentInput } from '../../src/browser/CommentInput.js';

describe('CommentInput', () => {
  it('renders textarea and buttons', () => {
    render(<CommentInput sectionId="1.1" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByPlaceholderText('Add a comment...')).toBeTruthy();
    expect(screen.getByText('Add')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('calls onSubmit with sectionId and text', () => {
    const onSubmit = vi.fn();
    render(<CommentInput sectionId="1.1" onSubmit={onSubmit} onCancel={vi.fn()} />);

    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Looks good' } });
    fireEvent.click(screen.getByText('Add'));

    expect(onSubmit).toHaveBeenCalledWith('1.1', 'Looks good');
  });

  it('calls onCancel when Cancel clicked', () => {
    const onCancel = vi.fn();
    render(<CommentInput sectionId="1.1" onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not submit empty text', () => {
    const onSubmit = vi.fn();
    render(<CommentInput sectionId="1.1" onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('Add'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('pre-fills textarea with initialText for editing', () => {
    render(<CommentInput sectionId="1.1" onSubmit={vi.fn()} onCancel={vi.fn()} initialText="Existing comment" />);
    const textarea = screen.getByPlaceholderText('Add a comment...') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Existing comment');
  });

  it('clears textarea after submit', () => {
    render(<CommentInput sectionId="1.1" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const textarea = screen.getByPlaceholderText('Add a comment...') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'Comment text' } });
    fireEvent.click(screen.getByText('Add'));
    expect(textarea.value).toBe('');
  });
});
```

- [ ] **Step 3: Run CommentInput tests to verify they fail**

Run: `npx vitest run tests/browser/CommentInput.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 4: Implement CommentInput**

Create `src/browser/CommentInput.tsx`:

```tsx
import { useState } from 'preact/hooks';

interface CommentInputProps {
  sectionId: string;
  onSubmit: (sectionId: string, text: string) => void;
  onCancel: () => void;
  initialText?: string;
}

export function CommentInput({ sectionId, onSubmit, onCancel, initialText = '' }: CommentInputProps) {
  const [text, setText] = useState(initialText);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(sectionId, trimmed);
    setText('');
  };

  return (
    <div class="comment-input">
      <textarea
        placeholder="Add a comment..."
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />
      <div class="comment-input-actions">
        <button class="add-btn" onClick={handleSubmit}>Add</button>
        <button class="cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run CommentInput tests to verify they pass**

Run: `npx vitest run tests/browser/CommentInput.test.tsx`
Expected: All 6 tests PASS

- [ ] **Step 6: Write failing CommentCard tests**

Create `tests/browser/CommentCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { CommentCard } from '../../src/browser/CommentCard.js';
import type { ReviewComment } from '../../src/types.js';

const mockComment: ReviewComment = {
  sectionId: '1.1',
  text: 'This looks correct',
  timestamp: new Date('2026-04-13'),
};

describe('CommentCard', () => {
  it('displays comment text and section heading', () => {
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('This looks correct')).toBeTruthy();
    expect(screen.getByText('Task 1')).toBeTruthy();
  });

  it('shows edit and delete buttons', () => {
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('calls onDelete when Delete clicked', () => {
    const onDelete = vi.fn();
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('switches to edit mode on Edit click', () => {
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    // In edit mode, textarea should appear with existing text
    const textarea = screen.getByPlaceholderText('Add a comment...') as HTMLTextAreaElement;
    expect(textarea.value).toBe('This looks correct');
  });

  it('calls onEdit with new text after editing', () => {
    const onEdit = vi.fn();
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={onEdit} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));

    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Updated comment' } });
    fireEvent.click(screen.getByText('Add'));

    expect(onEdit).toHaveBeenCalledWith('Updated comment');
  });

  it('returns to display mode on edit cancel', () => {
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Cancel'));
    // Should show original text again (not textarea)
    expect(screen.getByText('This looks correct')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
  });
});
```

- [ ] **Step 7: Run CommentCard tests to verify they fail**

Run: `npx vitest run tests/browser/CommentCard.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 8: Implement CommentCard**

Create `src/browser/CommentCard.tsx`:

```tsx
import { useState } from 'preact/hooks';
import type { ReviewComment } from '../types.js';
import { CommentInput } from './CommentInput.js';

interface CommentCardProps {
  comment: ReviewComment;
  sectionHeading: string;
  onEdit: (text: string) => void;
  onDelete: () => void;
}

export function CommentCard({ comment, sectionHeading, onEdit, onDelete }: CommentCardProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CommentInput
        sectionId={comment.sectionId}
        initialText={comment.text}
        onSubmit={(_, text) => { onEdit(text); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div class="comment-card">
      <div class="comment-section">{sectionHeading}</div>
      <div class="comment-text">{comment.text}</div>
      <div class="comment-actions">
        <button onClick={() => setEditing(true)}>Edit</button>
        <button class="delete" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Run all browser tests to verify they pass**

Run: `npx vitest run tests/browser/`
Expected: All 12 tests PASS (6 CommentInput + 6 CommentCard)

- [ ] **Step 10: Commit**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add tests/browser/ src/browser/CommentInput.tsx src/browser/CommentCard.tsx
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "feat: add CommentInput and CommentCard browser components"
```

---

### Task 6: CommentSidebar

**Files:**
- Create: `src/browser/CommentSidebar.tsx`
- Create: `tests/browser/CommentSidebar.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/browser/CommentSidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { CommentSidebar } from '../../src/browser/CommentSidebar.js';
import { mockPlanDoc } from './test-utils.js';
import type { ReviewComment } from '../../src/types.js';

const sections = mockPlanDoc.sections;

describe('CommentSidebar', () => {
  it('shows empty state when no comments', () => {
    render(
      <CommentSidebar
        comments={[]}
        sections={sections}
        commentingSection={null}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    expect(screen.getByText(/No comments yet/)).toBeTruthy();
  });

  it('displays existing comments grouped by section', () => {
    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'First comment', timestamp: new Date() },
      { sectionId: '1.2', text: 'Second comment', timestamp: new Date() },
    ];
    render(
      <CommentSidebar
        comments={comments}
        sections={sections}
        commentingSection={null}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    expect(screen.getByText('First comment')).toBeTruthy();
    expect(screen.getByText('Second comment')).toBeTruthy();
    expect(screen.getByText('Task 1')).toBeTruthy();
    expect(screen.getByText('Task 2')).toBeTruthy();
  });

  it('shows CommentInput when commentingSection is set', () => {
    render(
      <CommentSidebar
        comments={[]}
        sections={sections}
        commentingSection="1.1"
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText('Add a comment...')).toBeTruthy();
  });

  it('calls onAdd when comment submitted', () => {
    const onAdd = vi.fn();
    render(
      <CommentSidebar
        comments={[]}
        sections={sections}
        commentingSection="1.1"
        onAdd={onAdd} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'New comment' } });
    fireEvent.click(screen.getByText('Add'));
    expect(onAdd).toHaveBeenCalledWith('1.1', 'New comment');
  });

  it('calls onCancelComment when Cancel clicked', () => {
    const onCancel = vi.fn();
    render(
      <CommentSidebar
        comments={[]}
        sections={sections}
        commentingSection="1.1"
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={onCancel}
      />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onDelete with correct index', () => {
    const onDelete = vi.fn();
    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'Comment A', timestamp: new Date() },
      { sectionId: '1.1', text: 'Comment B', timestamp: new Date() },
    ];
    render(
      <CommentSidebar
        comments={comments}
        sections={sections}
        commentingSection={null}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={onDelete} onCancelComment={vi.fn()}
      />
    );
    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[1]); // delete second comment
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it('shows comment count in header', () => {
    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'A comment', timestamp: new Date() },
    ];
    render(
      <CommentSidebar
        comments={comments}
        sections={sections}
        commentingSection={null}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    expect(screen.getByText('Comments (1)')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/browser/CommentSidebar.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CommentSidebar**

Create `src/browser/CommentSidebar.tsx`:

```tsx
import type { ReviewComment, Section } from '../types.js';
import { CommentCard } from './CommentCard.js';
import { CommentInput } from './CommentInput.js';

interface CommentSidebarProps {
  comments: ReviewComment[];
  sections: Section[];
  commentingSection: string | null;
  onAdd: (sectionId: string, text: string) => void;
  onEdit: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onCancelComment: () => void;
}

export function CommentSidebar({
  comments, sections, commentingSection, onAdd, onEdit, onDelete, onCancelComment,
}: CommentSidebarProps) {
  const getSectionHeading = (sectionId: string) =>
    sections.find((s) => s.id === sectionId)?.heading ?? sectionId;

  // Group comments by section, preserving original indices
  const grouped = new Map<string, { comment: ReviewComment; index: number }[]>();
  comments.forEach((comment, index) => {
    const group = grouped.get(comment.sectionId) || [];
    group.push({ comment, index });
    grouped.set(comment.sectionId, group);
  });

  return (
    <aside class="comment-sidebar">
      <h2>Comments ({comments.length})</h2>

      {commentingSection && (
        <div class="commenting-for">
          <h3>Commenting on: {getSectionHeading(commentingSection)}</h3>
          <CommentInput
            sectionId={commentingSection}
            onSubmit={onAdd}
            onCancel={onCancelComment}
          />
        </div>
      )}

      {Array.from(grouped.entries()).map(([sectionId, items]) => (
        <div key={sectionId} class="comment-group">
          <h3>{getSectionHeading(sectionId)}</h3>
          {items.map(({ comment, index }) => (
            <CommentCard
              key={index}
              comment={comment}
              sectionHeading={getSectionHeading(sectionId)}
              onEdit={(text) => onEdit(index, text)}
              onDelete={() => onDelete(index)}
            />
          ))}
        </div>
      ))}

      {comments.length === 0 && !commentingSection && (
        <p class="no-comments">No comments yet. Click "Add Comment" on a section to start.</p>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/browser/CommentSidebar.test.tsx`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add src/browser/CommentSidebar.tsx tests/browser/CommentSidebar.test.tsx
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "feat: add CommentSidebar component with grouped display"
```

---

### Task 7: SectionView

**Files:**
- Create: `src/browser/SectionView.tsx`
- Create: `tests/browser/SectionView.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/browser/SectionView.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { SectionView } from '../../src/browser/SectionView.js';
import type { Section } from '../../src/types.js';

const planTask: Section = {
  id: '1.1',
  heading: 'Create schema',
  level: 3,
  body: '**Bold text** and `inline code`',
  parent: 'milestone-1',
  dependencies: { dependsOn: ['1.0'], blocks: ['1.2'] },
  verification: 'npm test',
  relatedFiles: ['src/schema.ts'],
};

const milestone: Section = {
  id: 'milestone-1',
  heading: 'Foundation',
  level: 2,
  body: 'Setup work for the feature.',
};

const genericSection: Section = {
  id: 'section-1',
  heading: 'Introduction',
  level: 2,
  body: 'Some introductory text.',
};

describe('SectionView', () => {
  it('renders section heading', () => {
    render(<SectionView section={planTask} mode="plan" isActive={false} onComment={vi.fn()} />);
    expect(screen.getByText('Create schema')).toBeTruthy();
  });

  it('renders markdown body as HTML', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={false} onComment={vi.fn()} />
    );
    const bodyDiv = container.querySelector('.section-body');
    expect(bodyDiv?.innerHTML).toContain('<strong>');
    expect(bodyDiv?.innerHTML).toContain('<code>');
  });

  it('shows dependency metadata in plan mode for tasks', () => {
    render(<SectionView section={planTask} mode="plan" isActive={false} onComment={vi.fn()} />);
    expect(screen.getByText(/Depends on:/)).toBeTruthy();
    expect(screen.getByText(/Blocks:/)).toBeTruthy();
    expect(screen.getByText(/Verify:/)).toBeTruthy();
  });

  it('hides metadata for milestones in plan mode', () => {
    render(<SectionView section={milestone} mode="plan" isActive={false} onComment={vi.fn()} />);
    expect(screen.queryByText(/Depends on:/)).toBeNull();
  });

  it('hides metadata in generic mode', () => {
    render(<SectionView section={genericSection} mode="generic" isActive={false} onComment={vi.fn()} />);
    expect(screen.queryByText(/Depends on:/)).toBeNull();
  });

  it('shows Add Comment button for reviewable sections', () => {
    render(<SectionView section={planTask} mode="plan" isActive={false} onComment={vi.fn()} />);
    expect(screen.getByText('Add Comment')).toBeTruthy();
  });

  it('hides Add Comment for milestones in plan mode', () => {
    render(<SectionView section={milestone} mode="plan" isActive={false} onComment={vi.fn()} />);
    expect(screen.queryByText('Add Comment')).toBeNull();
  });

  it('shows Add Comment for level 2 in generic mode', () => {
    render(<SectionView section={genericSection} mode="generic" isActive={false} onComment={vi.fn()} />);
    expect(screen.getByText('Add Comment')).toBeTruthy();
  });

  it('calls onComment when Add Comment clicked', () => {
    const onComment = vi.fn();
    render(<SectionView section={planTask} mode="plan" isActive={false} onComment={onComment} />);
    fireEvent.click(screen.getByText('Add Comment'));
    expect(onComment).toHaveBeenCalledOnce();
  });

  it('applies active class when isActive', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={true} onComment={vi.fn()} />
    );
    expect(container.querySelector('.section-view.active')).toBeTruthy();
  });

  it('sets id attribute for scroll targeting', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={false} onComment={vi.fn()} />
    );
    expect(container.querySelector('#section-1\\.1')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/browser/SectionView.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SectionView**

Create `src/browser/SectionView.tsx`:

```tsx
import { marked } from 'marked';
import type { Section } from '../types.js';

interface SectionViewProps {
  section: Section;
  mode: 'plan' | 'generic';
  isActive: boolean;
  onComment: () => void;
}

export function SectionView({ section, mode, isActive, onComment }: SectionViewProps) {
  const isReviewable = mode === 'plan' ? section.level === 3 : section.level >= 2;
  const showMeta = mode === 'plan' && section.level === 3 && section.dependencies;
  const html = marked.parse(section.body) as string;

  return (
    <div
      id={`section-${section.id}`}
      class={`section-view${isActive ? ' active' : ''}`}
    >
      <h2>{section.heading}</h2>

      {showMeta && (
        <div class="section-meta">
          {section.dependencies!.dependsOn.length > 0 && (
            <span>Depends on: {section.dependencies!.dependsOn.join(', ')}</span>
          )}
          {section.dependencies!.blocks.length > 0 && (
            <span>Blocks: {section.dependencies!.blocks.join(', ')}</span>
          )}
          {section.relatedFiles && section.relatedFiles.length > 0 && (
            <span>Files: {section.relatedFiles.join(', ')}</span>
          )}
          {section.verification && (
            <span>Verify: {section.verification}</span>
          )}
        </div>
      )}

      <div class="section-body" dangerouslySetInnerHTML={{ __html: html }} />

      {isReviewable && (
        <button class="add-comment-btn" onClick={onComment}>Add Comment</button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/browser/SectionView.test.tsx`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add src/browser/SectionView.tsx tests/browser/SectionView.test.tsx
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "feat: add SectionView component with markdown rendering"
```

---

### Task 8: TOCPanel

**Files:**
- Create: `src/browser/TOCPanel.tsx`
- Create: `tests/browser/TOCPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/browser/TOCPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { TOCPanel } from '../../src/browser/TOCPanel.js';
import { mockPlanDoc, mockGenericDoc } from './test-utils.js';
import type { ReviewComment } from '../../src/types.js';

describe('TOCPanel', () => {
  describe('plan mode', () => {
    it('renders milestone headings', () => {
      render(<TOCPanel doc={mockPlanDoc} comments={[]} activeSection={null} onNavigate={vi.fn()} />);
      expect(screen.getByText('Milestone 1')).toBeTruthy();
    });

    it('renders task items under milestones', () => {
      render(<TOCPanel doc={mockPlanDoc} comments={[]} activeSection={null} onNavigate={vi.fn()} />);
      expect(screen.getByText('Task 1')).toBeTruthy();
      expect(screen.getByText('Task 2')).toBeTruthy();
    });

    it('shows checkmark for commented sections', () => {
      const comments: ReviewComment[] = [
        { sectionId: '1.1', text: 'OK', timestamp: new Date() },
      ];
      const { container } = render(
        <TOCPanel doc={mockPlanDoc} comments={comments} activeSection={null} onNavigate={vi.fn()} />
      );
      const commented = container.querySelectorAll('.commented');
      expect(commented.length).toBe(1);
    });

    it('marks active section', () => {
      const { container } = render(
        <TOCPanel doc={mockPlanDoc} comments={[]} activeSection="1.1" onNavigate={vi.fn()} />
      );
      expect(container.querySelector('.toc-item.active')).toBeTruthy();
    });

    it('calls onNavigate with section id on click', () => {
      const onNavigate = vi.fn();
      render(<TOCPanel doc={mockPlanDoc} comments={[]} activeSection={null} onNavigate={onNavigate} />);
      fireEvent.click(screen.getByText('Task 1'));
      expect(onNavigate).toHaveBeenCalledWith('1.1');
    });
  });

  describe('generic mode', () => {
    it('renders flat section list', () => {
      render(<TOCPanel doc={mockGenericDoc} comments={[]} activeSection={null} onNavigate={vi.fn()} />);
      expect(screen.getByText('Section One')).toBeTruthy();
      expect(screen.getByText('Section Two')).toBeTruthy();
    });

    it('calls onNavigate on click', () => {
      const onNavigate = vi.fn();
      render(<TOCPanel doc={mockGenericDoc} comments={[]} activeSection={null} onNavigate={onNavigate} />);
      fireEvent.click(screen.getByText('Section One'));
      expect(onNavigate).toHaveBeenCalledWith('section-1');
    });

    it('shows checkmark for commented sections', () => {
      const comments: ReviewComment[] = [
        { sectionId: 'section-2', text: 'Comment', timestamp: new Date() },
      ];
      const { container } = render(
        <TOCPanel doc={mockGenericDoc} comments={comments} activeSection={null} onNavigate={vi.fn()} />
      );
      expect(container.querySelectorAll('.commented').length).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/browser/TOCPanel.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TOCPanel**

Create `src/browser/TOCPanel.tsx`:

```tsx
import type { PlanDocument, ReviewComment } from '../types.js';

interface TOCPanelProps {
  doc: PlanDocument;
  comments: ReviewComment[];
  activeSection: string | null;
  onNavigate: (sectionId: string) => void;
}

export function TOCPanel({ doc, comments, activeSection, onNavigate }: TOCPanelProps) {
  const commentedIds = new Set(comments.map((c) => c.sectionId));

  if (doc.mode === 'plan') {
    const milestones = doc.sections.filter((s) => s.level === 2);
    return (
      <nav class="toc-panel">
        {milestones.map((milestone) => {
          const tasks = doc.sections.filter((s) => s.parent === milestone.id);
          return (
            <div key={milestone.id} class="toc-milestone">
              <h3>{milestone.heading}</h3>
              <ul>
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    class={`toc-item${activeSection === task.id ? ' active' : ''}${commentedIds.has(task.id) ? ' commented' : ''}`}
                    onClick={() => onNavigate(task.id)}
                  >
                    <span class="toc-marker">{commentedIds.has(task.id) ? '\u2713' : '\u00A0'}</span>
                    <span class="toc-id">{task.id}</span>
                    <span class="toc-heading">{task.heading}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    );
  }

  const reviewable = doc.sections.filter((s) => s.level >= 2);
  return (
    <nav class="toc-panel">
      <ul>
        {reviewable.map((section) => (
          <li
            key={section.id}
            class={`toc-item${activeSection === section.id ? ' active' : ''}${commentedIds.has(section.id) ? ' commented' : ''}`}
            onClick={() => onNavigate(section.id)}
          >
            <span class="toc-marker">{commentedIds.has(section.id) ? '\u2713' : '\u00A0'}</span>
            <span class="toc-heading">{section.heading}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/browser/TOCPanel.test.tsx`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add src/browser/TOCPanel.tsx tests/browser/TOCPanel.test.tsx
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "feat: add TOCPanel component with plan/generic mode"
```

---

### Task 9: App Component + Browser Entry + Styles

**Files:**
- Create: `src/browser/App.tsx`
- Create: `tests/browser/App.test.tsx`
- Create: `src/browser/index.tsx`
- Create: `src/browser/styles.css`

- [ ] **Step 1: Write failing App tests**

Create `tests/browser/App.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { App } from '../../src/browser/App.js';
import { mockPlanDoc } from './test-utils.js';

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('fetches and renders document', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ document: mockPlanDoc }),
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Test Plan')).toBeTruthy();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/doc');
  });

  it('renders three panels after load', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ document: mockPlanDoc }),
    });

    const { container } = render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    expect(container.querySelector('.toc-panel')).toBeTruthy();
    expect(container.querySelector('.content-area')).toBeTruthy();
    expect(container.querySelector('.comment-sidebar')).toBeTruthy();
  });

  it('shows mode badge', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ document: mockPlanDoc }),
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('plan')).toBeTruthy();
    });
  });

  it('adds comment through UI flow', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ document: mockPlanDoc }),
    });

    render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Click Add Comment on first task section
    const addButtons = screen.getAllByText('Add Comment');
    fireEvent.click(addButtons[0]);

    // Type and submit comment
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Great task' } });
    fireEvent.click(screen.getByText('Add'));

    // Comment should appear in sidebar
    expect(screen.getByText('Great task')).toBeTruthy();
    expect(screen.getByText('Comments (1)')).toBeTruthy();
  });

  it('submits review via POST', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: () => Promise.resolve({ document: mockPlanDoc }) })
      .mockResolvedValueOnce({ ok: true });

    render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Add a comment
    const addButtons = screen.getAllByText('Add Comment');
    fireEvent.click(addButtons[0]);
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Review comment' } });
    fireEvent.click(screen.getByText('Add'));

    // Submit review
    fireEvent.click(screen.getByText('Submit Review'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/review', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  it('shows submitted state after successful submit', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: () => Promise.resolve({ document: mockPlanDoc }) })
      .mockResolvedValueOnce({ ok: true });

    render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Add comment and submit
    fireEvent.click(screen.getAllByText('Add Comment')[0]);
    fireEvent.input(screen.getByPlaceholderText('Add a comment...'), { target: { value: 'Done' } });
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Submit Review'));

    await waitFor(() => {
      expect(screen.getByText(/Review submitted/)).toBeTruthy();
    });
  });

  it('shows error state on fetch failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Error:/)).toBeTruthy();
    });
  });

  it('disables submit button when no comments', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ document: mockPlanDoc }),
    });

    render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    const submitBtn = screen.getByText('Submit Review') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/browser/App.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement App.tsx**

Create `src/browser/App.tsx`:

```tsx
import { useState, useEffect } from 'preact/hooks';
import type { PlanDocument, ReviewComment } from '../types.js';
import { TOCPanel } from './TOCPanel.js';
import { SectionView } from './SectionView.js';
import { CommentSidebar } from './CommentSidebar.js';

export function App() {
  const [doc, setDoc] = useState<PlanDocument | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [commentingSection, setCommentingSection] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/doc')
      .then((r) => r.json())
      .then((data) => setDoc(data.document))
      .catch((err) => setError(err.message));
  }, []);

  const handleNavigate = (sectionId: string) => {
    setActiveSection(sectionId);
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  const addComment = (sectionId: string, text: string) => {
    setComments((prev) => [...prev, { sectionId, text, timestamp: new Date() }]);
    setCommentingSection(null);
  };

  const editComment = (index: number, text: string) => {
    setComments((prev) => prev.map((c, i) => (i === index ? { ...c, text } : c)));
  };

  const deleteComment = (index: number) => {
    setComments((prev) => prev.filter((_, i) => i !== index));
  };

  const submitReview = async () => {
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      });
      if (res.ok) setSubmitted(true);
    } catch {
      setError('Failed to submit review');
    }
  };

  if (submitted) return <div class="submitted">Review submitted. You can close this tab.</div>;
  if (error) return <div class="loading">Error: {error}</div>;
  if (!doc) return <div class="loading">Loading...</div>;

  return (
    <div class="app">
      <header class="top-bar">
        <h1>{doc.title}</h1>
        <span class="mode-badge">{doc.mode}</span>
        <span class="comment-count">{comments.length} comment{comments.length !== 1 ? 's' : ''}</span>
        <button class="submit-btn" onClick={submitReview} disabled={comments.length === 0}>
          Submit Review
        </button>
      </header>
      <div class="panels">
        <TOCPanel
          doc={doc}
          comments={comments}
          activeSection={activeSection}
          onNavigate={handleNavigate}
        />
        <main class="content-area">
          {doc.sections.map((section) => (
            <SectionView
              key={section.id}
              section={section}
              mode={doc.mode}
              isActive={activeSection === section.id}
              onComment={() => setCommentingSection(section.id)}
            />
          ))}
        </main>
        <CommentSidebar
          comments={comments}
          sections={doc.sections}
          commentingSection={commentingSection}
          onAdd={addComment}
          onEdit={editComment}
          onDelete={deleteComment}
          onCancelComment={() => setCommentingSection(null)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create browser entry point**

Create `src/browser/index.tsx`:

```tsx
import { render } from 'preact';
import { App } from './App.js';

render(<App />, document.getElementById('app')!);
```

- [ ] **Step 5: Create styles.css**

Create `src/browser/styles.css`:

```css
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --bg-tertiary: #0f3460;
  --text-primary: #e0e0e0;
  --text-secondary: #a0a0a0;
  --accent: #00adb5;
  --accent-hover: #00ccd3;
  --border: #2a2a4a;
  --danger: #e74c3c;
  --success: #2ecc71;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.top-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.top-bar h1 { font-size: 18px; flex: 1; }

.mode-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  background: var(--bg-tertiary);
  color: var(--accent);
}

.comment-count { font-size: 14px; color: var(--text-secondary); }

.submit-btn {
  padding: 8px 16px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.submit-btn:hover { background: var(--accent-hover); }
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.panels { display: flex; flex: 1; overflow: hidden; }

/* TOC Panel */
.toc-panel {
  width: 220px;
  padding: 16px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  overflow-y: auto;
}

.toc-milestone h3 {
  font-size: 13px;
  color: var(--accent);
  margin: 12px 0 4px;
}

.toc-panel ul { list-style: none; }

.toc-item {
  display: flex;
  gap: 8px;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
}

.toc-item:hover { background: var(--bg-tertiary); }
.toc-item.active { background: var(--bg-tertiary); border-left: 2px solid var(--accent); }
.toc-item.commented .toc-marker { color: var(--success); }
.toc-id { color: var(--text-secondary); }

/* Content Area */
.content-area { flex: 1; padding: 20px; overflow-y: auto; }

.section-view {
  margin-bottom: 24px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.section-view.active { border-color: var(--accent); }

.section-view h2 { font-size: 16px; margin-bottom: 12px; }

.section-meta {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: 4px;
  font-size: 13px;
}

.section-meta span { display: block; color: var(--text-secondary); }

.section-body { font-size: 14px; line-height: 1.7; }
.section-body h1, .section-body h2, .section-body h3 { margin: 16px 0 8px; }
.section-body code { background: var(--bg-secondary); padding: 2px 6px; border-radius: 3px; font-size: 13px; }
.section-body pre { background: var(--bg-secondary); padding: 12px; border-radius: 6px; overflow-x: auto; }

.add-comment-btn {
  margin-top: 12px;
  padding: 6px 12px;
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.add-comment-btn:hover { background: var(--accent); color: white; }

/* Comment Sidebar */
.comment-sidebar {
  width: 300px;
  padding: 16px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border);
  overflow-y: auto;
}

.comment-sidebar h2 { font-size: 16px; margin-bottom: 12px; }

.commenting-for h3,
.comment-group h3 { font-size: 13px; color: var(--accent); margin: 12px 0 8px; }

.comment-card {
  padding: 10px;
  margin-bottom: 8px;
  background: var(--bg-primary);
  border-radius: 6px;
  font-size: 13px;
}

.comment-section { font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; }
.comment-text { margin: 6px 0; white-space: pre-wrap; }

.comment-actions { display: flex; gap: 8px; }
.comment-actions button {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
}
.comment-actions button:hover { color: var(--text-primary); }
.comment-actions button.delete:hover { color: var(--danger); }

.comment-input { margin: 8px 0; }
.comment-input textarea {
  width: 100%;
  min-height: 80px;
  padding: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
}
.comment-input textarea:focus { outline: none; border-color: var(--accent); }

.comment-input-actions { display: flex; gap: 8px; margin-top: 8px; }
.comment-input-actions button {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.comment-input-actions .add-btn { background: var(--accent); color: white; }
.comment-input-actions .add-btn:hover { background: var(--accent-hover); }
.comment-input-actions .cancel-btn { background: var(--bg-tertiary); color: var(--text-primary); }

.no-comments { color: var(--text-secondary); font-size: 13px; font-style: italic; }

.loading, .submitted {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  font-size: 18px;
}
.loading { color: var(--text-secondary); }
.submitted { color: var(--success); }
```

- [ ] **Step 6: Run App tests to verify they pass**

Run: `npx vitest run tests/browser/App.test.tsx`
Expected: All 9 tests PASS

- [ ] **Step 7: Run full browser test suite**

Run: `npx vitest run tests/browser/`
Expected: All browser tests PASS

- [ ] **Step 8: Commit**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add src/browser/ tests/browser/App.test.tsx
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "feat: add App root component, browser entry point, and dark theme styles"
```

---

### Task 10: esbuild Script + Asset Serving

**Files:**
- Create: `scripts/build-browser.js`
- Modify: `src/server/assets.ts`
- Create: `tests/build.test.ts`

- [ ] **Step 1: Write failing build integration test**

Create `tests/build.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outHtml = resolve(root, 'dist/browser/index.html');

describe('browser build', () => {
  beforeAll(() => {
    execSync('node scripts/build-browser.js', { cwd: root, stdio: 'pipe' });
  }, 30000);

  it('produces dist/browser/index.html', () => {
    expect(existsSync(outHtml)).toBe(true);
  });

  it('contains inline JavaScript', () => {
    const html = readFileSync(outHtml, 'utf-8');
    expect(html).toContain('<script>');
    // Should contain Preact-related code
    expect(html).toContain('preact');
  });

  it('contains inline CSS', () => {
    const html = readFileSync(outHtml, 'utf-8');
    expect(html).toContain('<style>');
    expect(html).toContain('--bg-primary');
  });

  it('is a valid HTML document', () => {
    const html = readFileSync(outHtml, 'utf-8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<div id="app">');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build.test.ts`
Expected: FAIL — `scripts/build-browser.js` not found or build fails

- [ ] **Step 3: Create build-browser.js**

Create `scripts/build-browser.js`:

```javascript
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const watch = process.argv.includes('--watch');

async function build() {
  const outJs = join(root, 'dist/browser/app.js');

  await esbuild.build({
    entryPoints: [join(root, 'src/browser/index.tsx')],
    bundle: true,
    outfile: outJs,
    format: 'iife',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: !watch,
    sourcemap: watch,
  });

  const js = readFileSync(outJs, 'utf-8');
  const css = readFileSync(join(root, 'src/browser/styles.css'), 'utf-8');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Plan Review</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${js}</script>
</body>
</html>`;

  mkdirSync(join(root, 'dist/browser'), { recursive: true });
  writeFileSync(join(root, 'dist/browser/index.html'), html);
  console.error('Browser build complete: dist/browser/index.html');
}

if (watch) {
  const ctx = await esbuild.context({
    entryPoints: [join(root, 'src/browser/index.tsx')],
    bundle: true,
    outfile: join(root, 'dist/browser/app.js'),
    format: 'iife',
    jsx: 'automatic',
    jsxImportSource: 'preact',
  });
  await ctx.watch();
  console.error('Watching for changes...');
} else {
  await build();
}
```

- [ ] **Step 4: Run build test to verify it passes**

Run: `npx vitest run tests/build.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Update assets.ts to serve real bundle**

Replace contents of `src/server/assets.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, '..', 'browser', 'index.html');

let cached: string | null = null;

export function getAssetHtml(): string {
  if (!cached) {
    cached = readFileSync(htmlPath, 'utf-8');
  }
  return cached;
}
```

- [ ] **Step 6: Update build script in package.json**

Verify `package.json` has:
```json
"build": "tsc && node scripts/build-browser.js",
```

Run: `npm run build`
Expected: Both `tsc` and browser build succeed. `dist/browser/index.html` exists.

- [ ] **Step 7: Commit**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add scripts/build-browser.js src/server/assets.ts tests/build.test.ts
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "feat: add esbuild browser bundler and asset serving"
```

---

### Task 11: CLI Integration

**Files:**
- Modify: `src/index.ts`
- Create: `tests/browser-integration.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/browser-integration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpTransport } from '../src/transport.js';
import { parse } from '../src/parser.js';
import { formatReview } from '../src/formatter.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReviewComment } from '../src/types.js';

const fixtureDir = resolve(import.meta.dirname, 'fixtures');

describe('browser review integration', () => {
  it('full flow: parse → transport → submit → format', async () => {
    const input = readFileSync(resolve(fixtureDir, 'plan-document.md'), 'utf-8');
    const doc = parse(input);

    const transport = new HttpTransport();
    transport.sendDocument(doc);

    const reviewPromise = new Promise<ReviewComment[]>((resolve) => {
      transport.onReviewSubmit(resolve);
    });

    const { url } = await transport.start(0);
    expect(url).toMatch(/^http:\/\/localhost:\d+/);

    // Simulate browser: fetch doc
    const docRes = await fetch(`${url}/api/doc`);
    const docData = await docRes.json();
    expect(docData.document.title).toBe('Feature X — Implementation Plan');
    expect(docData.document.mode).toBe('plan');

    // Simulate browser: submit review
    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'Schema looks good', timestamp: new Date() },
      { sectionId: '2.1', text: 'Need more detail on processor', timestamp: new Date() },
    ];
    const submitRes = await fetch(`${url}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments }),
    });
    expect(submitRes.status).toBe(200);

    // CLI receives comments
    const received = await reviewPromise;
    expect(received).toHaveLength(2);

    // Merge and format
    doc.comments = received;
    const output = formatReview(doc);
    expect(output).toContain('Schema looks good');
    expect(output).toContain('Need more detail on processor');
    expect(output).toContain('Sections reviewed: 2/4');

    await transport.stop();
  });

  it('GET / serves HTML page', async () => {
    const doc = parse('# Test\n\n## Section\n\nContent');
    const transport = new HttpTransport();
    transport.sendDocument(doc);
    const { url } = await transport.start(0);

    const res = await fetch(`${url}/`);
    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<div id="app">');

    await transport.stop();
  });
});
```

- [ ] **Step 2: Run integration test to verify it passes**

Run: `npx vitest run tests/browser-integration.test.ts`
Expected: All 2 tests PASS (transport + server already implemented)

- [ ] **Step 3: Add --browser flag to CLI**

Modify `src/index.ts`. Add the following changes:

**Add import** at top (after existing imports):

```typescript
import { HttpTransport } from './transport.js';
import { execSync as execSyncCmd } from 'node:child_process';
```

**Add `--browser` option** to commander chain (after the `--split-by` option):

```typescript
  .option('--browser', 'Open browser-based review UI')
```

**Update the `opts` type** in `.action()` and `run()` to include `browser?: boolean`:

```typescript
  .action(async (file: string | undefined, opts: { output?: string; outputFile?: string; splitBy?: string; browser?: boolean }) => {
```

```typescript
async function run(
  file: string | undefined,
  opts: { output?: string; outputFile?: string; splitBy?: string; browser?: boolean },
): Promise<void> {
```

**Replace the navigate call** (the block around line 74 `const reviewed = await navigate(doc, inputFromStdin);`) with:

```typescript
  let reviewed;
  if (opts.browser) {
    const transport = new HttpTransport();
    transport.sendDocument(doc);

    const reviewPromise = new Promise<ReviewComment[]>((resolve) => {
      transport.onReviewSubmit(resolve);
    });

    const { url } = await transport.start(0);
    process.stderr.write(`Review server running at ${url}\n`);

    try {
      execSyncCmd(`open ${url}`, { stdio: 'ignore' });
    } catch {
      process.stderr.write(`Open ${url} in your browser\n`);
    }

    doc.comments = await reviewPromise;
    await transport.stop();
    reviewed = doc;
  } else {
    reviewed = await navigate(doc, inputFromStdin);
  }
```

Also add `import type { ReviewComment } from './types.js';` — but `OutputTarget` is already imported from types, so update to:

```typescript
import type { OutputTarget, ReviewComment } from './types.js';
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass — existing 91 + new server/transport/browser/integration tests

- [ ] **Step 5: Manual smoke test**

Run: `npx tsx src/index.ts tests/fixtures/plan-document.md --browser`
Expected:
1. Terminal prints "Review server running at http://localhost:XXXXX"
2. Browser opens with three-panel review UI
3. Document displays correctly with milestones and tasks
4. Can add comments to sections
5. Submit closes server and outputs review

- [ ] **Step 6: Verify existing CLI mode is unaffected**

Run: `echo "done" | npx tsx src/index.ts tests/fixtures/plan-document.md -o stdout`
Expected: Standard CLI review flow works exactly as before

- [ ] **Step 7: Commit**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add src/index.ts tests/browser-integration.test.ts
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "feat: add --browser flag for browser-based review mode"
```

- [ ] **Step 8: Run build to verify everything compiles**

Run: `npm run build`
Expected: `tsc` compiles cleanly, browser build produces `dist/browser/index.html`, no errors

- [ ] **Step 9: Final commit with updated build**

```bash
git -C /Users/alvarocarvalho/desenv/personal/plan-review add -A
git -C /Users/alvarocarvalho/desenv/personal/plan-review commit -m "chore: build artifacts for browser review mode"
```
