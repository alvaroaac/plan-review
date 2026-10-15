import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { FileReviewStore, ReviewApprovedError, submitRound } from '@plan-review/core';
import { createMessageHandlers } from '../../src/messageHandlers.js';
import { fixture, markdown, now } from './reviewFixtures.js';

// Redirect the default constructor in this test module so it never reaches home.
const defaultStore = vi.hoisted(() => ({ dir: '', constructed: vi.fn() }));
vi.mock('@plan-review/core', async () => {
  const actual = await vi.importActual<typeof import('@plan-review/core')>('@plan-review/core');
  return {
    ...actual,
    FileReviewStore: class extends actual.FileReviewStore {
      constructor(opts?: { dir?: string }) {
        super(opts ?? { dir: defaultStore.dir });
        defaultStore.constructed(opts);
      }
    },
  };
});

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
  defaultStore.dir = join(f.dir, 'default-reviews');
  defaultStore.constructed.mockClear();
});
afterEach(async () => { await f.cleanup(); });
function handlers() { return createMessageHandlers({ reviewStore: f.store, now: () => now }); }

describe('messageHandlers.loadDocument', () => {
  it('uses FileReviewStore with its default directory when no store is injected', async () => {
    const panel = createMessageHandlers({ now: () => now });
    expect(defaultStore.constructed).toHaveBeenCalledExactlyOnceWith(undefined);
    const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    const redirectedStore = new FileReviewStore({ dir: defaultStore.dir });
    expect(await redirectedStore.get(loaded.review.id)).toMatchObject({ planPath: f.planFsPath });
  });

  it('opens and persists a v2 review with the current document text and fsPath', async () => {
    const loaded = await handlers().loadDocument({ planFsPath: f.planFsPath, markdown });
    expect(loaded.document.title).toBe('Plan');
    expect(loaded.items.map((item) => item.id)).toEqual(['storage']);
    expect(loaded.review.round).toBe(1);
    expect(await f.store.get(loaded.review.id)).toMatchObject({ planPath: f.planFsPath, createdAt: now.toISOString(), rounds: [{ plan: markdown }] });
  });

  it('resumes the file review in another panel and retains its id on changed loads', async () => {
    const first = await handlers().loadDocument({ planFsPath: f.planFsPath, markdown });
    const panel = handlers();
    expect((await panel.loadDocument({ planFsPath: f.planFsPath, markdown })).review.id).toBe(first.review.id);
    const reloaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown: markdown.replace('Where to store?', 'Which storage?') });
    expect(reloaded.review.id).toBe(first.review.id);
    expect(reloaded.items[0].question).toBe('Which storage?');
    expect(reloaded.review.banner).toBe('planChangedWhilePaused');
  });

  it('starts a new review when the only file review is approved', async () => {
    const first = await handlers().loadDocument({ planFsPath: f.planFsPath, markdown });
    await submitRound(f.store, first.review.id, { verdict: 'approved', summary: '' }, now);
    const next = await handlers().loadDocument({ planFsPath: f.planFsPath, markdown });
    expect(next.review.id).not.toBe(first.review.id);
    expect(next.review.status).toBe('open');
  });

  it('rejects reload of an approved panel review instead of silently creating another', async () => {
    const panel = handlers();
    const first = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    await submitRound(f.store, first.review.id, { verdict: 'approved', summary: '' }, now);
    await expect(panel.loadDocument({ planFsPath: f.planFsPath, markdown })).rejects.toBeInstanceOf(ReviewApprovedError);
    expect(await f.store.list({ status: 'open' })).toHaveLength(0);
  });
});
