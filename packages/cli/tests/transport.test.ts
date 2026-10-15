import { describe, it, expect, vi } from 'vitest';
import { HttpTransport } from '../src/transport.js';
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

const sendJson = (url: string, path: string, method: string, body: unknown) =>
  fetch(`${url}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('HttpTransport', () => {
  it('starts server and returns url', async () => {
    const transport = new HttpTransport();
    transport.setLoaded(loaded);
    const { url } = await transport.start(0);
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);
    await transport.stop();
  });

  it('throws if start called without a loaded review', async () => {
    const transport = new HttpTransport();
    await expect(transport.start(0)).rejects.toThrow('No review loaded');
  });

  it('serves the loaded review via GET /api/doc and reflects setLoaded updates', async () => {
    const transport = new HttpTransport();
    transport.setLoaded(loaded);
    const { url } = await transport.start(0);

    expect((await (await fetch(`${url}/api/doc`)).json()).document.title).toBe('Test');

    transport.setLoaded({ ...loaded, document: { ...loaded.document, title: 'Changed' } });
    expect((await (await fetch(`${url}/api/doc`)).json()).document.title).toBe('Changed');

    await transport.stop();
  });

  it('routes PUT /api/session to the onProgress handler', async () => {
    const transport = new HttpTransport();
    transport.setLoaded(loaded);
    const handler = vi.fn().mockResolvedValue(undefined);
    transport.onProgress(handler);
    const { url } = await transport.start(0);

    const body = { answers: {}, threads: [] };
    const res = await sendJson(url, '/api/session', 'PUT', body);

    expect(res.status).toBe(204);
    expect(handler).toHaveBeenCalledWith(body);
    await transport.stop();
  });

  it('routes POST /api/review to onSubmit and returns its output', async () => {
    const transport = new HttpTransport();
    transport.setLoaded(loaded);
    const handler = vi.fn().mockResolvedValue('the output');
    transport.onSubmit(handler);
    const { url } = await transport.start(0);

    const body = { verdict: 'approved', summary: 'Looks ready.' };
    const res = await sendJson(url, '/api/review', 'POST', body);

    expect(await res.json()).toEqual({ ok: true, output: 'the output' });
    expect(handler).toHaveBeenCalledWith(body);
    await transport.stop();
  });

  it('POST /api/review rejects a malformed body', async () => {
    const transport = new HttpTransport();
    transport.setLoaded(loaded);
    const { url } = await transport.start(0);

    const res = await sendJson(url, '/api/review', 'POST', { verdict: null, summary: '' });

    expect(res.status).toBe(400);
    await transport.stop();
  });

  it('stop is safe to call multiple times', async () => {
    const transport = new HttpTransport();
    transport.setLoaded(loaded);
    await transport.start(0);
    await transport.stop();
    await transport.stop();
  });
});
