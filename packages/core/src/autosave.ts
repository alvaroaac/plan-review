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
  let hasPendingSnapshot = false;
  let pendingSnapshot: T;
  let pendingResolve: (() => void) | null = null;
  let pendingPromise: Promise<void> | null = null;
  let inFlightPromise: Promise<void> | null = null;

  function ensurePendingPromise(): Promise<void> {
    if (!pendingPromise) {
      pendingPromise = new Promise<void>((resolve) => {
        pendingResolve = resolve;
      });
    }

    return pendingPromise;
  }

  async function fire(): Promise<void> {
    if (!hasPendingSnapshot) return;

    const snapshot = pendingSnapshot;
    hasPendingSnapshot = false;
    timer = null;

    const resolveCurrent = pendingResolve;
    pendingResolve = null;
    pendingPromise = null;

    let savePromise: Promise<void>;
    try {
      savePromise = opts.save(snapshot);
    } catch (err) {
      savePromise = Promise.reject(err);
    }

    const currentPromise = savePromise.catch((err) => {
      if (opts.onError) {
        opts.onError(err);
      } else {
        setTimeout(() => {
          throw err;
        }, 0);
      }
    }).finally(() => {
      resolveCurrent?.();
      if (inFlightPromise === currentPromise) {
        inFlightPromise = null;
      }
    });

    inFlightPromise = currentPromise;
    await inFlightPromise;
  }

  return {
    schedule(snapshot: T): void {
      pendingSnapshot = snapshot;
      hasPendingSnapshot = true;
      ensurePendingPromise();

      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        void fire();
      }, opts.delayMs);
    },

    flush(): Promise<void> {
      if (timer === null && !hasPendingSnapshot) {
        return inFlightPromise ?? Promise.resolve();
      }

      if (timer !== null) clearTimeout(timer);
      const promise = ensurePendingPromise();
      void fire();
      return promise;
    },

    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      hasPendingSnapshot = false;

      const resolveCurrent = pendingResolve;
      pendingResolve = null;
      pendingPromise = null;
      resolveCurrent?.();
    },
  };
}
