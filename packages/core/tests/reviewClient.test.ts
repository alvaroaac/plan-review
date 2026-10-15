import { describe, it, expect } from 'vitest';
import { FakeReviewClient } from '../src/reviewClient.js';
import type { LoadedReview, ProgressUpdate, SubmitRequest } from '../src/types.js';

const loaded: LoadedReview = {
  document: { title: 'T', metadata: {}, mode: 'generic', sections: [], comments: [] },
  items: [],
  warnings: [],
  review: { id: 'rv_abc12345', round: 1, status: 'open', answers: {}, threads: [] },
};

describe('FakeReviewClient', () => {
  it('returns the loaded review supplied at construction', async () => {
    const client = new FakeReviewClient({ loaded });
    await expect(client.loadDocument()).resolves.toBe(loaded);
  });

  it('records progress saves and submits in order', async () => {
    const client = new FakeReviewClient({ loaded });
    const first: ProgressUpdate = { answers: {}, threads: [] };
    const second: ProgressUpdate = { answers: {}, threads: [] };
    const submit: SubmitRequest = { verdict: 'approved', summary: 'LGTM' };
    await client.saveProgress(first);
    await expect(client.submitReview(submit)).resolves.toEqual({ ok: true, output: '' });
    await client.saveProgress(second);
    expect(client.progressSaves).toEqual([first, second]);
    expect(client.submits).toEqual([submit]);
  });
});
