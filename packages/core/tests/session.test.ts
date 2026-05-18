import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { ReviewComment } from '../src/types.js';
import * as sessionModule from '../src/session.js';
import {
  computeContentHash,
  DEFAULT_SESSION_DIR,
  FileSessionStore,
  type FileSessionStoreOptions,
  type SessionMeta,
  type SessionData,
  type SessionStore,
} from '../src/session.js';
// @ts-expect-error SessionLoadResult was intentionally removed from the public API.
import type { SessionLoadResult } from '../src/session.js';

let dir: string;

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    sectionId: 'task-1',
    text: 'Looks good',
    timestamp: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    version: 1,
    planPath: '/tmp/plan.md',
    contentHash: 'sha256:abc123',
    comments: [makeComment()],
    activeSection: 'task-1',
    lastModified: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

async function filesInSessionDir(): Promise<string[]> {
  return (await readdir(dir)).filter((file) => file.endsWith('.json'));
}

describe('FileSessionStore', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plan-review-session-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('exports the legacy default session directory constant without creating it', () => {
    const expectedDir = join(homedir(), '.plan-review', 'sessions');

    expect(DEFAULT_SESSION_DIR).toBe(expectedDir);
    if (!existsSync(expectedDir)) {
      expect(existsSync(DEFAULT_SESSION_DIR)).toBe(false);
    }
  });

  it('exports the new session contract and omits legacy runtime helpers', () => {
    const options: FileSessionStoreOptions = { dir, keyHashLength: 12 };
    const store: SessionStore = new FileSessionStore(options);
    const meta: SessionMeta = {
      key: '/tmp/plan.md',
      commentCount: 1,
      lastModified: '2026-01-15T10:00:00.000Z',
    };
    const removedType: SessionLoadResult | null = null;

    expect(store).toBeInstanceOf(FileSessionStore);
    expect(meta).toEqual({
      key: '/tmp/plan.md',
      commentCount: 1,
      lastModified: '2026-01-15T10:00:00.000Z',
    });
    expect(removedType).toBeNull();
    expect('saveSession' in sessionModule).toBe(false);
    expect('loadSession' in sessionModule).toBe(false);
    expect('clearSession' in sessionModule).toBe(false);
    expect('listSessions' in sessionModule).toBe(false);
    expect('getSessionDir' in sessionModule).toBe(false);
    expect('SessionLoadResult' in sessionModule).toBe(false);
  });

  it('computes deterministic sha256 content hashes', () => {
    expect(computeContentHash('hello')).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(computeContentHash('same')).toBe(computeContentHash('same'));
    expect(computeContentHash('one')).not.toBe(computeContentHash('two'));
  });

  it('round-trips session data and restores Date timestamps', async () => {
    const store = new FileSessionStore({ dir });
    const data = makeSession({ comments: [makeComment({ text: 'My review' })] });

    await store.save('/tmp/plan.md', data);
    const loaded = await store.load('/tmp/plan.md');

    expect(loaded).toMatchObject({
      version: 1,
      planPath: '/tmp/plan.md',
      contentHash: 'sha256:abc123',
      activeSection: 'task-1',
      lastModified: '2026-01-15T10:00:00.000Z',
    });
    expect(loaded?.comments[0].text).toBe('My review');
    expect(loaded?.comments[0].timestamp).toBeInstanceOf(Date);
    expect(loaded?.comments[0].timestamp.toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });

  it('returns null when loading a missing session', async () => {
    const store = new FileSessionStore({ dir });
    await expect(store.load('/tmp/missing.md')).resolves.toBeNull();
  });

  it('returns null when the session file cannot be read', async () => {
    const store = new FileSessionStore({ dir });
    await store.save('/tmp/plan.md', makeSession());
    const [file] = await filesInSessionDir();
    const filePath = join(dir, file);
    await store.clear('/tmp/plan.md');
    await mkdir(filePath);

    await expect(store.load('/tmp/plan.md')).resolves.toBeNull();
  });

  it('uses the opaque key hash and preserves legacy 16-character filenames by default', async () => {
    const store = new FileSessionStore({ dir });
    await store.save('/tmp/plan.md', makeSession());

    const files = await filesInSessionDir();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{16}\.json$/);
  });

  it('supports a custom key hash length', async () => {
    const store = new FileSessionStore({ dir, keyHashLength: 8 });
    await store.save('forge:FUL-42:spec', makeSession({ planPath: 'forge:FUL-42:spec' }));

    const files = await filesInSessionDir();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{8}\.json$/);
  });

  it('throws when saving fails', async () => {
    const fileInsteadOfDir = join(dir, 'not-a-directory');
    await writeFile(fileInsteadOfDir, 'x');
    const store = new FileSessionStore({ dir: fileInsteadOfDir });

    await expect(store.save('/tmp/plan.md', makeSession())).rejects.toThrow();
  });

  it('auto-deletes corrupt JSON on load and returns null', async () => {
    const store = new FileSessionStore({ dir });
    await store.save('/tmp/plan.md', makeSession());
    const [file] = await filesInSessionDir();
    const filePath = join(dir, file);
    await writeFile(filePath, '{{{CORRUPT JSON!!!');

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(store.load('/tmp/plan.md')).resolves.toBeNull();
    expect(existsSync(filePath)).toBe(false);
    await expect(store.load('/tmp/plan.md')).resolves.toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Corrupt session file'));
    consoleSpy.mockRestore();
  });

  it('clears an existing session and treats missing sessions as a no-op', async () => {
    const store = new FileSessionStore({ dir });
    await store.save('/tmp/plan.md', makeSession());
    expect(await filesInSessionDir()).toHaveLength(1);

    await store.clear('/tmp/plan.md');
    expect(await filesInSessionDir()).toHaveLength(0);
    await expect(store.clear('/tmp/plan.md')).resolves.toBeUndefined();
  });

  it('lists empty when the session directory does not exist', async () => {
    const missingDir = join(dir, 'missing');
    const store = new FileSessionStore({ dir: missingDir });

    await expect(store.list()).resolves.toEqual([]);
  });

  it('lists saved sessions with metadata but no staleness', async () => {
    const store = new FileSessionStore({ dir });
    await store.save('/tmp/one.md', makeSession({
      planPath: '/tmp/one.md',
      comments: [makeComment(), makeComment({ text: 'Second' })],
    }));
    await store.save('/tmp/two.md', makeSession({
      planPath: '/tmp/two.md',
      comments: [],
      activeSection: null,
      lastModified: '2026-01-16T10:00:00.000Z',
    }));

    await expect(store.list()).resolves.toEqual(expect.arrayContaining([
      { key: '/tmp/one.md', commentCount: 2, lastModified: '2026-01-15T10:00:00.000Z' },
      { key: '/tmp/two.md', commentCount: 0, lastModified: '2026-01-16T10:00:00.000Z' },
    ]));
  });

  it('skips non-json and corrupt files while listing', async () => {
    const store = new FileSessionStore({ dir });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'notes.txt'), 'ignore me');
    await writeFile(join(dir, 'corrupt.json'), '{{NOPE');
    await store.save('/tmp/plan.md', makeSession());

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sessions = await store.list();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].key).toBe('/tmp/plan.md');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping corrupt session file'));
    consoleSpy.mockRestore();
  });

  it('stores sessions for two opaque keys independently', async () => {
    const store = new FileSessionStore({ dir });
    await store.save('forge:FUL-1', makeSession({ planPath: 'forge:FUL-1', comments: [makeComment({ text: 'A' })] }));
    await store.save('forge:FUL-2', makeSession({ planPath: 'forge:FUL-2', comments: [makeComment({ text: 'B' })] }));

    expect((await store.load('forge:FUL-1'))?.comments[0].text).toBe('A');
    expect((await store.load('forge:FUL-2'))?.comments[0].text).toBe('B');
    expect(await store.list()).toHaveLength(2);
  });
});
