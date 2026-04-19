import { describe, it, expect, vi } from 'vitest';
import { createReviewServer, startServer, stopServer } from '../../src/server/server.js';
import type { PlanDocument } from '@plan-review/core';

const mockDoc: PlanDocument = {
  title: 'Test',
  metadata: {},
  mode: 'generic',
  sections: [{ id: 'section-1', heading: 'S1', level: 2, body: 'content' }],
  comments: [],
};

describe('server lifecycle', () => {
  it('createReviewServer returns an http.Server', () => {
    const server = createReviewServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });
    expect(server).toBeDefined();
    expect(typeof server.listen).toBe('function');
  });

  it('startServer binds to port and returns url', async () => {
    const server = createReviewServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const { url } = await startServer(server, 0);
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);

    await stopServer(server);
  });

  it('stopServer closes the server', async () => {
    const server = createReviewServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    await startServer(server, 0);
    await stopServer(server);

    expect(server.listening).toBe(false);
  });

  it('server responds to requests after start', async () => {
    const server = createReviewServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const { url } = await startServer(server, 0);
    const res = await fetch(`${url}/api/doc`);
    expect(res.status).toBe(200);

    await stopServer(server);
  });
});
