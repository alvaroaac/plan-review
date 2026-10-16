import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleWebviewMessage } from '../../src/extension.js';
import { createMessageHandlers } from '../../src/messageHandlers.js';
import { fixture, markdown, now } from './reviewFixtures.js';
import { invalidProgress, invalidSubmits } from './invalidPayloads.js';
import { submitRound } from '@plan-review/core';

vi.mock('vscode', () => ({
  workspace: {}, window: {}, env: {}, commands: {}, languages: {},
}));

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f.cleanup(); });
function setup() {
  const handlers = createMessageHandlers({ reviewStore: f.store, now: () => now, chooseTargets: async () => ['clipboard'], deliver: vi.fn() });
  return { handlers, planFsPath: f.planFsPath, getMarkdown: vi.fn(async () => markdown), postMessage: vi.fn() };
}

describe('handleWebviewMessage', () => {
  it('ignores non-request messages', async () => {
    const opts = setup();
    expect(await handleWebviewMessage({ kind: 'event', type: 'planChanged' }, opts)).toEqual({});
    expect(opts.postMessage).not.toHaveBeenCalled();
  });

  it('loads current editor text and returns the complete LoadedReview on every request', async () => {
    const opts = setup();
    await handleWebviewMessage({ id: 'r1', kind: 'req', method: 'loadDocument' }, opts);
    const first = opts.postMessage.mock.calls[0][0].result;
    opts.getMarkdown.mockResolvedValueOnce(markdown.replace('Where to store?', 'Where now?'));
    await handleWebviewMessage({ id: 'r2', kind: 'req', method: 'loadDocument' }, opts);
    expect(opts.getMarkdown).toHaveBeenCalledTimes(2);
    expect(opts.postMessage.mock.calls[1][0]).toMatchObject({ id: 'r2', kind: 'res', result: { items: [{ question: 'Where now?' }], review: { id: first.review.id } } });
  });

  it('saves progress, submits and closes with the formatted output response', async () => {
    const opts = setup();
    await handleWebviewMessage({ id: 'r1', kind: 'req', method: 'loadDocument' }, opts);
    await handleWebviewMessage({ id: 'r2', kind: 'req', method: 'saveProgress', params: { answers: {}, threads: [] } }, opts);
    expect(opts.postMessage).toHaveBeenLastCalledWith({ id: 'r2', kind: 'res', result: null });
    const result = await handleWebviewMessage({ id: 'r3', kind: 'req', method: 'submitReview', params: { verdict: 'approved', summary: 'LGTM' } }, opts);
    expect(opts.postMessage).toHaveBeenLastCalledWith({ id: 'r3', kind: 'res', result: { ok: true, output: expect.stringContaining('LGTM') } });
    expect(result).toEqual({ action: 'close' });
  });

  it.each([false, true])('rejects submission while reading a reload, pickerOpen=%s', async (pickerOpen) => {
    let release!: (text: string) => void;
    const read = new Promise<string>((resolve) => { release = resolve; });
    let choose!: (targets: ['clipboard']) => void;
    const targets = new Promise<['clipboard']>((resolve) => { choose = resolve; });
    const chooseTargets = vi.fn(() => targets);
    const deliver = vi.fn();
    const opts = setup();
    opts.handlers = createMessageHandlers({ reviewStore: f.store, chooseTargets, deliver });
    await handleWebviewMessage({ id: 'load', kind: 'req', method: 'loadDocument' }, opts);
    const id = opts.postMessage.mock.calls[0][0].result.review.id;
    const save = vi.spyOn(f.store, 'save');
    const submit = () => handleWebviewMessage({ id: 'submit', kind: 'req', method: 'submitReview', params: { verdict: 'approved', summary: '' } }, opts);
    let submission = pickerOpen ? submit() : undefined;
    opts.getMarkdown.mockReturnValueOnce(read);
    const reload = handleWebviewMessage({ id: 'reload', kind: 'req', method: 'loadDocument' }, opts);
    submission ??= submit();
    choose(['clipboard']);
    try {
      expect(await submission).toEqual({});
      expect(opts.postMessage).toHaveBeenLastCalledWith({ id: 'submit', kind: 'err', error: 'The plan changed. Review the updated plan and submit again.' });
      expect(chooseTargets).toHaveBeenCalledTimes(pickerOpen ? 1 : 0);
      expect(deliver).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      const review = await f.store.get(id);
      expect(review?.status).toBe('open');
      expect(review?.rounds[0].submittedAt).toBeUndefined();
    } finally {
      release(markdown.replace('Where to store?', 'Which database?'));
      await reload;
    }
  });

  it('posts a cancellation error and keeps the panel open without submitting the round', async () => {
    const opts = setup();
    opts.handlers = createMessageHandlers({ reviewStore: f.store, chooseTargets: async () => undefined, deliver: vi.fn() });
    await handleWebviewMessage({ id: 'load', kind: 'req', method: 'loadDocument' }, opts);
    const id = opts.postMessage.mock.calls[0][0].result.review.id;
    const result = await handleWebviewMessage({ id: 'submit', kind: 'req', method: 'submitReview', params: { verdict: 'approved', summary: '' } }, opts);
    expect(result).toEqual({});
    expect(opts.postMessage).toHaveBeenLastCalledWith({ id: 'submit', kind: 'err', error: 'Submit cancelled — no destination chosen.' });
    expect((await f.store.get(id))?.rounds[0].submittedAt).toBeUndefined();
  });

  it.each(invalidProgress)('returns an error without any store write for %s', async (_name, params) => {
    const opts = setup();
    await handleWebviewMessage({ id: 'load', kind: 'req', method: 'loadDocument' }, opts);
    const save = vi.spyOn(f.store, 'save');
    await handleWebviewMessage({ id: 'bad', kind: 'req', method: 'saveProgress', params }, opts);
    expect(opts.postMessage).toHaveBeenLastCalledWith({ id: 'bad', kind: 'err', error: 'invalid saveProgress params' });
    expect(save).not.toHaveBeenCalled();
  });

  it.each(invalidSubmits.map((input) => [input]))('rejects invalid submit %j without any store write', async (params) => {
    const opts = setup();
    await handleWebviewMessage({ id: 'load', kind: 'req', method: 'loadDocument' }, opts);
    const save = vi.spyOn(f.store, 'save');
    await handleWebviewMessage({ id: 'bad', kind: 'req', method: 'submitReview', params }, opts);
    expect(opts.postMessage).toHaveBeenLastCalledWith({ id: 'bad', kind: 'err', error: 'invalid submitReview params' });
    expect(save).not.toHaveBeenCalled();
  });

  it('maps approved reload failure to an error response without making a new review', async () => {
    const opts = setup();
    await handleWebviewMessage({ id: 'load', kind: 'req', method: 'loadDocument' }, opts);
    const id = opts.postMessage.mock.calls[0][0].result.review.id;
    await submitRound(f.store, id, { verdict: 'approved', summary: '' }, now);
    await handleWebviewMessage({ id: 'reload', kind: 'req', method: 'loadDocument' }, opts);
    expect(opts.postMessage).toHaveBeenLastCalledWith({ id: 'reload', kind: 'err', error: expect.stringContaining('is approved') });
    expect(await f.store.list({ status: 'open' })).toHaveLength(0);
  });

  it('maps current document read failures to an error response', async () => {
    const opts = setup();
    opts.getMarkdown.mockRejectedValueOnce(new Error('cannot read document'));
    await handleWebviewMessage({ id: 'load', kind: 'req', method: 'loadDocument' }, opts);
    expect(opts.postMessage).toHaveBeenLastCalledWith({ id: 'load', kind: 'err', error: 'cannot read document' });
  });

  it('allows submission after a reload read fails', async () => {
    const opts = setup();
    await handleWebviewMessage({ id: 'load', kind: 'req', method: 'loadDocument' }, opts);
    opts.getMarkdown.mockRejectedValueOnce(new Error('cannot read document'));
    await handleWebviewMessage({ id: 'reload', kind: 'req', method: 'loadDocument' }, opts);
    expect(opts.postMessage).toHaveBeenLastCalledWith({ id: 'reload', kind: 'err', error: 'cannot read document' });
    const result = await handleWebviewMessage({ id: 'submit', kind: 'req', method: 'submitReview', params: { verdict: 'approved', summary: '' } }, opts);
    expect(result).toEqual({ action: 'close' });
    expect(opts.postMessage).toHaveBeenLastCalledWith({ id: 'submit', kind: 'res', result: { ok: true, output: expect.any(String) } });
  });
});
