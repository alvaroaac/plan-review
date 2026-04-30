import type { ReviewClient, SessionState, PlanDocument, ReviewComment, ReviewSubmission } from '@plan-review/core';
import type { WebviewRequest, WebviewResponse } from './protocol.js';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const TIMEOUT_MS = 30_000;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class PostMessageReviewClient implements ReviewClient {
  private readonly pending = new Map<string, Pending>();
  private readonly api = acquireVsCodeApi();
  private seq = 0;

  constructor() {
    window.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data as WebviewResponse;
      if (!msg || typeof msg !== 'object' || !('id' in msg)) return;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(msg.id);
      if (msg.kind === 'res') entry.resolve(msg.result);
      else if (msg.kind === 'err') entry.reject(new Error(msg.error));
    });
  }

  private call<T>(method: WebviewRequest['method'], params?: unknown): Promise<T> {
    const id = `r${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.api.postMessage({ id, kind: 'req', method, params } satisfies WebviewRequest);
    });
  }

  loadDocument() {
    return this.call<{
      document: PlanDocument;
      contentHash: string;
      restoredSession?: { comments: ReviewComment[]; activeSection: string | null; stale: boolean };
    }>('loadDocument');
  }
  saveSession(state: SessionState) { return this.call<void>('saveSession', state); }
  submitReview(submission: ReviewSubmission) {
    return this.call<{ ok: true }>('submitReview', submission);
  }
}
