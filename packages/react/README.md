# @plan-review/react

React hooks for using the framework-neutral autosave helper from `@plan-review/core`.

## Autosaving a Snapshot

Use `useCallback` so the `save` function is referentially stable. The hooks recreate the autosave controller when `save`, `delayMs`, or `onError` changes.

```tsx
import { useCallback, useMemo } from 'react';
import {
  useAutosaveSnapshot,
  useFlushOnUnload,
} from '@plan-review/react';
import type { SessionData, SessionStore } from '@plan-review/core';

interface ReviewEditorProps {
  store: SessionStore;
  session: SessionData;
}

export function ReviewEditor({ store, session }: ReviewEditorProps) {
  const save = useCallback(
    async (snapshot: SessionData) => {
      await store.save(snapshot.planPath, snapshot);
    },
    [store],
  );

  const onError = useCallback((err: unknown) => {
    console.warn('Autosave failed', err);
  }, []);

  const snapshot = useMemo(
    () => ({
      ...session,
      lastModified: new Date().toISOString(),
    }),
    [session],
  );

  const autosave = useAutosaveSnapshot(snapshot, {
    delayMs: 500,
    save,
    onError,
  });

  useFlushOnUnload(autosave);

  return null;
}
```

`useAutosaveSnapshot` schedules whenever the snapshot changes. `useFlushOnUnload` flushes a pending save during `beforeunload`.
