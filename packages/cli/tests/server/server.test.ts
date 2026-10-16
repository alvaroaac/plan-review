import { describe, it, expect, vi } from 'vitest';
import { createReviewServer, startServer, stopServer } from '../../src/server/server.js';
import type { Server } from 'node:http';
import type { LoadedReview } from '@plan-review/core';

const loaded: LoadedReview = {
  document: {
    title: 'Test',
    metadata: {},
    mode: 'generic',
    sections: [{ id: 'section-1', heading: 'S1', level: 2, body: 'content' }],
    comments: [],
  },
  items: [],
  warnings: [],
  review: { id: 'rv_1', round: 1, status: 'open', updatedAt: '2026-10-15T09:00:00.000Z', answers: {}, threads: [] },
};

describe('server lifecycle', () => {
  it('closes idle connections gracefully without forcing active connections', async () => {
    const server = createReviewServer({ getLoaded: () => loaded, onProgress: vi.fn(), onSubmit: vi.fn(), getAssetHtml: () => '' });
    await startServer(server, 0);
    const force = vi.spyOn(server, 'closeAllConnections');
    const idle = vi.spyOn(server, 'closeIdleConnections');
    await stopServer(server);
    expect(idle).toHaveBeenCalled();
    expect(force).not.toHaveBeenCalled();
  });

  it('forces lingering connections only after the 2000 ms shutdown deadline', async () => {
    vi.useFakeTimers();
    let closed!: () => void;
    const server = {
      close: vi.fn((callback: () => void) => { closed = callback; }),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(() => closed()),
    };
    try {
      const stopped = stopServer(server as unknown as Server);
      expect(server.closeAllConnections).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1999);
      expect(server.closeAllConnections).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await stopped;
      expect(server.closeAllConnections).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('createReviewServer returns an http.Server', () => {
    const server = createReviewServer({
      getLoaded: () => loaded,
      onProgress: vi.fn(),
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });
    expect(server).toBeDefined();
    expect(typeof server.listen).toBe('function');
  });

  it('startServer binds to port and returns url', async () => {
    const server = createReviewServer({
      getLoaded: () => loaded,
      onProgress: vi.fn(),
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const { url } = await startServer(server, 0);
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);

    await stopServer(server);
  });

  it('stopServer closes the server', async () => {
    const server = createReviewServer({
      getLoaded: () => loaded,
      onProgress: vi.fn(),
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    await startServer(server, 0);
    await stopServer(server);

    expect(server.listening).toBe(false);
  });

  it('server responds to requests after start', async () => {
    const server = createReviewServer({
      getLoaded: () => loaded,
      onProgress: vi.fn(),
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const { url } = await startServer(server, 0);
    const res = await fetch(`${url}/api/doc`);
    expect(res.status).toBe(200);

    await stopServer(server);
  });
});
