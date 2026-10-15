import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatReviewOutput } from '@plan-review/core';
import { createMessageHandlers } from '../../src/messageHandlers.js';
import { fixture, markdown, now, answer, thread } from './reviewFixtures.js';

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f.cleanup(); });

describe('messageHandlers.submitReview', () => {
  it.each(['approved', 'changes_requested'] as const)('freezes the %s round before fan-out and returns v2 output', async (verdict) => {
    const deliver = vi.fn(async ({ planFsPath, output }: { planFsPath: string; output: string }) => {
      const review = await f.store.get(loaded.review.id);
      expect(review?.rounds[0]).toMatchObject({ verdict, summary: 'My summary', submittedAt: now.toISOString() });
      expect(planFsPath).toBe(f.planFsPath);
      expect(output).toBe(formatReviewOutput(review!, loaded.items, loaded.document));
    });
    const panel = createMessageHandlers({ reviewStore: f.store, now: () => now, chooseTargets: async () => ['clipboard'], deliver });
    const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    await panel.saveProgress({ answers: { storage: { ...answer, itemHash: loaded.items[0].hash } }, threads: [thread(loaded.document.sections[0].id)] });
    const result = await panel.submitReview({ verdict, summary: 'My summary' });
    expect(result).toEqual({ ok: true, output: expect.stringContaining('My summary') });
    expect(result.output).toContain('Files');
    expect(result.output).toContain('Please clarify');
    expect(result.output).toContain(loaded.document.sections[0].heading);
    expect(deliver).toHaveBeenCalledOnce();
  });

  it.each([undefined, []])('keeps the round open when no destination is chosen: %j', async (targets) => {
    const chooseTargets = vi.fn(async () => targets);
    const deliver = vi.fn();
    const panel = createMessageHandlers({ reviewStore: f.store, chooseTargets, deliver });
    const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    const save = vi.spyOn(f.store, 'save');
    await expect(panel.submitReview({ verdict: 'approved', summary: '' })).rejects.toThrow('Submit cancelled — no destination chosen.');
    expect(chooseTargets).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect((await f.store.get(loaded.review.id))?.rounds[0].submittedAt).toBeUndefined();
  });

  it('chooses targets before committing and delivers only to those targets', async () => {
    const chooseTargets = vi.fn(async () => {
      expect((await f.store.get(loaded.review.id))?.rounds[0].submittedAt).toBeUndefined();
      return ['file'] as const;
    });
    const deliver = vi.fn();
    const panel = createMessageHandlers({ reviewStore: f.store, chooseTargets: async () => [...await chooseTargets()], deliver });
    const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    const result = await panel.submitReview({ verdict: 'approved', summary: '' });
    expect(deliver).toHaveBeenCalledWith({ planFsPath: f.planFsPath, output: result.output, targets: ['file'] });
    expect((await f.store.get(loaded.review.id))?.rounds[0].verdict).toBe('approved');
  });

  it('rejects submit before load without fan-out', async () => {
    const deliver = vi.fn();
    const panel = createMessageHandlers({ reviewStore: f.store, chooseTargets: async () => ['clipboard'], deliver });
    await expect(panel.submitReview({ verdict: 'approved', summary: '' })).rejects.toThrow('document not loaded');
    expect(deliver).not.toHaveBeenCalled();
  });
});
