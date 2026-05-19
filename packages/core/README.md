# @plan-review/core

Framework-neutral Plan Review primitives for parsing review documents, formatting submissions, storing review sessions, and scheduling autosaves.

## FileSessionStore

`FileSessionStore` persists `SessionData` as JSON files. Keys are opaque strings: callers decide whether a key is an absolute plan path, a remote document id, or another stable identifier. To preserve legacy CLI-compatible storage, pass the same absolute plan path as the key and use `DEFAULT_SESSION_DIR`; this keeps existing filenames derived from the absolute path hash.

```ts
import {
  DEFAULT_SESSION_DIR,
  FileSessionStore,
  computeContentHash,
  type SessionData,
} from '@plan-review/core';
import { promises as fs } from 'node:fs';

const planPath = '/Users/alvaro/project/docs/plan.md';
const planText = await fs.readFile(planPath, 'utf-8');
const contentHash = computeContentHash(planText);

const store = new FileSessionStore({ dir: DEFAULT_SESSION_DIR });

const session: SessionData = {
  version: 1,
  planPath,
  contentHash,
  comments: [
    {
      sectionId: 'task-1',
      text: 'Clarify the verification step.',
      timestamp: new Date(),
    },
  ],
  activeSection: 'task-1',
  lastModified: new Date().toISOString(),
};

await store.save(planPath, session);

const loaded = await store.load(planPath);
if (loaded) {
  const stale = loaded.contentHash !== contentHash;

  if (!stale) {
    console.log(`Restored ${loaded.comments.length} comments`);
  }
}
```

`store.list()` returns stored metadata only. If your host uses absolute file path keys and needs stale/current status, compare each loaded session's `contentHash` with a freshly computed `computeContentHash()` for that file. Hosts that use other opaque keys should resolve the current document content through their own key lookup.

```ts
const sessions = await store.list();

for (const meta of sessions) {
  const loaded = await store.load(meta.key);
  const currentText = await fs.readFile(meta.key, 'utf-8');
  const stale = loaded
    ? loaded.contentHash !== computeContentHash(currentText)
    : null;

  console.log(meta.key, { comments: meta.commentCount, stale });
}
```

## createAutosave

`createAutosave` debounces snapshots and exposes explicit `schedule`, `flush`, and `cancel` controls. Provide `onError` to handle failed saves; otherwise errors are rethrown asynchronously.

```ts
import {
  FileSessionStore,
  createAutosave,
  type SessionData,
} from '@plan-review/core';

const store = new FileSessionStore({ dir: '/tmp/plan-review-sessions' });
const key = 'forge:FUL-42:plan';

const autosave = createAutosave<SessionData>({
  delayMs: 500,
  save: async (snapshot) => {
    await store.save(key, snapshot);
  },
  onError: (err) => {
    console.warn('Autosave failed', err);
  },
});

const session: SessionData = {
  version: 1,
  planPath: key,
  contentHash: 'sha256:...',
  comments: [],
  activeSection: null,
  lastModified: new Date().toISOString(),
};

autosave.schedule(session);

await autosave.flush();

autosave.cancel();
```
