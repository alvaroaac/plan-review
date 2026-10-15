import type { LoadedReview, ProgressUpdate, SubmitRequest } from './types.js';

export interface ReviewClient {
  loadDocument(): Promise<LoadedReview>;
  saveProgress(update: ProgressUpdate): Promise<void>;
  submitReview(req: SubmitRequest): Promise<{ ok: true; output: string }>;
}

export class FakeReviewClient implements ReviewClient {
  readonly progressSaves: ProgressUpdate[] = [];
  readonly submits: SubmitRequest[] = [];
  constructor(private readonly opts: { loaded: LoadedReview }) {}
  async loadDocument() { return this.opts.loaded; }
  async saveProgress(update: ProgressUpdate) { this.progressSaves.push(update); }
  async submitReview(req: SubmitRequest) { this.submits.push(req); return { ok: true as const, output: '' }; }
}
