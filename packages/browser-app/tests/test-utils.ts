import type { PlanDocument } from '@plan-review/core';

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

export const mockGenericDoc: PlanDocument = {
  title: 'Generic Doc',
  metadata: {},
  mode: 'generic',
  sections: [
    { id: 'section-1', heading: 'Section One', level: 2, body: 'First section' },
    { id: 'section-2', heading: 'Section Two', level: 2, body: 'Second section' },
  ],
  comments: [],
};
