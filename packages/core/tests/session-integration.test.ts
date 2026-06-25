import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileSessionStore,
  computeContentHash,
  type ReviewComment,
  type SessionData,
} from '../src/index.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plan-review-integration-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeSession(
  planPath: string,
  contentHash: string,
  comments: ReviewComment[],
  activeSection: string | null,
): SessionData {
  return {
    version: 1,
    planPath,
    contentHash,
    comments,
    activeSection,
    lastModified: new Date('2026-01-15T10:00:00.000Z').toISOString(),
  };
}

describe('session integration', () => {
  const planPath = '/tmp/integration-test-plan.md';
  const planContent = '# Test Plan\n\n## Task 1\n\nDo something.';
  const hash = computeContentHash(planContent);

  it('round-trips, lets host code detect stale content, lists metadata, and clears', async () => {
    const store = new FileSessionStore({ dir });
    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'Fix this', timestamp: new Date('2026-01-15T10:00:00Z') },
      { sectionId: '1.2', text: 'Check that', timestamp: new Date('2026-01-15T10:01:00Z') },
    ];

    await store.save(planPath, makeSession(planPath, hash, comments, '1.1'));

    const result = await store.load(planPath);
    expect(result).not.toBeNull();
    expect(result?.contentHash).toBe(hash);
    expect(result?.contentHash).not.toBe(computeContentHash('modified plan'));
    expect(result?.comments).toHaveLength(2);
    expect(result?.comments[0].timestamp).toBeInstanceOf(Date);
    expect(result?.activeSection).toBe('1.1');

    await expect(store.list()).resolves.toEqual([
      {
        key: planPath,
        commentCount: 2,
        lastModified: '2026-01-15T10:00:00.000Z',
      },
    ]);

    await store.clear(planPath);
    await expect(store.load(planPath)).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('stores the same file at two paths as independent sessions', async () => {
    const store = new FileSessionStore({ dir });
    await store.save(
      '/tmp/plan-copy-1.md',
      makeSession('/tmp/plan-copy-1.md', hash, [
        { sectionId: '1.1', text: 'A', timestamp: new Date('2026-01-15T10:00:00Z') },
      ], null),
    );
    await store.save(
      '/tmp/plan-copy-2.md',
      makeSession('/tmp/plan-copy-2.md', hash, [
        { sectionId: '2.1', text: 'B', timestamp: new Date('2026-01-15T10:00:00Z') },
      ], null),
    );

    await expect(store.load('/tmp/plan-copy-1.md')).resolves.toMatchObject({
      comments: [{ text: 'A' }],
    });
    await expect(store.load('/tmp/plan-copy-2.md')).resolves.toMatchObject({
      comments: [{ text: 'B' }],
    });
    await expect(store.list()).resolves.toHaveLength(2);
  });

  it('overwrites previous session for the same key', async () => {
    const store = new FileSessionStore({ dir });
    await store.save(
      planPath,
      makeSession(planPath, hash, [
        { sectionId: '1.1', text: 'First', timestamp: new Date('2026-01-15T10:00:00Z') },
      ], null),
    );
    await store.save(
      planPath,
      makeSession(planPath, hash, [
        { sectionId: '1.1', text: 'First', timestamp: new Date('2026-01-15T10:00:00Z') },
        { sectionId: '1.2', text: 'Second', timestamp: new Date('2026-01-15T10:01:00Z') },
      ], '1.2'),
    );

    const result = await store.load(planPath);
    expect(result?.comments).toHaveLength(2);
    expect(result?.activeSection).toBe('1.2');
  });
});
