import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMessageHandlers } from '../../src/messageHandlers.js';
import { fixture, markdown, now, answer, thread } from './reviewFixtures.js';

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f.cleanup(); });

describe('messageHandlers.saveProgress', () => {
  it('persists answers and threads and restores them in a new panel', async () => {
    const panel = createMessageHandlers({ reviewStore: f.store, now: () => now });
    const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    const update = { answers: { storage: { ...answer, itemHash: loaded.items[0].hash } }, threads: [thread(loaded.document.sections[0].id)] };
    await panel.saveProgress(update);
    const restored = await createMessageHandlers({ reviewStore: f.store }).loadDocument({ planFsPath: f.planFsPath, markdown });
    expect(restored.review.answers).toEqual(update.answers);
    expect(restored.review.threads).toEqual(update.threads);
  });

  it('uses only current LoadedReview item ids and preserves hidden answers', async () => {
    const panel = createMessageHandlers({ reviewStore: f.store });
    const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    await panel.saveProgress({ answers: { storage: answer, injected: answer }, threads: [] });
    expect((await f.store.get(loaded.review.id))?.answers).toEqual({ storage: answer });
    await panel.loadDocument({ planFsPath: f.planFsPath, markdown: '# Plan\n\n## Design\nNo items.\n' });
    await panel.saveProgress({ answers: {}, threads: [] });
    expect((await f.store.get(loaded.review.id))?.answers).toEqual({ storage: answer });
  });

  it('flushes the pending thread save before reload re-anchors it', async () => {
    const panel = createMessageHandlers({ reviewStore: f.store });
    const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    await panel.saveProgress({ answers: {}, threads: [thread(loaded.document.sections[0].id)] });
    const moved = '# Plan\n\n## New section\nOriginal text.\n';
    const reloaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown: moved });
    expect(reloaded.review.id).toBe(loaded.review.id);
    expect(reloaded.review.threads[0]).toMatchObject({ sectionId: reloaded.document.sections[0].id, outdated: false });
    expect((await f.store.get(loaded.review.id))?.threads).toEqual(reloaded.review.threads);
  });

  it('rejects progress before the document is loaded', async () => {
    const panel = createMessageHandlers({ reviewStore: f.store });
    await expect(panel.saveProgress({ answers: {}, threads: [] })).rejects.toThrow('document not loaded');
  });
});

it.each([
  { choice: 'C', note: 'Invalid option' },
  { choice: 'holds', note: '' },
  { choice: 'other', note: '' },
  { choice: 'other', note: ' \t\n' },
])('rejects invalid answers without saving: %j', async (invalid) => {
  const panel = createMessageHandlers({ reviewStore: f.store });
  const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
  const current = { ...answer, ...invalid, itemHash: loaded.items[0].hash };
  await expect(panel.saveProgress({ answers: { storage: current }, threads: [] })).rejects.toThrow();
  expect((await f.store.get(loaded.review.id))?.answers).toEqual({});
});

it('validates answers against items from the latest load', async () => {
  const panel = createMessageHandlers({ reviewStore: f.store });
  await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
  const reloaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown: markdown.replace('- A: Files', '- C: Cloud') });
  const stale = { ...answer, itemHash: reloaded.items[0].hash };
  await expect(panel.saveProgress({ answers: { storage: stale }, threads: [] })).rejects.toThrow();
});

it('accepts a carried-over answer to an earlier revision of the item', async () => {
  const panel = createMessageHandlers({ reviewStore: f.store });
  const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
  const earlier = { ...answer, choice: 'C', itemHash: 'earlier-revision' };
  await panel.saveProgress({ answers: { storage: earlier }, threads: [] });
  expect((await f.store.get(loaded.review.id))?.answers).toEqual({ storage: earlier });
});
