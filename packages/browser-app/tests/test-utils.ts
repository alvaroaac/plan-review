import type { LoadedReview, PlanDocument, ReviewItem } from '@plan-review/core';

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
