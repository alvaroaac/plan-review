import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Thread } from '@plan-review/core';
import {
  initReviewState,
  isProgressAction,
  reviewReducer,
  type ReviewAction,
  type ReviewState,
} from '../src/state/reducer.js';
import { mockLoaded } from './test-utils.js';

const NOW = '2026-10-15T12:00:00.000Z';

function stateWith(threads: Thread[] = []): ReviewState {
  const loaded = mockLoaded();
  return initReviewState({ ...loaded, review: { ...loaded.review, threads } }, 'light');
}

const thread: Thread = {
  id: 't_aaaaaa',
  sectionId: '1.1',
  anchor: null,
  resolved: false,
  outdated: false,
  createdRound: 1,
  comments: [{ id: 'c_aaaaaaaa', author: 'reviewer', body: 'first', createdAt: NOW }],
};

describe('initReviewState', () => {
  it('copies the loaded review and starts on the Decisions tab when items exist', () => {
    const state = initReviewState(mockLoaded(), 'dark');
    expect(state.doc.title).toBe('Test Plan');
    expect(state.items).toHaveLength(2);
    expect(state.review.round).toBe(2);
    expect(state.ui).toEqual({
      tab: 'decisions',
      filter: 'open',
      focus: null,
      composing: null,
      theme: 'dark',
      submitOpen: false,
      submitted: null,
      submitError: null,
    });
  });

  it('starts on the Comments tab when the plan has no items', () => {
    expect(initReviewState(mockLoaded({ items: [] }), 'light').ui.tab).toBe('comments');
  });
});

describe('reviewReducer — answers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => vi.useRealTimers());

  it('answer stores choice, note, item hash, round and timestamp', () => {
    const next = reviewReducer(stateWith(), { type: 'answer', itemId: 'retry-backoff', choice: 'B', note: 'why' });
    expect(next.review.answers['retry-backoff']).toEqual({
      choice: 'B', note: 'why', itemHash: 'h-retry', round: 2, updatedAt: NOW,
    });
  });

  it('answer for an unknown item leaves state unchanged', () => {
    const state = stateWith();
    expect(reviewReducer(state, { type: 'answer', itemId: 'nope', choice: 'A', note: '' })).toBe(state);
  });

  it('defer stores a deferred answer with an optional note', () => {
    const state = stateWith();
    const withNote = reviewReducer(state, { type: 'defer', itemId: 'auth-latency', note: 'later' });
    expect(withNote.review.answers['auth-latency']).toEqual({
      choice: 'deferred', note: 'later', itemHash: 'h-latency', round: 2, updatedAt: NOW,
    });
    const noNote = reviewReducer(state, { type: 'defer', itemId: 'auth-latency' });
    expect(noNote.review.answers['auth-latency'].note).toBe('');
  });

  it('clearAnswer removes the answer', () => {
    const answered = reviewReducer(stateWith(), { type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' });
    const cleared = reviewReducer(answered, { type: 'clearAnswer', itemId: 'retry-backoff' });
    expect(cleared.review.answers).toEqual({});
  });
});

describe('reviewReducer — threads', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => vi.useRealTimers());

  it('addThread creates an open thread with one reviewer comment, ends composing and focuses it', () => {
    const anchor = { type: 'lines' as const, startLine: 0, endLine: 0, lineTexts: ['Bold and code'] };
    const composing = reviewReducer(stateWith(), { type: 'startCompose', sectionId: '1.1', anchor });
    const next = reviewReducer(composing, { type: 'addThread', sectionId: '1.1', anchor, body: 'Hm' });
    const [created] = next.review.threads;
    expect(created.id).toMatch(/^t_[0-9a-z]{6}$/);
    expect(created).toMatchObject({ sectionId: '1.1', anchor, resolved: false, outdated: false, createdRound: 2 });
    expect(created.comments).toHaveLength(1);
    expect(created.comments[0]).toMatchObject({ author: 'reviewer', body: 'Hm', createdAt: NOW });
    expect(created.comments[0].id).toMatch(/^c_[0-9a-z]{8}$/);
    expect(next.ui.composing).toBeNull();
    expect(next.ui.focus).toEqual({ kind: 'thread', id: created.id });
  });

  it('reply appends a reviewer comment', () => {
    const next = reviewReducer(stateWith([thread]), { type: 'reply', threadId: thread.id, body: 'second' });
    expect(next.review.threads[0].comments.map((c) => [c.author, c.body])).toEqual([
      ['reviewer', 'first'],
      ['reviewer', 'second'],
    ]);
  });

  it('resolve and reopen toggle resolved', () => {
    const resolved = reviewReducer(stateWith([thread]), { type: 'resolve', threadId: thread.id });
    expect(resolved.review.threads[0].resolved).toBe(true);
    const reopened = reviewReducer(resolved, { type: 'reopen', threadId: thread.id });
    expect(reopened.review.threads[0].resolved).toBe(false);
  });

  it('startCompose sets composing and switches to Comments; cancelCompose clears it', () => {
    const composing = reviewReducer(stateWith(), { type: 'startCompose', sectionId: '1.2', anchor: null });
    expect(composing.ui.composing).toEqual({ sectionId: '1.2', anchor: null });
    expect(composing.ui.tab).toBe('comments');
    expect(reviewReducer(composing, { type: 'cancelCompose' }).ui.composing).toBeNull();
  });
});

describe('reviewReducer — ui', () => {
  it('focus on an item switches to Decisions; on a thread switches to Comments', () => {
    const onComments = reviewReducer(stateWith([thread]), { type: 'setTab', tab: 'comments' });
    const item = reviewReducer(onComments, { type: 'focus', target: { kind: 'item', id: 'retry-backoff' } });
    expect(item.ui.focus).toEqual({ kind: 'item', id: 'retry-backoff' });
    expect(item.ui.tab).toBe('decisions');
    const th = reviewReducer(item, { type: 'focus', target: { kind: 'thread', id: thread.id } });
    expect(th.ui.tab).toBe('comments');
    expect(reviewReducer(th, { type: 'focus', target: null }).ui.focus).toBeNull();
  });

  it('focusing a resolved thread while filtering Open widens the filter to All', () => {
    const state = stateWith([{ ...thread, resolved: true }]);
    const next = reviewReducer(state, { type: 'focus', target: { kind: 'thread', id: thread.id } });
    expect(next.ui.filter).toBe('all');
  });

  it('setTab ignores Decisions when the plan has no items', () => {
    const state = initReviewState(mockLoaded({ items: [] }), 'light');
    expect(reviewReducer(state, { type: 'setTab', tab: 'decisions' }).ui.tab).toBe('comments');
  });

  it('setFilter, toggleTheme, openSubmit / closeSubmit', () => {
    let s = stateWith();
    s = reviewReducer(s, { type: 'setFilter', filter: 'resolved' });
    expect(s.ui.filter).toBe('resolved');
    s = reviewReducer(s, { type: 'toggleTheme' });
    expect(s.ui.theme).toBe('dark');
    s = reviewReducer(s, { type: 'openSubmit' });
    expect(s.ui.submitOpen).toBe(true);
    s = reviewReducer(s, { type: 'closeSubmit' });
    expect(s.ui.submitOpen).toBe(false);
  });

  it('submitted stores the output and closes the popover; submitFailed stores the error', () => {
    const open = reviewReducer(stateWith(), { type: 'openSubmit' });
    const done = reviewReducer(open, { type: 'submitted', output: 'out' });
    expect(done.ui.submitted).toEqual({ output: 'out' });
    expect(done.ui.submitOpen).toBe(false);
    const failed = reviewReducer(open, { type: 'submitFailed', error: 'boom' });
    expect(failed.ui.submitError).toBe('boom');
    expect(failed.ui.submitOpen).toBe(false);
  });

  it('reload replaces document, items, warnings and review but keeps ui', () => {
    const state = reviewReducer(stateWith(), { type: 'setFilter', filter: 'all' });
    const loaded = mockLoaded({ items: [], warnings: ['w'] });
    const next = reviewReducer(state, {
      type: 'reload',
      loaded: { ...loaded, review: { ...loaded.review, round: 3 } },
    });
    expect(next.items).toEqual([]);
    expect(next.warnings).toEqual(['w']);
    expect(next.review.round).toBe(3);
    expect(next.ui.filter).toBe('all');
    expect(next.ui.tab).toBe('comments');
  });
});

describe('isProgressAction', () => {
  it('is true exactly for actions that change answers or threads', () => {
    const progress: ReviewAction['type'][] = ['answer', 'defer', 'clearAnswer', 'addThread', 'reply', 'resolve', 'reopen'];
    const ui: ReviewAction['type'][] = [
      'startCompose', 'cancelCompose', 'focus', 'setTab', 'setFilter', 'toggleTheme',
      'openSubmit', 'closeSubmit', 'submitted', 'submitFailed', 'reload',
    ];
    for (const type of progress) expect(isProgressAction({ type } as ReviewAction)).toBe(true);
    for (const type of ui) expect(isProgressAction({ type } as ReviewAction)).toBe(false);
  });
});
