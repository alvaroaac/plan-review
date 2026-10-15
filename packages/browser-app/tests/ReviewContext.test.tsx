// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/preact';
import { FakeReviewClient } from '@plan-review/core/client';
import type { LoadedReview, ReviewClient } from '@plan-review/core';
import { ReviewProvider, useReview } from '../src/state/ReviewContext.js';
import { mockLoaded } from './test-utils.js';

let current: ReturnType<typeof useReview>;

function Probe() {
  current = useReview();
  return null;
}

function renderProvider(client: ReviewClient, loaded: LoadedReview = mockLoaded()) {
  return render(
    <ReviewProvider client={client} loaded={loaded} theme="light">
      <Probe />
    </ReviewProvider>,
  );
}

describe('ReviewProvider autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves { answers, threads } 500 ms after a progress change', async () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    renderProvider(client);
    act(() => current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(client.progressSaves).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(client.progressSaves).toHaveLength(1);
    expect(Object.keys(client.progressSaves[0])).toEqual(['answers', 'threads']);
    expect(client.progressSaves[0].answers['retry-backoff'].choice).toBe('A');
  });

  it('debounces consecutive changes into one save of the latest state', async () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    renderProvider(client);
    act(() => current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
    act(() => current.dispatch({ type: 'addThread', sectionId: '1.1', anchor: null, body: 'hi' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(client.progressSaves).toHaveLength(1);
    expect(client.progressSaves[0].threads).toHaveLength(1);
  });

  it('does not save for UI-only actions or on initial load', async () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    renderProvider(client);
    act(() => {
      current.dispatch({ type: 'setTab', tab: 'comments' });
      current.dispatch({ type: 'toggleTheme' });
      current.dispatch({ type: 'focus', target: { kind: 'item', id: 'retry-backoff' } });
      current.dispatch({ type: 'startCompose', sectionId: '1.1', anchor: null });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(client.progressSaves).toHaveLength(0);
  });

  it('flushes the pending save on beforeunload', async () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    renderProvider(client);
    act(() => current.dispatch({ type: 'defer', itemId: 'auth-latency' }));
    await act(async () => { window.dispatchEvent(new Event('beforeunload')); });
    expect(client.progressSaves).toHaveLength(1);
  });

  it('swallows background save failures but keeps the error for the next flush', async () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    client.saveProgress = vi.fn(() => Promise.reject(new Error('offline')));
    renderProvider(client);
    act(() => current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
    // advanceTimersByTimeAsync would reject if the timer callback rethrew the failure.
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(client.saveProgress).toHaveBeenCalledTimes(1);
    expect(current.state.review.answers['retry-backoff'].choice).toBe('A');
    await expect(current.flushAutosave()).rejects.toThrow('offline');
  });
});

describe('ReviewProvider flushAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('exposes the client', () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    renderProvider(client);
    expect(current.client).toBe(client);
  });

  it('sends the pending save immediately and resolves once it has landed', async () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    let land!: () => void;
    client.saveProgress = vi.fn(() => new Promise<void>((resolve) => { land = resolve; }));
    renderProvider(client);
    act(() => current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));

    let flushed = false;
    const flush = current.flushAutosave().then(() => { flushed = true; });
    await act(async () => { await Promise.resolve(); });
    expect(client.saveProgress).toHaveBeenCalledTimes(1);
    expect(flushed).toBe(false);
    land();
    await flush;
    expect(flushed).toBe(true);
  });

  it('resolves at once when nothing is pending', async () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    renderProvider(client);
    await current.flushAutosave();
    expect(client.progressSaves).toHaveLength(0);
  });

  it('rejects when the save fails, and retries the latest state on the next flush', async () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    const save = client.saveProgress.bind(client);
    client.saveProgress = () => Promise.reject(new Error('offline'));
    renderProvider(client);
    act(() => current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
    await expect(current.flushAutosave()).rejects.toThrow('offline');

    client.saveProgress = save;
    await current.flushAutosave();
    expect(client.progressSaves).toHaveLength(1);
    expect(client.progressSaves[0].answers['retry-backoff'].choice).toBe('A');
  });
});

describe('ReviewProvider planChanged', () => {
  it('flushes pending progress, reloads from the client and does not save the reload back', async () => {
    const first = mockLoaded();
    const second = mockLoaded({ review: { ...first.review, round: 3 } });
    const client = new FakeReviewClient({ loaded: first });
    client.loadDocument = vi.fn(async () => second);
    renderProvider(client, first);
    act(() => current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
    window.dispatchEvent(new MessageEvent('message', { data: { kind: 'event', type: 'planChanged' } }));
    await waitFor(() => expect(current.state.review.round).toBe(3));
    expect(client.progressSaves).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 600));
    expect(client.progressSaves).toHaveLength(1);
  });

  it('keeps local progress and skips the reload when the flush fails', async () => {
    const first = mockLoaded();
    const client = new FakeReviewClient({ loaded: first });
    client.saveProgress = vi.fn(() => Promise.reject(new Error('offline')));
    client.loadDocument = vi.fn(async () => mockLoaded({ review: { ...first.review, round: 3 } }));
    renderProvider(client, first);
    act(() => current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
    window.dispatchEvent(new MessageEvent('message', { data: { kind: 'event', type: 'planChanged' } }));
    await waitFor(() => expect(client.saveProgress).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(client.loadDocument).not.toHaveBeenCalled();
    expect(current.state.review.round).toBe(2);
    expect(current.state.review.answers['retry-backoff'].choice).toBe('A');
    // The failure is still pending, so a submit flush rejects rather than sending over it.
    await expect(current.flushAutosave()).rejects.toThrow('offline');
  });
});

describe('useReview', () => {
  it('throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ReviewProvider/);
    spy.mockRestore();
  });
});
