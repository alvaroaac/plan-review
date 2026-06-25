# Migration to 0.1.0

`@plan-review/core` 0.1.0 replaces module-level session helpers with explicit stores and moves stale-session decisions into host code.

## Removed Session APIs

| Removed API | Replacement |
| --- | --- |
| `getSessionDir()` | `DEFAULT_SESSION_DIR` |
| `saveSession(planPath, contentHash, comments, activeSection)` | `store.save(key, sessionData)` |
| `loadSession(planPath, currentContentHash)` | `store.load(key)` plus host-level stale comparison |
| `clearSession(planPath)` | `store.clear(key)` |
| `listSessions()` | `store.list()` plus host-level stale comparison when needed |
| `SessionLoadResult` | A host-defined result shape |

`FileSessionStore` no longer receives the current content hash when loading. Load the session first, then compare `session.contentHash` to `computeContentHash(currentContent)` in the CLI, extension, server, or other host.

## Legacy CLI-Compatible Storage

Existing CLI sessions were stored in `~/.plan-review/sessions/*.json`, keyed by a hash of the absolute plan path. To keep using the same files, construct a `FileSessionStore` with `DEFAULT_SESSION_DIR` and pass the same absolute plan path as the key.

```ts
import {
  DEFAULT_SESSION_DIR,
  FileSessionStore,
  computeContentHash,
  type SessionData,
} from '@plan-review/core';
import { promises as fs } from 'node:fs';

const store = new FileSessionStore({ dir: DEFAULT_SESSION_DIR });

const key = '/Users/alvaro/project/docs/plan.md';
const content = await fs.readFile(key, 'utf-8');
const currentHash = computeContentHash(content);

const loaded = await store.load(key);
const restored = loaded
  ? {
      comments: loaded.comments,
      activeSection: loaded.activeSection,
      stale: loaded.contentHash !== currentHash,
    }
  : null;

const nextSession: SessionData = {
  version: 1,
  planPath: key,
  contentHash: currentHash,
  comments: restored?.comments ?? [],
  activeSection: restored?.activeSection ?? null,
  lastModified: new Date().toISOString(),
};

await store.save(key, nextSession);
```

Existing `~/.plan-review/sessions/*.json` files continue to load when callers pass the same absolute plan path key and use `DEFAULT_SESSION_DIR`.
