// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/preact';
import { FakeReviewClient } from '@plan-review/core/client';
import type { LoadedReview, ProgressUpdate, ReviewClient } from '@plan-review/core';
import { ReviewProvider, useReview } from '../src/state/ReviewContext.js';
import { answer, decisionItem, lineAnchor, mockLoaded, thread } from './test-utils.js';

let current: ReturnType<typeof useReview>;

/** Like a browser, rejects keepalive bodies over 64 KiB; keepalive saves are kept apart from routine ones. */
class KeepaliveLimitedClient extends FakeReviewClient {
  readonly unloadSaves: ProgressUpdate[] = [];
  async saveProgress(update: ProgressUpdate, opts: { keepalive?: boolean } = {}) {
    if (!opts.keepalive) return super.saveProgress(update);
    if (new TextEncoder().encode(JSON.stringify(update)).length > 65_536) throw new TypeError('keepalive body too large');
    this.unloadSaves.push(update);
  }
}

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

  it('saves a just-posted change with keepalive on beforeunload, before the autosave effect has run', async () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    client.saveProgress = vi.fn(async () => {});
    renderProvider(client);
    // Outside act: the change renders, but the effect that schedules autosave has not run yet.
    current.dispatch({ type: 'addThread', sectionId: '1.1', anchor: null, body: 'just posted' });
    await Promise.resolve();
    window.dispatchEvent(new Event('beforeunload'));
    expect(client.saveProgress).toHaveBeenCalledTimes(1);
    const [update, opts] = vi.mocked(client.saveProgress).mock.calls[0];
    expect(update.threads.map((t) => t.comments[0].body)).toEqual(['just posted']);
    expect(opts).toEqual({ keepalive: true });
    // The unload save replaces the queued autosave instead of racing it.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(client.saveProgress).toHaveBeenCalledTimes(1);
  });

  it('sends only the changes since the last acknowledged save on beforeunload, within the keepalive limit', async () => {
    const big = thread('t-big', '1.1', null, {
      comments: [{ id: 'c-big', author: 'reviewer', body: 'x'.repeat(70_000), createdAt: '2026-10-15T10:00:00.000Z' }],
    });
    const loaded = mockLoaded({ review: { ...mockLoaded().review, threads: [big] } });
    const client = new KeepaliveLimitedClient({ loaded });
    renderProvider(client, loaded);
    act(() => current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(client.progressSaves).toHaveLength(1);

    current.dispatch({ type: 'addThread', sectionId: '1.1', anchor: null, body: 'final' });
    await Promise.resolve();
    window.dispatchEvent(new Event('beforeunload'));
    await act(async () => { await Promise.resolve(); });
    expect(client.unloadSaves).toHaveLength(1);
    const [update] = client.unloadSaves;
    expect(update).toEqual({ answers: {}, threads: [expect.objectContaining({ id: current.state.review.threads[1].id })], merge: true });
    expect(update.threads[0].comments[0].body).toBe('final');
  });

  it('includes an unacknowledged in-flight save in the beforeunload changes', async () => {
    const client = new KeepaliveLimitedClient({ loaded: mockLoaded() });
    const save = vi.spyOn(FakeReviewClient.prototype, 'saveProgress').mockReturnValue(new Promise(() => {}));
    renderProvider(client);
    act(() => current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(save).toHaveBeenCalledTimes(1);
    act(() => current.dispatch({ type: 'addThread', sectionId: '1.1', anchor: null, body: 'final' }));
    window.dispatchEvent(new Event('beforeunload'));
    save.mockRestore();
    expect(client.unloadSaves).toHaveLength(1);
    expect(Object.keys(client.unloadSaves[0].answers)).toEqual(['retry-backoff']);
    expect(client.unloadSaves[0].threads).toHaveLength(1);
  });

  it('sends nothing on beforeunload once the latest progress has been saved', async () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    renderProvider(client);
    act(() => current.dispatch({ type: 'defer', itemId: 'auth-latency' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    window.dispatchEvent(new Event('beforeunload'));
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

describe('ReviewProvider reload ordering', () => {
  it('holds progress edits made during a reload and saves them on top of the reloaded round', async () => {
    const first = mockLoaded();
    const second = mockLoaded({
      review: { ...first.review, round: 3, answers: { 'retry-backoff': answer(decisionItem, 'B') } },
    });
    const client = new FakeReviewClient({ loaded: first });
    let finishLoad!: (loaded: LoadedReview) => void;
    client.loadDocument = vi.fn(() => new Promise<LoadedReview>((resolve) => { finishLoad = resolve; }));
    renderProvider(client, first);
    window.dispatchEvent(new MessageEvent('message', { data: { kind: 'event', type: 'planChanged' } }));
    await waitFor(() => expect(client.loadDocument).toHaveBeenCalled());

    act(() => current.dispatch({ type: 'addThread', sectionId: '1.1', anchor: null, body: 'mid-reload' }));
    await new Promise((r) => setTimeout(r, 600));
    // No pre-reload snapshot may be saved over the new round.
    expect(client.progressSaves).toHaveLength(0);

    await act(async () => { finishLoad(second); });
    await waitFor(() => expect(current.state.review.round).toBe(3));
    expect(current.state.review.threads.map((t) => t.comments[0].body)).toEqual(['mid-reload']);
    await waitFor(() => expect(client.progressSaves).toHaveLength(1));
    expect(client.progressSaves[0].answers['retry-backoff'].choice).toBe('B');
    expect(client.progressSaves[0].threads.map((t) => t.comments[0].body)).toEqual(['mid-reload']);
  });

  it('keeps a held answer tied to the item revision it was given for', async () => {
    const first = mockLoaded();
    const revised = first.items.map((item) => (item.id === 'retry-backoff' ? { ...item, hash: 'h-revised' } : item));
    const second = mockLoaded({ items: revised, review: { ...first.review, round: 3 } });
    const client = new FakeReviewClient({ loaded: first });
    let finishLoad!: (loaded: LoadedReview) => void;
    client.loadDocument = vi.fn(() => new Promise<LoadedReview>((resolve) => { finishLoad = resolve; }));
    renderProvider(client, first);
    window.dispatchEvent(new MessageEvent('message', { data: { kind: 'event', type: 'planChanged' } }));
    await waitFor(() => expect(client.loadDocument).toHaveBeenCalled());

    act(() => current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
    await act(async () => { finishLoad(second); });
    await waitFor(() => expect(current.state.review.round).toBe(3));
    const oldHash = first.items.find((item) => item.id === 'retry-backoff')!.hash;
    expect(current.state.review.answers['retry-backoff'].itemHash).toBe(oldHash);
  });

  it('posts a held comment on its own re-anchored block when another composer opens during the reload', async () => {
    const first = mockLoaded();
    const sections = first.document.sections.map((s) => (s.id === '1.1' ? { ...s, body: 'Intro.\n\n' + s.body } : s));
    const second = mockLoaded({ document: { ...first.document, sections }, review: { ...first.review, round: 3 } });
    const client = new FakeReviewClient({ loaded: first });
    let finishLoad!: (loaded: LoadedReview) => void;
    client.loadDocument = vi.fn(() => new Promise<LoadedReview>((resolve) => { finishLoad = resolve; }));
    renderProvider(client, first);
    const onA = { sectionId: '1.1', anchor: lineAnchor(0, ['Bold and code']) };
    const onB = { sectionId: '1.2', anchor: lineAnchor(0, ['Second task content']) };
    act(() => current.dispatch({ type: 'startCompose', ...onA }));
    window.dispatchEvent(new MessageEvent('message', { data: { kind: 'event', type: 'planChanged' } }));
    await waitFor(() => expect(client.loadDocument).toHaveBeenCalled());

    act(() => current.dispatch({ type: 'addThread', ...onA, body: 'about A' }));
    act(() => current.dispatch({ type: 'startCompose', ...onB }));
    await act(async () => { finishLoad(second); });
    await waitFor(() => expect(current.state.review.round).toBe(3));
    expect(current.state.review.threads).toHaveLength(1);
    expect(current.state.review.threads[0]).toMatchObject({ sectionId: '1.1', anchor: lineAnchor(1, ['Bold and code']) });
    expect(current.state.review.threads[0].comments[0].body).toBe('about A');
    expect(current.state.ui.composing).toMatchObject(onB);
  });

  it('replays held edits when the reload fails', async () => {
    const client = new FakeReviewClient({ loaded: mockLoaded() });
    let failLoad!: (err: Error) => void;
    client.loadDocument = vi.fn(() => new Promise<LoadedReview>((_, reject) => { failLoad = reject; }));
    renderProvider(client);
    window.dispatchEvent(new MessageEvent('message', { data: { kind: 'event', type: 'planChanged' } }));
    await waitFor(() => expect(client.loadDocument).toHaveBeenCalled());
    act(() => current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
    await act(async () => { failLoad(new Error('gone')); });
    await waitFor(() => expect(current.state.review.answers['retry-backoff']?.choice).toBe('A'));
  });
});

describe('useReview', () => {
  it('throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ReviewProvider/);
    spy.mockRestore();
  });
});
