import { describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createRouteHandler, isProgressUpdate, isSubmitRequest } from '../../src/server/routes.js';
import type { Answer, LoadedReview, ProgressUpdate, Thread } from '@plan-review/core';

const loaded: LoadedReview = {
  document: {
    title: 'Test Plan',
    metadata: {},
    mode: 'plan',
    sections: [{ id: '1.1', heading: 'Task 1', level: 3, body: 'Task body' }],
    comments: [],
  },
  items: [],
  warnings: [],
  review: { id: 'rv_1', round: 1, status: 'open', updatedAt: '2026-10-15T09:00:00.000Z', answers: {}, threads: [] },
};

const answer: Answer = { choice: 'A', note: '', itemHash: 'h1', round: 1, updatedAt: '2026-10-15T00:00:00.000Z' };

const thread: Thread = {
  id: 't_1',
  sectionId: '1.1',
  anchor: { type: 'lines', startLine: 0, endLine: 1, lineTexts: ['a', 'b'] },
  resolved: false,
  outdated: false,
  createdRound: 1,
  comments: [{ id: 'c_1', author: 'reviewer', body: 'hi', createdAt: '2026-10-15T00:00:00.000Z' }],
};

const progress: ProgressUpdate = { answers: { 'item-1': answer }, threads: [thread] };

function baseCtx(overrides: Partial<Parameters<typeof createRouteHandler>[0]> = {}) {
  return {
    getLoaded: () => loaded,
    getAssetHtml: () => '<html></html>',
    onProgress: vi.fn().mockResolvedValue(undefined),
    onSubmit: vi.fn().mockResolvedValue('formatted output'),
    ...overrides,
  };
}

function startTestServer(ctx: Parameters<typeof createRouteHandler>[0]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(createRouteHandler(ctx));
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function stopTestServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function send(port: number, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('server routes', () => {
  it('GET /api/doc returns the LoadedReview JSON', async () => {
    const { server, port } = await startTestServer(baseCtx());
    const res = await send(port, 'GET', '/api/doc');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(loaded);
    await stopTestServer(server);
  });

  it('GET / serves HTML from getAssetHtml', async () => {
    const { server, port } = await startTestServer(baseCtx({ getAssetHtml: () => '<html><body>Hi</body></html>' }));
    const res = await send(port, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Hi');
    await stopTestServer(server);
  });

  it('returns 404 for unknown routes', async () => {
    const { server, port } = await startTestServer(baseCtx());
    expect((await send(port, 'GET', '/nope')).status).toBe(404);
    await stopTestServer(server);
  });

  describe('PUT /api/session', () => {
    it('calls onProgress with a valid body and returns 204', async () => {
      const ctx = baseCtx();
      const { server, port } = await startTestServer(ctx);
      const res = await send(port, 'PUT', '/api/session', progress);
      expect(res.status).toBe(204);
      expect(ctx.onProgress).toHaveBeenCalledWith(progress);
      await stopTestServer(server);
    });

    it('returns 400 with error for an invalid shape', async () => {
      const ctx = baseCtx();
      const { server, port } = await startTestServer(ctx);
      const res = await send(port, 'PUT', '/api/session', { answers: [], threads: [] });
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty('error');
      expect(ctx.onProgress).not.toHaveBeenCalled();
      await stopTestServer(server);
    });

    it('returns 400 for malformed JSON', async () => {
      const { server, port } = await startTestServer(baseCtx());
      const res = await send(port, 'PUT', '/api/session', '{nope');
      expect(res.status).toBe(400);
      await stopTestServer(server);
    });

    it('returns 409 when the handler throws ReviewApprovedError', async () => {
      const err = new Error('review is approved');
      err.name = 'ReviewApprovedError';
      const { server, port } = await startTestServer(baseCtx({ onProgress: vi.fn().mockRejectedValue(err) }));
      const res = await send(port, 'PUT', '/api/session', progress);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'review is approved' });
      await stopTestServer(server);
    });

    it('returns 500 when the handler throws anything else', async () => {
      const { server, port } = await startTestServer(baseCtx({ onProgress: vi.fn().mockRejectedValue(new Error('disk')) }));
      const res = await send(port, 'PUT', '/api/session', progress);
      expect(res.status).toBe(500);
      await stopTestServer(server);
    });

    it('returns 413 for an oversized body', async () => {
      const { server, port } = await startTestServer(baseCtx());
      const res = await send(port, 'PUT', '/api/session', 'x'.repeat(1024 * 1024 + 1));
      expect(res.status).toBe(413);
      await stopTestServer(server);
    });
  });

  describe('POST /api/review', () => {
    it('calls onSubmit and returns { ok, output }', async () => {
      const ctx = baseCtx();
      const { server, port } = await startTestServer(ctx);
      const body = { verdict: 'changes_requested', summary: 'Fix it' };
      const res = await send(port, 'POST', '/api/review', body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, output: 'formatted output' });
      expect(ctx.onSubmit).toHaveBeenCalledWith(body);
      await stopTestServer(server);
    });

    it.each([
      { verdict: 'nope', summary: '' },
      { verdict: null, summary: '' },
      { verdict: 'approved', summary: 5 },
      { verdict: 'approved' },
    ])('returns 400 for %j', async (body) => {
      const ctx = baseCtx();
      const { server, port } = await startTestServer(ctx);
      const res = await send(port, 'POST', '/api/review', body);
      expect(res.status).toBe(400);
      expect(ctx.onSubmit).not.toHaveBeenCalled();
      await stopTestServer(server);
    });

    it('returns 409 when onSubmit throws ReviewApprovedError', async () => {
      const err = new Error('already approved');
      err.name = 'ReviewApprovedError';
      const { server, port } = await startTestServer(baseCtx({ onSubmit: vi.fn().mockRejectedValue(err) }));
      const res = await send(port, 'POST', '/api/review', { verdict: 'approved', summary: '' });
      expect(res.status).toBe(409);
      await stopTestServer(server);
    });

    it('returns 413 for an oversized body', async () => {
      const { server, port } = await startTestServer(baseCtx());
      const res = await send(port, 'POST', '/api/review', 'x'.repeat(1024 * 1024 + 1));
      expect(res.status).toBe(413);
      await stopTestServer(server);
    });
  });

  it('heartbeat / pause / cancel call their handlers and return 204', async () => {
    const onHeartbeat = vi.fn();
    const onPause = vi.fn();
    const onCancel = vi.fn();
    const { server, port } = await startTestServer(baseCtx({ onHeartbeat, onPause, onCancel }));
    for (const path of ['/api/heartbeat', '/api/pause', '/api/cancel']) {
      expect((await send(port, 'POST', path)).status).toBe(204);
    }
    expect(onHeartbeat).toHaveBeenCalledOnce();
    expect(onPause).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    await stopTestServer(server);
  });

  it('heartbeat / pause / cancel no-op without handlers', async () => {
    const { server, port } = await startTestServer(baseCtx());
    for (const path of ['/api/heartbeat', '/api/pause', '/api/cancel']) {
      expect((await send(port, 'POST', path)).status).toBe(204);
    }
    await stopTestServer(server);
  });

  it('GET /_assets returns 404 without an asset base dir', async () => {
    const { server, port } = await startTestServer(baseCtx());
    expect((await send(port, 'GET', '/_assets/a.png')).status).toBe(404);
    await stopTestServer(server);
  });
});

describe('isProgressUpdate', () => {
  const clone = () => structuredClone(progress) as any;

  it('accepts a valid update, including null anchor and empty collections', () => {
    expect(isProgressUpdate(progress)).toBe(true);
    const nullAnchor = clone();
    nullAnchor.threads[0].anchor = null;
    expect(isProgressUpdate(nullAnchor)).toBe(true);
    expect(isProgressUpdate({ answers: {}, threads: [] })).toBe(true);
  });

  it.each([null, 'x', [], { threads: [] }, { answers: {} }])('rejects non-update %j', (x) => {
    expect(isProgressUpdate(x)).toBe(false);
  });

  it('rejects non-object answers', () => {
    expect(isProgressUpdate({ answers: [], threads: [] })).toBe(false);
    expect(isProgressUpdate({ answers: 'x', threads: [] })).toBe(false);
    expect(isProgressUpdate({ answers: { a: 'B' }, threads: [] })).toBe(false);
  });

  it.each(['choice', 'note', 'itemHash', 'round', 'updatedAt'])('rejects answer missing %s', (key) => {
    const p = clone();
    delete p.answers['item-1'][key];
    expect(isProgressUpdate(p)).toBe(false);
  });

  it('rejects answers with wrong types', () => {
    const p = clone();
    p.answers['item-1'].round = '1';
    expect(isProgressUpdate(p)).toBe(false);
    const q = clone();
    q.answers['item-1'].note = 3;
    expect(isProgressUpdate(q)).toBe(false);
  });

  it.each(['id', 'sectionId', 'resolved', 'outdated', 'createdRound', 'comments'])('rejects thread missing %s', (key) => {
    const p = clone();
    delete p.threads[0][key];
    expect(isProgressUpdate(p)).toBe(false);
  });

  it('rejects a comment author other than reviewer|agent', () => {
    const p = clone();
    p.threads[0].comments[0].author = 'bot';
    expect(isProgressUpdate(p)).toBe(false);
  });

  it('rejects malformed comments', () => {
    const p = clone();
    p.threads[0].comments[0].body = 1;
    expect(isProgressUpdate(p)).toBe(false);
  });

  it('rejects an anchor that is neither null nor a valid LineAnchor', () => {
    const badAnchors = [
      undefined,
      'x',
      { type: 'lines' },
      { type: 'range', startLine: 0, endLine: 1, lineTexts: [] },
      { type: 'lines', startLine: 0, endLine: 1, lineTexts: [1] },
    ];
    for (const anchor of badAnchors) {
      const p = clone();
      p.threads[0].anchor = anchor;
      expect(isProgressUpdate(p)).toBe(false);
    }
  });
});

describe('isSubmitRequest', () => {
  it('accepts valid requests', () => {
    expect(isSubmitRequest({ verdict: 'approved', summary: '' })).toBe(true);
    expect(isSubmitRequest({ verdict: 'changes_requested', summary: 'x' })).toBe(true);
  });

  it.each([null, {}, { verdict: 'rejected', summary: '' }, { verdict: 'approved', summary: 1 }])('rejects %j', (x) => {
    expect(isSubmitRequest(x)).toBe(false);
  });
});
