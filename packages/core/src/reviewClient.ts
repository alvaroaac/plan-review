import type { PlanDocument, ReviewComment, ReviewSubmission } from './types.js';

export interface SessionState {
  comments: ReviewComment[];
  activeSection: string | null;
  contentHash: string;
}

export interface ReviewClient {
  loadDocument(): Promise<{
    document: PlanDocument;
    contentHash?: string;
    restoredSession?: { comments: ReviewComment[]; activeSection: string | null; stale: boolean };
  }>;
  saveSession(state: SessionState): Promise<void>;
  submitReview(submission: ReviewSubmission): Promise<{ ok: true }>;
}

export class FakeReviewClient implements ReviewClient {
  readonly sessionSaves: SessionState[] = [];
  readonly submits: ReviewSubmission[] = [];
  constructor(private readonly opts: { document: PlanDocument; contentHash?: string }) {}
  async loadDocument() {
    return { document: this.opts.document, contentHash: this.opts.contentHash };
  }
  async saveSession(state: SessionState) { this.sessionSaves.push(state); }
  async submitReview(submission: ReviewSubmission) { this.submits.push(submission); return { ok: true as const }; }
}
