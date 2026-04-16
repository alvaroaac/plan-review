import { describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createRouteHandler } from '../../src/server/routes.js';
import type { PlanDocument, ReviewComment } from '../../src/types.js';

const mockDoc: PlanDocument = {
  title: 'Test Plan',
  metadata: {},
  mode: 'plan',
  sections: [
    { id: '1.1', heading: 'Task 1', level: 3, body: 'Task body' },
  ],
  comments: [],
};

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

describe('server routes', () => {
  it('GET /api/doc returns document JSON', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const res = await fetch(`http://localhost:${port}/api/doc`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(data.document.title).toBe('Test Plan');
    expect(data.document.sections).toHaveLength(1);

    await stopTestServer(server);
  });

  it('POST /api/review calls onSubmit with parsed comments', async () => {
    const onSubmit = vi.fn();
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit,
      getAssetHtml: () => '<html></html>',
    });

    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'Looks good', timestamp: new Date('2026-04-13') },
    ];

    const res = await fetch(`http://localhost:${port}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toHaveLength(1);
    expect(onSubmit.mock.calls[0][0][0].sectionId).toBe('1.1');

    await stopTestServer(server);
  });

  it('POST /api/review rejects invalid body', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const res = await fetch(`http://localhost:${port}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);

    await stopTestServer(server);
  });

  it('GET / serves HTML from getAssetHtml', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html><body>Review App</body></html>',
    });

    const res = await fetch(`http://localhost:${port}/`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('Review App');

    await stopTestServer(server);
  });

  it('returns 404 for unknown routes', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);

    await stopTestServer(server);
  });

  it('POST /api/review rejects comment missing sectionId', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const res = await fetch(`http://localhost:${port}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: [{ text: 'no section id' }] }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('sectionId');

    await stopTestServer(server);
  });

  it('POST /api/review rejects comment missing text', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const res = await fetch(`http://localhost:${port}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: [{ sectionId: '1.1' }] }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('text');

    await stopTestServer(server);
  });

  it('POST /api/review rejects non-object comment elements', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    const res = await fetch(`http://localhost:${port}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: [null, 42, 'string'] }),
    });

    expect(res.status).toBe(400);

    await stopTestServer(server);
  });

  it('POST /api/review accepts valid comments with optional anchor', async () => {
    const onSubmit = vi.fn();
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit,
      getAssetHtml: () => '<html></html>',
    });

    const comments = [
      { sectionId: '1.1', text: 'Section comment', timestamp: new Date().toISOString() },
      {
        sectionId: '1.1', text: 'Line comment', timestamp: new Date().toISOString(),
        anchor: { startLine: 0, endLine: 1, lineTexts: ['line 1', 'line 2'] },
      },
    ];

    const res = await fetch(`http://localhost:${port}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments }),
    });

    expect(res.status).toBe(200);
    expect(onSubmit).toHaveBeenCalledOnce();

    await stopTestServer(server);
  });

  it('PUT /api/session calls onSessionSave with comments and activeSection', async () => {
    const onSessionSave = vi.fn();
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
      onSessionSave,
    });

    const comments = [
      { sectionId: '1.1', text: 'In progress', timestamp: new Date().toISOString() },
    ];

    const res = await fetch(`http://localhost:${port}/api/session`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments, activeSection: '1.1' }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(onSessionSave).toHaveBeenCalledOnce();
    expect(onSessionSave.mock.calls[0][0]).toHaveLength(1);
    expect(onSessionSave.mock.calls[0][0][0].sectionId).toBe('1.1');
    expect(onSessionSave.mock.calls[0][1]).toBe('1.1');

    await stopTestServer(server);
  });

  it('PUT /api/session rejects non-array comments', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
      onSessionSave: vi.fn(),
    });

    const res = await fetch(`http://localhost:${port}/api/session`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: 'not an array' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('comments must be an array');

    await stopTestServer(server);
  });

  it('POST /api/review returns 413 for oversized body', async () => {
    const { server, port } = await startTestServer({
      getDocument: () => mockDoc,
      onSubmit: vi.fn(),
      getAssetHtml: () => '<html></html>',
    });

    // Send >1MB body
    const bigBody = 'x'.repeat(1024 * 1024 + 1);

    const res = await fetch(`http://localhost:${port}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bigBody,
    });

    expect(res.status).toBe(413);

    await stopTestServer(server);
  });
});
