import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatReviewOutput, openReview, type Review, type ReviewStore } from '@plan-review/core';
import { createMessageHandlers } from '../../src/messageHandlers.js';
import { fixture, markdown, now, answer, thread } from './reviewFixtures.js';

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f.cleanup(); });

describe('messageHandlers.submitReview', () => {
  it.each([false, true])('rejects while a reload save is pending, pickerOpen=%s', async (pickerOpen) => {
    let saved: Review | null = null;
    let release!: () => void;
    const pendingSave = new Promise<void>((resolve) => { release = resolve; });
    let saving!: () => void;
    const saveStarted = new Promise<void>((resolve) => { saving = resolve; });
    const revised = markdown.replace('Where to store?', 'Which database?');
    const store: ReviewStore = {
      get: async () => saved && structuredClone(saved),
      save: vi.fn(async (review) => {
        if (review.rounds.at(-1)?.plan === revised) {
          saving();
          await pendingSave;
        }
        saved = structuredClone(review);
      }),
      list: async () => [],
      findOpenByPlanPath: async () => null,
    };
    let choose!: (targets: ['clipboard']) => void;
    const targets = new Promise<['clipboard']>((resolve) => { choose = resolve; });
    const chooseTargets = vi.fn(() => targets);
    const deliver = vi.fn();
    const panel = createMessageHandlers({ reviewStore: store, chooseTargets, deliver });
    const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    const submit = () => panel.submitReview({ verdict: 'approved', summary: '' });
    let submission = pickerOpen ? submit() : undefined;
    const reload = panel.loadDocument({ planFsPath: f.planFsPath, markdown: revised });
    submission ??= submit();
    const rejected = expect(submission).rejects.toThrow('The plan changed. Review the updated plan and submit again.');
    await saveStarted;
    choose(['clipboard']);
    // Let the picker continuation run while persistence is still blocked.
    await Promise.resolve();
    release();
    await reload;
    await rejected;
    expect(chooseTargets).toHaveBeenCalledTimes(pickerOpen ? 1 : 0);
    expect(deliver).not.toHaveBeenCalled();
    expect(store.save).toHaveBeenCalledTimes(2);
    const review = await store.get(loaded.review.id);
    expect(review?.status).toBe('open');
    expect(review?.rounds).toHaveLength(1);
    expect(review?.rounds[0].plan).toBe(revised);
    expect(review?.rounds[0].submittedAt).toBeUndefined();
  });

  it('passes the captured identity when a reload is queued outside the panel', async () => {
    let reload: ReturnType<typeof openReview> | undefined;
    const deliver = vi.fn();
    const panel = createMessageHandlers({
      reviewStore: f.store,
      chooseTargets: async () => {
        reload = openReview(f.store, {
          markdown: `${markdown}\nChanged.`, reviewId: loaded.review.id, now,
        });
        return ['clipboard'];
      },
      deliver,
    });
    const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    await expect(panel.submitReview({ verdict: 'approved', summary: '' }))
      .rejects.toThrow('The plan changed. Review the updated plan and submit again.');
    const opened = await reload;
    expect(await f.store.get(loaded.review.id)).toEqual(opened?.review);
    expect(opened?.review.status).toBe('open');
    expect(opened?.review.rounds[0].submittedAt).toBeUndefined();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('allows submission after a failed reload finishes', async () => {
    const deliver = vi.fn();
    const panel = createMessageHandlers({ reviewStore: f.store, chooseTargets: async () => ['clipboard'], deliver });
    await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
    vi.spyOn(f.store, 'save').mockRejectedValueOnce(new Error('Reload failed'));
    await expect(panel.loadDocument({ planFsPath: f.planFsPath, markdown })).rejects.toThrow('Reload failed');
    await expect(panel.submitReview({ verdict: 'approved', summary: '' })).resolves.toMatchObject({ ok: true });
    expect(deliver).toHaveBeenCalledOnce();
  });

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

it('aborts without persisting when the plan changes while the destination picker is open', async () => {
  let saved: Review | null = null;
  const store: ReviewStore = {
    get: async () => saved && structuredClone(saved),
    save: vi.fn(async (review) => { saved = structuredClone(review); }),
    list: async () => [],
    findOpenByPlanPath: async () => null,
  };
  let choose!: (targets: ['clipboard']) => void;
  const targets = new Promise<['clipboard']>((resolve) => { choose = resolve; });
  const deliver = vi.fn();
  const panel = createMessageHandlers({ reviewStore: store, chooseTargets: () => targets, deliver });
  const loaded = await panel.loadDocument({ planFsPath: f.planFsPath, markdown });
  const submission = panel.submitReview({ verdict: 'approved', summary: '' });
  const rejected = expect(submission).rejects.toThrow(/plan changed.*review the updated plan.*submit again/i);
  await panel.loadDocument({ planFsPath: f.planFsPath, markdown: markdown.replace('Where to store?', 'Which database?') });
  const beforeSubmit = await store.get(loaded.review.id);
  vi.mocked(store.save).mockClear();
  choose(['clipboard']);
  await rejected;
  expect(store.save).not.toHaveBeenCalled();
  expect(await store.get(loaded.review.id)).toEqual(beforeSubmit);
  expect(deliver).not.toHaveBeenCalled();
});
