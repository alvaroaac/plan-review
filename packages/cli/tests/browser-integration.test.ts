import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileReviewStore, formatPausedNotice, formatReviewOutput, openReview, saveProgress, submitRound } from '@plan-review/core';
import type { LoadedReview, ProgressUpdate, SubmitVerdict } from '@plan-review/core';
import { HttpTransport } from '../src/transport.js';
import { browserReview } from '../src/browser-review.js';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('../src/server/assets.js', () => ({
  getAssetHtml: () => '<!DOCTYPE html><html><body><div id="app"></div></body></html>',
}));

const now = new Date('2026-10-15T12:00:00.000Z');
const markdown = '# Test plan\n\n## Storage\n\n```decision id=storage\nquestion: Which storage?\n- A: Files [pick]\n- B: Database\n```';
// Native HTTP avoids coupling fake application timers to fetch's connection pool.
function http(url: string, options: { method?: string; body?: string } = {}) {
  return new Promise<{ status: number; json: () => Promise<any>; text: () => Promise<string> }>((resolve, reject) => {
    const req = request(url, { method: options.method ?? 'GET', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode!, json: async () => JSON.parse(body), text: async () => body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}
const send = (url: string, path: string, body?: unknown) => http(`${url}${path}`, {
  method: path === '/api/session' ? 'PUT' : 'POST',
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

let home: string;
let store: FileReviewStore;
let active: { url: string; result: ReturnType<typeof browserReview> } | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plan-review-browser-'));
  vi.stubEnv('PLAN_REVIEW_HOME', home);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  store = new FileReviewStore({ dir: join(home, 'reviews') });
});

afterEach(async () => {
  if (active) {
    await send(active.url, '/api/cancel').catch(() => {});
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(750);
    await active.result.catch(() => {});
    active = undefined;
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

async function start(opts: Parameters<typeof browserReview>[0] = { markdown }) {
  const original = HttpTransport.prototype.start;
  let started!: (url: string) => void;
  const ready = new Promise<string>((resolve) => { started = resolve; });
  const spy = vi.spyOn(HttpTransport.prototype, 'start').mockImplementation(async function (port) {
    const value = await original.call(this, port);
    started(value.url);
    return value;
  });
  const result = browserReview(opts);
  const url = await Promise.race([ready, result.then(() => { throw new Error('Review ended before startup'); })]);
  spy.mockRestore();
  active = { url, result };
  const loaded = await (await http(`${url}/api/doc`)).json() as LoadedReview;
  return { url, result, loaded };
}

function progress(loaded: LoadedReview): ProgressUpdate {
  return {
    answers: { storage: { choice: 'B', note: 'Use the database', itemHash: loaded.items[0].hash, round: loaded.review.round, updatedAt: now.toISOString() } },
    threads: [{ id: 't_test', sectionId: loaded.document.sections.at(-1)!.id, anchor: null, resolved: false, outdated: false, createdRound: loaded.review.round,
      comments: [{ id: 'c_test', author: 'reviewer', body: 'Explain the migration.', createdAt: now.toISOString() }] }],
  };
}

describe('browser review integration', () => {
  it('opens an absolute plan path, resumes it, and --fresh creates a separate review', async () => {
    const planPath = join(home, 'plan.md');
    const first = await start({ markdown, planPath });
    expect((await store.get(first.loaded.review.id))?.planPath).toBe(planPath);
    await send(first.url, '/api/session', progress(first.loaded));
    await send(first.url, '/api/cancel');
    await first.result;
    const resumed = await start({ markdown, planPath });
    expect(resumed.loaded.review.id).toBe(first.loaded.review.id);
    expect(resumed.loaded.review.round).toBe(1);
    expect(resumed.loaded.review.answers.storage.choice).toBe('B');
    await send(resumed.url, '/api/cancel');
    await resumed.result;
    const fresh = await start({ markdown, planPath, fresh: true });
    expect(fresh.loaded.review.id).not.toBe(first.loaded.review.id);
    expect(fresh.loaded.review.answers).toEqual({});
    expect(await store.list()).toHaveLength(2);
  });

  it('stdin creates reviews without a planPath; an explicit id resumes even from stdin', async () => {
    const first = await start();
    expect((await store.get(first.loaded.review.id))?.planPath).toBeUndefined();
    await send(first.url, '/api/cancel');
    await first.result;
    const second = await start();
    expect(second.loaded.review.id).not.toBe(first.loaded.review.id);
    await send(second.url, '/api/cancel');
    await second.result;
    const resumed = await start({ markdown, reviewId: first.loaded.review.id });
    expect(resumed.loaded.review.id).toBe(first.loaded.review.id);
  });

  it.each(['unknown', 'approved'] as const)('rejects an %s id before starting a server', async (state) => {
    const id = 'rv_missing';
    if (state === 'approved') {
      const opened = await openReview(store, { markdown, now });
      await submitRound(store, opened.review.id, { verdict: 'approved', summary: '' }, now);
      const spy = vi.spyOn(HttpTransport.prototype, 'start');
      await expect(browserReview({ markdown, reviewId: opened.review.id })).rejects.toThrow(`Review ${opened.review.id} is approved; run without --review to start a new review`);
      expect(spy).not.toHaveBeenCalled();
    } else {
      const spy = vi.spyOn(HttpTransport.prototype, 'start');
      await expect(browserReview({ markdown, reviewId: id })).rejects.toThrow(`Review ${id} not found`);
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it.each<SubmitVerdict>(['changes_requested', 'approved'])('persists progress and freezes a %s round with formatted output', async (verdict) => {
    const { url, result, loaded } = await start();
    const update = progress(loaded);
    expect((await send(url, '/api/session', update)).status).toBe(204);
    expect((await store.get(loaded.review.id))?.answers).toEqual(update.answers);
    expect((await (await http(`${url}/api/doc`)).json()).review.threads).toEqual(update.threads);
    const response = await send(url, '/api/review', { verdict, summary: 'Review complete.' });
    expect(response.status).toBe(200);
    const body = await response.json();
    const outcome = await result;
    const saved = (await store.get(loaded.review.id))!;
    expect(saved.rounds[0]).toMatchObject({ verdict, summary: 'Review complete.', submittedAt: now.toISOString() });
    expect(saved.status).toBe(verdict === 'approved' ? 'approved' : 'open');
    expect(outcome).toEqual({ kind: 'submitted', output: formatReviewOutput(saved, loaded.items, loaded.document) });
    expect(body).toEqual({ ok: true, output: outcome.output });
    expect(outcome.output).toContain('Explain the migration.');
  });

  it('accepts a final autosave immediately after cancel and counts it in the paused notice', async () => {
    const { url, result, loaded } = await start();
    expect((await send(url, '/api/cancel')).status).toBe(204);
    expect((await send(url, '/api/session', progress(loaded))).status).toBe(204);
    const outcome = await result;
    const saved = (await store.get(loaded.review.id))!;
    expect(saved.answers.storage.choice).toBe('B');
    expect(saved.threads).toHaveLength(1);
    expect(outcome).toEqual({ kind: 'paused', output: formatPausedNotice(saved, loaded.items) });
    expect(outcome.output).toContain('1/1 items answered');
  });

  it('receives the complete submit HTTP response with output larger than 1 MB', async () => {
    const { url, result, loaded } = await start();
    const saved = (await store.get(loaded.review.id))!;
    const update = progress(loaded);
    update.threads[0].comments[0].body = 'large output '.repeat(100_000);
    await store.save({ ...saved, ...update });
    const response = await send(url, '/api/review', { verdict: 'changes_requested', summary: '' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.output.length).toBeGreaterThan(1024 * 1024);
    expect(body.output).toContain(update.threads[0].comments[0].body);
    expect(body.output).toBe((await result).output);
  });

  it('waits for the submit response to finish even when cancel arrives during submit', async () => {
    const register = HttpTransport.prototype.onSubmit;
    let release!: () => void;
    let committed!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { committed = resolve; });
    vi.spyOn(HttpTransport.prototype, 'onSubmit').mockImplementation(function (handler) {
      register.call(this, async (req) => {
        const output = await handler(req);
        committed();
        await gate;
        return output;
      });
    });
    const stop = vi.spyOn(HttpTransport.prototype, 'stop');
    const { url, result } = await start();
    const response = send(url, '/api/review', { verdict: 'approved', summary: '' });
    try {
      await ready;
      await send(url, '/api/cancel');
      expect(stop).not.toHaveBeenCalled();
    } finally {
      release();
      expect((await response).status).toBe(200);
      await result;
    }
  });

  it('quietly returns 204 for autosave after successful submit without changing the store', async () => {
    const originalStop = HttpTransport.prototype.stop;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const stop = vi.spyOn(HttpTransport.prototype, 'stop').mockImplementation(async function () {
      await gate;
      await originalStop.call(this);
    });
    const { url, result, loaded } = await start();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect((await send(url, '/api/review', { verdict: 'approved', summary: '' })).status).toBe(200);
      expect((await send(url, '/api/session', progress(loaded))).status).toBe(204);
      expect(stderr).not.toHaveBeenCalled();
      expect((await store.get(loaded.review.id))?.answers).toEqual({});
    } finally {
      release();
      await result;
      stop.mockRestore();
    }
  });

  it('exposes the answers returned by persistence rather than unfiltered input', async () => {
    const { url, loaded } = await start();
    const update = progress(loaded);
    update.answers.unknown = { ...update.answers.storage };
    expect((await send(url, '/api/session', update)).status).toBe(204);
    const current = await (await http(`${url}/api/doc`)).json() as LoadedReview;
    expect(current.review.answers).toEqual((await store.get(loaded.review.id))?.answers);
    expect(current.review.answers).not.toHaveProperty('unknown');
  });

  it.each(['save', 'heartbeat'] as const)('restarts the idle timer on each accepted %s', async (activity) => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const { url, result, loaded } = await start();
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    if (activity === 'save') await send(url, '/api/session', progress(loaded));
    else {
      await send(url, '/api/heartbeat');
      await send(url, '/api/pause');
    }
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect((await http(`${url}/api/doc`)).status).toBe(200);
    await vi.advanceTimersByTimeAsync(28 * 60_000 + 750);
    expect((await result).kind).toBe('paused');
  });

  it('opens the next round after submission and carries state across plan revisions', async () => {
    const opened = await openReview(store, { markdown, now });
    await saveProgress(store, opened.review.id, progress(opened.loaded), now, new Set(opened.loaded.items.map((item) => item.id)));
    await submitRound(store, opened.review.id, { verdict: 'changes_requested', summary: '' }, now);
    const second = await start({ markdown, reviewId: opened.review.id });
    expect(second.loaded.review).toMatchObject({ round: 2, banner: 'planUnchanged' });
    await send(second.url, '/api/cancel');
    await second.result;
    const changed = await start({ markdown: markdown.replace('Which storage?', 'Which persistent storage?'), reviewId: opened.review.id });
    expect(changed.loaded.review).toMatchObject({ round: 2, banner: 'planChangedWhilePaused' });
    expect(changed.loaded.review.answers.storage.choice).toBe('B');
  });

  it('cancel pauses with the latest saved progress and leaves the round active', async () => {
    const { url, result, loaded } = await start();
    await send(url, '/api/session', progress(loaded));
    expect((await send(url, '/api/cancel')).status).toBe(204);
    const saved = (await store.get(loaded.review.id))!;
    expect(await result).toEqual({ kind: 'paused', output: formatPausedNotice(saved, loaded.items) });
    expect(saved.rounds[0].submittedAt).toBeUndefined();
  });

  it.each(['heartbeat lost', 'idle ceiling'] as const)('%s pauses successfully and stops the server', async (reason) => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(now);
    const { url, result, loaded } = await start();
    if (reason === 'heartbeat lost') await send(url, '/api/heartbeat');
    await vi.advanceTimersByTimeAsync((reason === 'heartbeat lost' ? 30_000 : 30 * 60_000) + 750);
    expect(await result).toEqual({ kind: 'paused', output: formatPausedNotice((await store.get(loaded.review.id))!, loaded.items) });
    await expect(http(`${url}/api/doc`)).rejects.toThrow();
  });

  it('a hidden tab suspends the heartbeat timeout until heartbeats resume', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(now);
    const { url, result } = await start();
    await send(url, '/api/heartbeat');
    await send(url, '/api/pause');
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await http(`${url}/api/doc`)).status).toBe(200);
    await send(url, '/api/heartbeat');
    await vi.advanceTimersByTimeAsync(30_750);
    expect((await result).kind).toBe('paused');
  });

  it('logs autosave failure to stderr, returns failure to the browser, and allows retry', async () => {
    const { url, result, loaded } = await start();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(FileReviewStore.prototype, 'save').mockRejectedValueOnce(new Error('disk full'));
    expect((await send(url, '/api/session', progress(loaded))).status).toBe(500);
    expect(stderr.mock.calls.flat().join('')).toContain('disk full');
    expect((await send(url, '/api/session', progress(loaded))).status).toBe(204);
    await send(url, '/api/cancel');
    expect((await result).kind).toBe('paused');
    expect((await store.get(loaded.review.id))?.answers.storage.choice).toBe('B');
  });

  it('keeps answers for removed items when the browser saves current progress', async () => {
    const opened = await openReview(store, { markdown, now });
    await saveProgress(store, opened.review.id, progress(opened.loaded), now, new Set(opened.loaded.items.map((item) => item.id)));
    await submitRound(store, opened.review.id, { verdict: 'changes_requested', summary: '' }, now);
    const { url, result } = await start({ markdown: '# Plan without items', reviewId: opened.review.id });
    await send(url, '/api/session', { answers: {}, threads: [] });
    await send(url, '/api/cancel');
    await result;
    expect((await store.get(opened.review.id))?.answers.storage.choice).toBe('B');
  });

  it('serves HTML and resolves assets relative to the plan directory', async () => {
    writeFileSync(join(home, 'diagram.svg'), '<svg></svg>');
    const { url } = await start({ markdown, planPath: join(home, 'plan.md') });
    const html = await (await http(`${url}/`)).text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<div id="app">');
    expect((await http(`${url}/_assets/missing.png`)).status).toBe(404);
    expect(await (await http(`${url}/_assets/diagram.svg`)).text()).toBe('<svg></svg>');
  });
});

it('updates the loaded timestamp after saving progress', async () => {
  const { url, loaded } = await start();
  vi.setSystemTime(new Date('2026-10-15T12:05:00.000Z'));
  expect((await send(url, '/api/session', progress(loaded))).status).toBe(204);
  const current = await (await http(`${url}/api/doc`)).json() as LoadedReview;
  expect(current.review.updatedAt).toBe('2026-10-15T12:05:00.000Z');
  expect(current.review.updatedAt).toBe((await store.get(loaded.review.id))?.updatedAt);
});

it('returns a submitted result and stops when the client disconnects during a delayed submit', async () => {
  const register = HttpTransport.prototype.onSubmit;
  let release!: () => void;
  let committed!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { committed = resolve; });
  vi.spyOn(HttpTransport.prototype, 'onSubmit').mockImplementation(function (handler) {
    register.call(this, async (req) => {
      const output = await handler(req);
      committed();
      await gate;
      return output;
    });
  });
  const { url, result, loaded } = await start();
  let disconnected!: () => void;
  const closed = new Promise<void>((resolve) => { disconnected = resolve; });
  const emit = ServerResponse.prototype.emit;
  const observeClose = vi.spyOn(ServerResponse.prototype, 'emit').mockImplementation(function (event, ...args) {
    const emitted = emit.call(this, event, ...args);
    if (event === 'close') disconnected();
    return emitted;
  });
  const stop = vi.spyOn(HttpTransport.prototype, 'stop');
  const req = request(`${url}/api/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  req.on('error', () => {});
  req.end(JSON.stringify({ verdict: 'approved', summary: 'Saved before disconnect.' }));
  try {
    await ready;
    req.destroy();
    await closed;
    expect(stop).not.toHaveBeenCalled();
  } finally {
    observeClose.mockRestore();
    release();
  }
  const completed = vi.fn();
  void result.then(completed);
  await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
  expect((await result).kind).toBe('submitted');
  expect(stop).toHaveBeenCalled();
  expect((await store.get(loaded.review.id))?.status).toBe('approved');
});
