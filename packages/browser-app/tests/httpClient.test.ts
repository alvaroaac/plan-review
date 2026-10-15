import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpReviewClient } from '../src/httpClient.js';
import { mockLoaded } from './test-utils.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('HttpReviewClient', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('loadDocument GETs /api/doc and returns the LoadedReview', async () => {
    const loaded = mockLoaded();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(loaded));
    await expect(new HttpReviewClient().loadDocument()).resolves.toEqual(loaded);
    expect(fetchSpy).toHaveBeenCalledWith('/api/doc');
  });

  it('saveProgress PUTs answers + threads to /api/session with keepalive and accepts 204', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const update = { answers: {}, threads: [] };
    await expect(new HttpReviewClient().saveProgress(update)).resolves.toBeUndefined();
    // keepalive lets the beforeunload flush outlive the page.
    expect(fetchSpy).toHaveBeenCalledWith('/api/session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
      keepalive: true,
    });
  });

  it('submitReview POSTs verdict + summary to /api/review and returns the output', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ok: true, output: 'formatted' }));
    const req = { verdict: 'approved' as const, summary: 'LGTM' };
    await expect(new HttpReviewClient().submitReview(req)).resolves.toEqual({ ok: true, output: 'formatted' });
    expect(fetchSpy).toHaveBeenCalledWith('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  });

  it('rejects with the server error text on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: 'Review is already approved' }, 409));
    await expect(new HttpReviewClient().saveProgress({ answers: {}, threads: [] }))
      .rejects.toThrow('Review is already approved');
  });

  it('falls back to the status when the error body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(new HttpReviewClient().submitReview({ verdict: 'changes_requested', summary: '' }))
      .rejects.toThrow('submitReview failed: 500');
  });

  it('loadDocument rejects on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: 'gone' }, 404));
    await expect(new HttpReviewClient().loadDocument()).rejects.toThrow('gone');
  });
});
