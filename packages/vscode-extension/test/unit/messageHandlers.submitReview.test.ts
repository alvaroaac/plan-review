import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatReviewOutput } from '@plan-review/core';
import { createMessageHandlers } from '../../src/messageHandlers.js';
import { fixture, markdown, now, answer, thread } from './reviewFixtures.js';

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f.cleanup(); });

describe('messageHandlers.submitReview', () => {
  it.each(['approved', 'changes_requested'] as const)('freezes the %s round before fan-out and returns v2 output', async (verdict) => {
    const submit = vi.fn(async ({ planFsPath, output }: { planFsPath: string; output: string }) => {
      const review = await f.store.get(loaded.review.id);
      expect(review?.rounds[0]).toMatchObject({ verdict, summary: 'My summary', submittedAt: now.toISOString() });
      expect(planFsPath).toBe(f.planFsPath);
      expect(output).toBe(formatReviewOutput(review!, loaded.items, loaded.document));
    });
    const panel = createMessageHandlers({ reviewStore: f.store, now: () => now, submit });
    const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    await panel.saveProgress({ answers: { storage: { ...answer, itemHash: loaded.items[0].hash } }, threads: [thread(loaded.document.sections[0].id)] });
    const result = await panel.submitReview({ verdict, summary: 'My summary' });
    expect(result).toEqual({ ok: true, output: expect.stringContaining('My summary') });
    expect(result.output).toContain('Files');
    expect(result.output).toContain('Please clarify');
    expect(result.output).toContain(loaded.document.sections[0].heading);
    expect(submit).toHaveBeenCalledOnce();
  });

  it('rejects submit before load without fan-out', async () => {
    const submit = vi.fn();
    const panel = createMessageHandlers({ reviewStore: f.store, submit });
    await expect(panel.submitReview({ verdict: 'approved', summary: '' })).rejects.toThrow('document not loaded');
    expect(submit).not.toHaveBeenCalled();
  });
});
