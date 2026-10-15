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

import { terminalReview } from '../src/terminal-review.js';
import { createReviewStore } from '../src/browser-review.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plan-review-terminal-review-'));
  vi.stubEnv('PLAN_REVIEW_HOME', home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe('terminalReview', () => {
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
