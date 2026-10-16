// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent } from '@testing-library/preact';
import type { LoadedReview, ReviewItem, Section, Thread } from '@plan-review/core';
import { SectionView } from '../src/components/SectionView.js';
import { CommentsList } from '../src/components/CommentsList.js';
import * as highlight from '../src/highlight.js';
import {
  answer, assumptionItem, decisionItem, lineAnchor, mockLoaded, mockPlanDoc, renderWithReview, thread,
} from './test-utils.js';

const PARA_1 = 'We need to settle how token refresh retries back off when the auth server degrades.';
const PARA_2 = 'Every browser exposes **SubtleCrypto** for challenges.';

const body = [
  PARA_1,
  '',
  '```decision id=retry-backoff',
  'question: How should retries back off?',
  '```',
  '',
  PARA_2,
  '',
  '```assumption id=auth-latency',
  'statement: x',
  '```',
].join('\n');

const section: Section = { id: '1.1', heading: 'Task 1', level: 3, body, parent: 'milestone-1' };

const decision: ReviewItem = { ...decisionItem, sectionId: '1.1', quote: 'how token refresh retries back off' };
const assumption: ReviewItem = { ...assumptionItem, sectionId: '1.1' };

function loaded(items: ReviewItem[], patch: Partial<LoadedReview['review']> = {}, sectionBody = body): LoadedReview {
  const base = mockLoaded();
  return {
    ...base,
    document: { ...mockPlanDoc, sections: [{ ...section, body: sectionBody }] },
    items,
    review: { ...base.review, ...patch },
  };
}

function renderSection(items: ReviewItem[] = [decision, assumption], patch: Partial<LoadedReview['review']> = {}, sectionBody = body) {
  return renderWithReview(<SectionView section={{ ...section, body: sectionBody }} num="1.1" />, loaded(items, patch, sectionBody));
}

describe('SectionView', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('caches highlights across composer typing and refreshes them for answers, focus and threads', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const quote = vi.spyOn(highlight, 'markQuote');
    const all = vi.spyOn(highlight, 'markAll');
    const anchored = thread('cached', section.id, lineAnchor(0, [PARA_1]));
    const { container, review } = renderWithReview(
      <><SectionView section={section} num="1.1" /><CommentsList /></>, loaded([decision, assumption], { threads: [anchored] }),
    );
    expect(quote).toHaveBeenCalled();
    expect(all).toHaveBeenCalled();
    const counts = () => [quote.mock.calls.length, all.mock.calls.length];
    const initial = counts();
    fireEvent.click(container.querySelector('.para-add')!);
    expect(container.querySelector('.is-pending')).not.toBeNull();
    const textarea = container.querySelector('.composer textarea')!;
    for (const value of ['Draft', 'Draft with more text']) fireEvent.input(textarea, { target: { value } });
    expect(review.current.state.ui.composing!.body).toBe('Draft with more text');
    expect(counts()).toEqual(initial);

    act(() => review.current.dispatch({ type: 'answer', itemId: decision.id, choice: 'A', note: '' }));
    expect(quote.mock.calls.length).toBeGreaterThan(initial[0]);
    expect(container.querySelector('#mk-retry-backoff')!.classList.contains('is-done')).toBe(true);
    const answered = counts();
    act(() => review.current.dispatch({ type: 'focus', target: { kind: 'thread', id: anchored.id } }));
    expect(all.mock.calls.length).toBeGreaterThan(answered[1]);
    expect(container.querySelector('#hl-cached')!.classList.contains('is-focus')).toBe(true);
    const focused = counts();
    act(() => review.current.dispatch({ type: 'reply', threadId: anchored.id, body: 'Another comment' }));
    expect(quote.mock.calls.length).toBeGreaterThan(focused[0]);
    expect(all.mock.calls.length).toBeGreaterThan(focused[1]);
    act(() => review.current.dispatch({ type: 'resolve', threadId: anchored.id }));
    expect(container.querySelector('#hl-cached')).toBeNull();
  });

  it('renders the section heading with its number', () => {
    const { container } = renderSection();
    const heading = container.querySelector('#sec-1\\.1')!;
    expect(heading.textContent).toBe('1.1Task 1');
    expect(heading.querySelector('.h2-num')!.textContent).toBe('1.1');
  });

  it('renders level-2 sections as h2 and deeper ones as h3', () => {
    const milestone: Section = { id: 'milestone-1', heading: 'Milestone 1', level: 2, body: 'Setup' };
    const { container } = renderWithReview(<><SectionView section={milestone} num="01" /><SectionView section={section} num="1.1" /></>, loaded([]));
    expect(container.querySelector('h2#sec-milestone-1')).toBeTruthy();
    expect(container.querySelector('h3#sec-1\\.1')).toBeTruthy();
  });

  describe('quote highlights', () => {
    it('wraps the first occurrence of the quote in a highlight with the item id', () => {
      const { container } = renderSection();
      const q = container.querySelector('#mk-retry-backoff')!;
      expect(q.matches('.q.q-decision.is-open')).toBe(true);
      expect(q.closest('.para')!.textContent).toContain(PARA_1.slice(0, 20));
      expect(q.textContent).toBe('how token refresh retries back off?');
    });

    it.each([
      ['open decision', decision, undefined, 'is-open', '?'],
      ['open assumption', { ...assumption, quote: 'SubtleCrypto' }, undefined, 'is-open', 'A'],
      ['done decision', decision, 'A', 'is-done', '✓'],
      ['holding assumption', { ...assumption, quote: 'SubtleCrypto' }, 'holds', 'is-done', '✓'],
      ['deferred item', decision, 'deferred', 'is-deferred', '–'],
    ])('marks an %s with its state class and badge', (_name, item, choice, cls, badge) => {
      const answers = choice ? { [item.id]: answer(item, choice) } : {};
      const { container } = renderSection([item], { answers });
      const marks = container.querySelectorAll(`[data-item="${item.id}"]`);
      expect(marks[0].classList.contains(cls)).toBe(true);
      expect(marks[marks.length - 1].querySelector('.q-badge')!.textContent).toBe(badge);
    });

    it('treats a changed item like an open one', () => {
      const answers = { [decision.id]: answer(decision, 'A', 'old-hash') };
      const { container } = renderSection([decision], { answers });
      expect(container.querySelector('#mk-retry-backoff .q-badge')!.textContent).toBe('?');
    });

    it('highlights a quote that spans inline formatting', () => {
      const item = { ...assumption, quote: 'exposes SubtleCrypto for' };
      const { container } = renderSection([item]);
      const marks = container.querySelectorAll('[data-item="auth-latency"]');
      expect(Array.from(marks, (m) => m.textContent).join('')).toBe('exposes SubtleCrypto forA');
      expect(container.querySelector('#mk-auth-latency')!.textContent).toBe('exposes ');
    });

    it('hides the item marker block once the quote is highlighted', () => {
      const { container } = renderSection([decision]);
      expect(container.querySelectorAll('#mk-retry-backoff')).toHaveLength(1);
      expect(container.querySelector('.mk-chip')).toBeNull();
    });

    it('uses the nearest preceding paragraph that contains the quote', () => {
      const md = ['Retry soon.', '', 'Then retry later.', '', '```decision id=retry-backoff', '```', '', 'After: retry.'].join('\n');
      const { container } = renderSection([{ ...decision, quote: 'retry' }], {}, md);
      expect(container.querySelector('#mk-retry-backoff')!.closest('.para')!.textContent).toBe('Then retry? later.');
    });

    it('matches the quote case-sensitively and falls back to a chip', () => {
      const { container } = renderSection([{ ...decision, quote: 'How Token Refresh' }]);
      expect(container.querySelector('.q:not(.mk-chip)')).toBeNull();
      expect(container.querySelector('.mk-chip#mk-retry-backoff')).toBeTruthy();
    });

    it('renders a marker chip at the item position when there is no quote', () => {
      const { container } = renderSection([decision, assumption]);
      const chip = container.querySelector('#mk-auth-latency')!;
      expect(chip.matches('.mk-chip.q-assumption.is-open')).toBe(true);
      expect(chip.textContent).toBe('Auth server latencyA');
      const paras = Array.from(container.querySelectorAll('.para, .mk-row'));
      expect(paras.map((p) => p.classList.contains('mk-row'))).toEqual([false, false, true]);
    });

    it('renders a later fence repeating an item id as a visible code block', () => {
      const repeated = `${body}\n\n\`\`\`assumption id=auth-latency\nstatement: repeated\n\`\`\``;
      const { container } = renderSection([decision, assumption], {}, repeated);
      expect(container.querySelectorAll('#mk-auth-latency')).toHaveLength(1);
      expect(container.querySelector('pre code')!.textContent).toBe('statement: repeated');
    });

    it('outlines the focused item', () => {
      const { container, review } = renderSection();
      fireEvent.click(container.querySelector('#mk-auth-latency')!);
      expect(container.querySelector('#mk-auth-latency')!.classList.contains('is-focus')).toBe(true);
      expect(review.current.state.ui.focus).toEqual({ kind: 'item', id: 'auth-latency' });
    });

    it('focuses the item and switches to the Decisions tab when a highlight is clicked', () => {
      const { container, review } = renderSection();
      review.current.dispatch({ type: 'setTab', tab: 'comments' });
      fireEvent.click(container.querySelector('#mk-retry-backoff')!);
      expect(review.current.state.ui.focus).toEqual({ kind: 'item', id: 'retry-backoff' });
      expect(review.current.state.ui.tab).toBe('decisions');
    });
  });

  describe('thread highlights', () => {
    const anchored = (patch: Partial<Thread> = {}) => thread('t1', '1.1', lineAnchor(0, [PARA_2.replace(/\*/g, '')]), patch);

    it('highlights the anchored block of an open thread in amber', () => {
      const { container } = renderSection([], { threads: [anchored()] });
      const hl = container.querySelector('#hl-t1')!;
      expect(hl.matches('.hl')).toBe(true);
      expect(hl.closest('.para')!.textContent).toContain('SubtleCrypto');
    });

    it.each([
      ['resolved', { resolved: true }],
      ['outdated', { outdated: true }],
    ])('does not highlight a %s thread', (_name, patch) => {
      const { container } = renderSection([], { threads: [anchored(patch)] });
      expect(container.querySelector('.hl')).toBeNull();
    });

    it('puts the scroll-target id only on the first block of a multi-block highlight', () => {
      const t = thread('t1', '1.1', lineAnchor(0, ['Alpha line.', 'Beta line.']));
      const { container } = renderSection([], { threads: [t] }, 'Alpha line.\n\nBeta line.');
      expect(container.querySelectorAll('.hl')).toHaveLength(2);
      expect(container.querySelectorAll('[id="hl-t1"]')).toHaveLength(1);
      expect(container.querySelector('#hl-t1')!.textContent).toBe('Alpha line.');
    });

    it('does not fall back to the stored line range when the anchored text is gone', () => {
      const t = thread('t1', '1.1', lineAnchor(0, ['Removed line.']));
      const { container } = renderSection([], { threads: [t] }, 'Alpha line.\n\nBeta line.');
      expect(container.querySelector('.hl')).toBeNull();
    });

    it('does not highlight a section-level thread', () => {
      const { container } = renderSection([], { threads: [thread('t1', '1.1', null)] });
      expect(container.querySelector('.hl')).toBeNull();
    });

    it('focuses the thread and switches to the Comments tab when clicked', () => {
      const { container, review } = renderSection([], { threads: [anchored()] });
      fireEvent.click(container.querySelector('#hl-t1')!);
      expect(review.current.state.ui.focus).toEqual({ kind: 'thread', id: 't1' });
      expect(review.current.state.ui.tab).toBe('comments');
      expect(container.querySelector('#hl-t1')!.classList.contains('is-focus')).toBe(true);
    });
  });

  describe('composing', () => {
    it('starts composing on a block when its + is clicked', () => {
      const { container, review } = renderSection([]);
      const add = container.querySelectorAll<HTMLButtonElement>('.para-add');
      fireEvent.click(add[0]);
      expect(review.current.state.ui.composing).toEqual({ sectionId: '1.1', anchor: lineAnchor(0, [PARA_1]), body: '' });
      expect(review.current.state.ui.tab).toBe('comments');
      expect(container.querySelectorAll('.para.is-pending')).toHaveLength(1);
    });

    it('extends the range with shift-click', () => {
      const { container, review } = renderSection([]);
      const add = container.querySelectorAll<HTMLButtonElement>('.para-add');
      fireEvent.click(add[2]);
      fireEvent.click(add[0], { shiftKey: true });
      const anchor = review.current.state.ui.composing!.anchor!;
      expect(anchor.startLine).toBe(0);
      expect(anchor.endLine).toBe(2);
      expect(anchor.lineTexts).toHaveLength(3);
      expect(container.querySelectorAll('.para.is-pending')).toHaveLength(3);
    });
  });
});
