import { describe, it, expect } from 'vitest';
import { FakeReviewClient } from '../src/reviewClient.js';
import type { PlanDocument, ReviewComment } from '../src/types.js';

const doc: PlanDocument = {
  title: 'T',
  metadata: {},
  mode: 'generic',
  sections: [],
  comments: [],
};

describe('FakeReviewClient', () => {
  it('returns the document supplied at construction', async () => {
    const client = new FakeReviewClient({ document: doc });
    await expect(client.loadDocument()).resolves.toEqual({ document: doc, contentHash: undefined });
  });

  it('records session saves', async () => {
    const client = new FakeReviewClient({ document: doc });
    await client.saveSession({ comments: [], activeSection: null, contentHash: 'h' });
    expect(client.sessionSaves).toHaveLength(1);
  });

  it('records submits and resolves ok', async () => {
    const client = new FakeReviewClient({ document: doc });
    const comments: ReviewComment[] = [{ sectionId: 's1', text: 'hi', timestamp: new Date() }];
    await expect(client.submitReview(comments)).resolves.toEqual({ ok: true });
    expect(client.submits).toEqual([comments]);
  });
});
