import type { ReviewClient, SessionState, PlanDocument, ReviewComment } from '@plan-review/core';

export class HttpReviewClient implements ReviewClient {
  async loadDocument(): Promise<{ document: PlanDocument }> {
    const res = await fetch('/api/doc');
    if (!res.ok) throw new Error(`loadDocument failed: ${res.status}`);
    return res.json();
  }

  async saveSession(state: SessionState): Promise<void> {
    const res = await fetch('/api/session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (!res.ok) throw new Error(`saveSession failed: ${res.status}`);
  }

  async submitReview(comments: ReviewComment[]): Promise<{ ok: true }> {
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments }),
    });
    if (!res.ok) throw new Error(`submitReview failed: ${res.status}`);
    return { ok: true };
  }
}
