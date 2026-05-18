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
    if (options?.enabled === false) {
      autosave.cancel();
      return;
    }

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

    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }, [autosave]);
}
