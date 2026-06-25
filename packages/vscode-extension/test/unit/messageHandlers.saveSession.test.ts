import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMessageHandlers } from '../../src/messageHandlers.js';
import { computeContentHash, FileSessionStore } from '@plan-review/core';

let tmp: string;
let planPath: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pr-'));
  planPath = join(tmp, 'plan.md');
  await writeFile(planPath, '# P\n## S\nbody\n');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('messageHandlers.saveSession', () => {
  it('persists comments through an injected FileSessionStore and restores them on load', async () => {
    const store = new FileSessionStore({ dir: join(tmp, 'sessions') });
    const handlers = createMessageHandlers({ sessionStore: store });
    const contentHash = computeContentHash('# P\n## S\nbody\n');

    await handlers.saveSession({
      planFsPath: planPath,
      contentHash,
      comments: [{ sectionId: 's', text: 'hi', timestamp: new Date() }],
      activeSection: 's',
    });

    const loaded = await handlers.loadDocument({ planFsPath: planPath });

    expect(loaded.restoredSession?.comments).toHaveLength(1);
    expect(loaded.restoredSession?.comments[0].text).toBe('hi');
    expect(loaded.restoredSession?.activeSection).toBe('s');
    expect(loaded.restoredSession?.stale).toBe(false);
  });
});
