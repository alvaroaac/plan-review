import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpReviewClient } from '../src/httpClient.js';
import type { PlanDocument } from '@plan-review/core';

const doc: PlanDocument = { title: 't', metadata: {}, mode: 'generic', sections: [], comments: [] };

describe('HttpReviewClient', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('loadDocument GETs /api/doc', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ document: doc }), { status: 200 }),
    );
    const client = new HttpReviewClient();
    await expect(client.loadDocument()).resolves.toEqual({ document: doc });
    expect(fetchSpy).toHaveBeenCalledWith('/api/doc');
  });

  it('saveSession PUTs /api/session with comments + activeSection', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const client = new HttpReviewClient();
    await client.saveSession({ comments: [], activeSection: 's1', contentHash: 'h' });
    expect(fetchSpy).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ comments: [], activeSection: 's1', contentHash: 'h' }),
    }));
  });

  it('submitReview POSTs full ReviewSubmission body to /api/review', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const client = new HttpReviewClient();
    await expect(client.submitReview({
      comments: [{ sectionId: '1', text: 'note', timestamp: new Date('2026-04-29') }],
      verdict: 'approved',
      summary: 'LGTM',
    })).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith('/api/review', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.verdict).toBe('approved');
    expect(body.summary).toBe('LGTM');
    expect(body.comments).toHaveLength(1);
  });

  it('submitReview rejects on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const client = new HttpReviewClient();
    await expect(client.submitReview({ comments: [], verdict: null, summary: '' })).rejects.toThrow();
  });
});
