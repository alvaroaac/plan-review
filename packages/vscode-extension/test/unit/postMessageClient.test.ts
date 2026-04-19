import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PostMessageReviewClient } from '../../src/postMessageClient.js';

type Msg = { id: string; kind: 'req' | 'res' | 'err'; [k: string]: any };

function setupWindow() {
  const sent: Msg[] = [];
  const listeners: ((e: MessageEvent) => void)[] = [];
  (globalThis as any).acquireVsCodeApi = () => ({ postMessage: (m: Msg) => { sent.push(m); } });
  (globalThis as any).window = {
    addEventListener: (_ev: string, fn: (e: MessageEvent) => void) => { listeners.push(fn); },
    removeEventListener: () => {},
  };
  return { sent, emit: (m: Msg) => listeners.forEach((l) => l({ data: m } as MessageEvent)) };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete (globalThis as any).window; delete (globalThis as any).acquireVsCodeApi; });

describe('PostMessageReviewClient', () => {
  it('loadDocument sends req and resolves on matching res', async () => {
    const { sent, emit } = setupWindow();
    const c = new PostMessageReviewClient();
    const p = c.loadDocument();
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('loadDocument');
    emit({ id: sent[0].id, kind: 'res', result: { document: { title: 't' } } });
    await expect(p).resolves.toEqual({ document: { title: 't' } });
  });

  it('rejects on err response', async () => {
    const { sent, emit } = setupWindow();
    const c = new PostMessageReviewClient();
    const p = c.submitReview([]);
    emit({ id: sent[0].id, kind: 'err', error: 'boom' });
    await expect(p).rejects.toThrow('boom');
  });

  it('times out after 30s with no response', async () => {
    setupWindow();
    const c = new PostMessageReviewClient();
    const p = c.saveSession({ comments: [], activeSection: null, contentHash: 'h' });
    vi.advanceTimersByTime(30_000);
    await expect(p).rejects.toThrow(/timeout/i);
  });
});
