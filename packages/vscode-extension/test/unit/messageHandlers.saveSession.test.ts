import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMessageHandlers } from '../../src/messageHandlers.js';
import { computeContentHash, loadSession, clearSession } from '@plan-review/core';

let tmp: string;
let planPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pr-'));
  planPath = join(tmp, 'plan.md');
  writeFileSync(planPath, '# P\n## S\nbody\n');
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  // Session files live in ~/.plan-review/sessions/ keyed by a hash of planPath.
  // Since each test creates a unique tmp dir, the path hash is unique per test,
  // so there's no cross-test pollution. Still, clean it up to be a good citizen.
  clearSession(planPath);
});

describe('messageHandlers.saveSession', () => {
  it('persists comments via core.saveSession so loadSession returns them', async () => {
    const handlers = createMessageHandlers();
    const contentHash = computeContentHash('# P\n## S\nbody\n');
    await handlers.saveSession({
      planFsPath: planPath,
      contentHash,
      comments: [{ sectionId: 's', text: 'hi', timestamp: new Date() }],
      activeSection: 's',
    });
    const loaded = loadSession(planPath, contentHash);
    expect(loaded?.comments).toHaveLength(1);
    expect(loaded?.comments[0].text).toBe('hi');
    expect(loaded?.activeSection).toBe('s');
    expect(loaded?.stale).toBe(false);
  });
});
