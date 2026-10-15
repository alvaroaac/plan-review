import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { PlanDocument } from '@plan-review/core';

vi.mock('../src/navigator.js', () => ({
  navigate: vi.fn(async (doc: PlanDocument) => {
    doc.comments.push({ sectionId: doc.sections[0].id, text: 'looks risky', timestamp: new Date() });
    return doc;
  }),
}));

import { navigate } from '../src/navigator.js';
import { terminalReview } from '../src/terminal-review.js';
import { createReviewStore } from '../src/browser-review.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plan-review-terminal-review-'));
  vi.stubEnv('PLAN_REVIEW_HOME', home);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe('terminalReview', () => {
  it.each([false, true])('persists incremental comments with stable ids before navigate returns (approve=%s)', async (approve) => {
    let ids: string[] = [];
    let commentIds: string[] = [];
    vi.mocked(navigate).mockImplementationOnce(async (doc, _stdin, onChange, options) => {
      expect(onChange).toBeTypeOf('function');
      doc.comments.push({ sectionId: doc.sections[0].id, text: 'first', timestamp: new Date() });
      await onChange!();
      let [saved] = await createReviewStore().list();
      expect(saved.threads).toHaveLength(1);
      expect(saved.rounds[0].submittedAt).toBeUndefined();
      const firstId = saved.threads[0].id;
      const firstCommentId = saved.threads[0].comments[0].id;
      doc.comments.push({ sectionId: doc.sections[0].id, text: 'second', timestamp: new Date() });
      const pending = onChange!();
      const repeated = onChange!();
      await Promise.all([pending, repeated]);
      [saved] = await createReviewStore().list();
      expect(saved.threads).toHaveLength(2);
      expect(saved.threads[0].id).toBe(firstId);
      expect(saved.threads[0].comments[0].id).toBe(firstCommentId);
      ids = saved.threads.map((thread) => thread.id);
      commentIds = saved.threads.map((thread) => thread.comments[0].id);
      if (approve) options?.onApprove?.();
      return doc;
    });
    await terminalReview(false, { markdown: '# Plan\n\n## Storage\n\nBody' });
    const [saved] = await createReviewStore().list();
    expect(saved.threads.map((thread) => thread.id)).toEqual(ids);
    expect(saved.threads.map((thread) => thread.comments[0].id)).toEqual(commentIds);
    expect(saved.rounds[0].verdict).toBe(approve ? 'approved' : 'changes_requested');
  });

  it('saves terminal comments as reviewer threads and reports them in the output', async () => {
    const output = await terminalReview(false, { markdown: '# Plan\n\n## Storage\n\nBody\n' });
    expect(output).toContain('## Open threads');
    expect(output).toContain('**Reviewer:** looks risky');

    const [review] = await createReviewStore().list();
    expect(review.threads).toMatchObject([
      { anchor: null, resolved: false, outdated: false, createdRound: 1, comments: [{ author: 'reviewer', body: 'looks risky' }] },
    ]);
    expect(review.rounds[0].verdict).toBe('changes_requested');
  });
});
