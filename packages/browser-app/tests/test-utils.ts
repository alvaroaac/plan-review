import { h, type ComponentChildren } from 'preact';
import { render } from '@testing-library/preact';
import type { Answer, LineAnchor, LoadedReview, PlanDocument, ReviewItem, Thread } from '@plan-review/core';
import { FakeReviewClient } from '@plan-review/core/client';
import { ReviewProvider, useReview } from '../src/state/ReviewContext.js';
import type { ReviewAction, ReviewState } from '../src/state/reducer.js';

export const mockPlanDoc: PlanDocument = {
  title: 'Test Plan',
  metadata: {},
  mode: 'plan',
  sections: [
    { id: 'milestone-1', heading: 'Milestone 1', level: 2, body: 'Setup work' },
    {
      id: '1.1', heading: 'Task 1', level: 3, body: '**Bold** and `code`',
      parent: 'milestone-1',
      dependencies: { dependsOn: [], blocks: ['1.2'] },
    },
    {
      id: '1.2', heading: 'Task 2', level: 3, body: 'Second task content',
      parent: 'milestone-1',
      dependencies: { dependsOn: ['1.1'], blocks: [] },
    },
  ],
  comments: [],
};

export const decisionItem: ReviewItem = {
  id: 'retry-backoff',
  kind: 'decision',
  label: 'Retry backoff',
  question: 'How should retries back off?',
  options: [
    { key: 'A', text: 'Exponential', pick: true },
    { key: 'B', text: 'Circuit breaker', detail: 'after 90 s', pick: false },
  ],
  sectionId: '1.1',
  hash: 'h-retry',
};

export const assumptionItem: ReviewItem = {
  id: 'auth-latency',
  kind: 'assumption',
  label: 'Auth server latency',
  question: 'The auth server answers within 200 ms.',
  sectionId: '1.2',
  hash: 'h-latency',
};

export function mockLoaded(overrides: Partial<LoadedReview> = {}): LoadedReview {
  return {
    document: mockPlanDoc,
    items: [decisionItem, assumptionItem],
    warnings: [],
    review: { id: 'rv_abc12345', round: 2, status: 'open', answers: {}, threads: [] },
    ...overrides,
  };
}

export function answer(item: ReviewItem, choice: string, hash = item.hash): Answer {
  return { choice, note: '', itemHash: hash, round: 1, updatedAt: '2026-10-15T10:00:00.000Z' };
}

export function thread(id: string, sectionId: string, anchor: LineAnchor | null, patch: Partial<Thread> = {}): Thread {
  return {
    id, sectionId, anchor, resolved: false, outdated: false, createdRound: 1,
    comments: [{ id: `c-${id}`, author: 'reviewer', body: 'Comment', createdAt: '2026-10-15T10:00:00.000Z' }],
    ...patch,
  };
}

export function lineAnchor(startLine: number, lineTexts: string[]): LineAnchor {
  return { type: 'lines', startLine, endLine: startLine + lineTexts.length - 1, lineTexts };
}

/** Renders `ui` inside a ReviewProvider; `review.current` always holds the latest state and dispatch. */
export function renderWithReview(ui: ComponentChildren, loaded: LoadedReview = mockLoaded()) {
  const review = {} as { current: { state: ReviewState; dispatch: (a: ReviewAction) => void } };
  function Probe() {
    review.current = useReview();
    return null;
  }
  const client = new FakeReviewClient({ loaded });
  const utils = render(h(ReviewProvider, { client, loaded, theme: 'light', children: [h(Probe, null), ui] }));
  return { ...utils, review };
}
