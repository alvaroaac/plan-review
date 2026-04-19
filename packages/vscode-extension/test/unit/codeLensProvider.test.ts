import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }) },
  CodeLens: class {},
  Range: class {},
}));

import { computeCodeLenses } from '../../src/codeLensProvider.js';

describe('computeCodeLenses', () => {
  const planMarkdown = [
    '# My Plan',
    '',
    '## Milestone 1',
    '',
    '### Task 1.1',
    '',
    '**Verification:** `npm test`',
    '',
  ].join('\n');
  const generic = '# Not a plan\njust notes';

  it('returns a lens for plan-mode documents when mode=auto', () => {
    const r = computeCodeLenses(planMarkdown, { planModeDetection: 'auto', codeLensEnabled: true });
    expect(r).toHaveLength(1);
    expect(r[0].line).toBe(0);
  });
  it('returns no lens for generic markdown when mode=auto', () => {
    const r = computeCodeLenses(generic, { planModeDetection: 'auto', codeLensEnabled: true });
    expect(r).toHaveLength(0);
  });
  it('always returns a lens when mode=always', () => {
    const r = computeCodeLenses(generic, { planModeDetection: 'always', codeLensEnabled: true });
    expect(r).toHaveLength(1);
  });
  it('never returns a lens when mode=never', () => {
    const r = computeCodeLenses(planMarkdown, { planModeDetection: 'never', codeLensEnabled: true });
    expect(r).toHaveLength(0);
  });
  it('returns no lens when codeLensEnabled=false', () => {
    const r = computeCodeLenses(planMarkdown, { planModeDetection: 'always', codeLensEnabled: false });
    expect(r).toHaveLength(0);
  });
});
