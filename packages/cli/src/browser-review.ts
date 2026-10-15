import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import {
  FileReviewStore,
  formatPausedNotice,
  formatReviewOutput,
  openReview,
  saveProgress,
  submitRound,
  type OpenReviewInput,
} from '@plan-review/core';
import { HttpTransport } from './transport.js';

export type BrowserReviewOptions = Omit<OpenReviewInput, 'now'>;
export interface BrowserReviewResult {
  kind: 'submitted' | 'paused';
  output: string;
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const HEARTBEAT_TIMEOUT_MS = 30 * 1000;

export function createReviewStore(): FileReviewStore {
  const home = process.env.PLAN_REVIEW_HOME;
  return new FileReviewStore(home === undefined ? {} : { dir: join(home, 'reviews') });
}

export async function browserReview(opts: BrowserReviewOptions): Promise<BrowserReviewResult> {
  const store = createReviewStore();
  let { review, loaded } = await openReview(store, { ...opts, now: new Date() });
  const itemIds = new Set(loaded.items.map((item) => item.id));
  const transport = new HttpTransport();
  transport.setLoaded(loaded);
  transport.setAssetBaseDir(opts.planPath ? dirname(opts.planPath) : null);

  // Serialize writes so a submit or pause includes all accepted autosaves.
  let pending = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation);
    pending = result.then(() => {}, () => {});
    return result;
  };
  let idleTimer: NodeJS.Timeout | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  const clearTimers = (): void => {
    clearTimeout(idleTimer);
    clearTimeout(heartbeatTimer);
  };
  const drain = async (): Promise<void> => {
    let drained: Promise<void>;
    do {
      drained = pending;
      await drained;
    } while (drained !== pending);
  };
  let responseFinished!: () => void;
  const submitResponseFinished = new Promise<void>((resolve) => { responseFinished = resolve; });
  let ending = false;
  let submitted: BrowserReviewResult | undefined;
  let finish!: () => void;
  const outcome = new Promise<BrowserReviewResult>((resolve, reject) => {
    finish = () => {
      if (ending) return;
      ending = true;
      clearTimers();
      void (async () => {
        await drain();
        if (!submitted) {
          // A cancel beacon can arrive before the webview's final autosave.
          await new Promise<void>((done) => setTimeout(done, 750));
          await drain();
        }
        if (submitted) await submitResponseFinished;
        await transport.stop();
        // Include saves accepted by requests already in flight during close.
        await drain();
        resolve(submitted ?? {
          kind: 'paused', output: formatPausedNotice(review, loaded.items),
        });
      })().catch(reject);
    };
  });
  const resetIdleTimer = (): void => {
    if (ending || submitted) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(finish, IDLE_TIMEOUT_MS);
  };

  transport.onProgress((update) => {
    if (submitted) return Promise.resolve();
    resetIdleTimer();
    return enqueue(async () => {
      if (submitted) return;
      try {
        review = await saveProgress(store, review.id, update, new Date(), itemIds);
        loaded = {
          ...loaded,
          review: { ...loaded.review, answers: review.answers, threads: review.threads },
        };
        transport.setLoaded(loaded);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Failed to save progress: ${message}\n`);
        throw err;
      }
    });
  });
  transport.onSubmit((request) => {
    if (ending) return Promise.reject(new Error('Review is no longer active'));
    return enqueue(async () => {
      review = await submitRound(store, review.id, request, new Date());
      const output = formatReviewOutput(review, loaded.items, loaded.document);
      submitted = { kind: 'submitted', output };
      return output;
    });
  });
  transport.onSubmitFinished(() => {
    responseFinished();
    finish();
  });
  transport.onHeartbeat(() => {
    if (ending) return;
    resetIdleTimer();
    clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(finish, HEARTBEAT_TIMEOUT_MS);
  });
  transport.onPause(() => {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = undefined;
  });
  transport.onCancel(finish);

  try {
    const { url } = await transport.start(0);
    resetIdleTimer();
    process.stderr.write(`Review server running at ${url}\n`);

    try {
      const openCmd = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start'
        : 'xdg-open';
      const opened = spawnSync(openCmd, [url], { stdio: 'ignore' });
      if (opened?.error || (opened?.status !== undefined && opened.status !== 0)) {
        process.stderr.write(`Open ${url} in your browser\n`);
      }
    } catch {
      process.stderr.write(`Open ${url} in your browser\n`);
    }

    return await outcome;
  } finally {
    clearTimers();
    await transport.stop();
  }
}
