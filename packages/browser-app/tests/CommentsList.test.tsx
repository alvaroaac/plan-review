// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/preact';
import type { LineAnchor, Thread } from '@plan-review/core';
import { CommentsList } from '../src/components/CommentsList.js';
import type { ReviewAction } from '../src/state/reducer.js';
import { lineAnchor, mockLoaded, renderWithReview, thread } from './test-utils.js';

const body = (t: Thread, text: string): Thread => ({ ...t, comments: [{ ...t.comments[0], body: text }] });

const open12 = body(thread('t-open-12', '1.2', lineAnchor(0, ['Second task content'])), 'open in 1.2');
const open11 = body(thread('t-open-11', '1.1', lineAnchor(0, ['Bold and code'])), 'open in 1.1');
const resolved = body(thread('t-resolved', '1.1', null, { resolved: true }), 'resolved');
const outdated = body(
  thread('t-outdated', '1.2', lineAnchor(3, ['A paragraph that was rewritten']), { outdated: true }),
  'outdated',
);
const outdatedResolved = body(thread('t-outdated-r', 'gone', null, { outdated: true, resolved: true }), 'outdated resolved');

function renderList(threads: Thread[] = [open12, open11, resolved, outdated]) {
  const base = mockLoaded();
  return renderWithReview(<CommentsList />, { ...base, review: { ...base.review, threads } });
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const chip = (name: string) => screen.getByRole('button', { name });
// The list as read top to bottom: group headers as "# Title n", threads by their first comment.
const listed = (container: Element) =>
  Array.from(container.querySelectorAll('.rail-list > .group-h, .rail-list > .thread, .rail-list > .composer, .rail-list > .empty'), (el) => {
    if (el.classList.contains('group-h')) return `# ${el.firstElementChild!.textContent} ${el.lastElementChild!.textContent}`;
    if (el.classList.contains('composer')) return 'composer';
    if (el.classList.contains('empty')) return el.textContent;
    return el.querySelector('.cmt p')!.textContent;
  });

function startCompose(dispatch: (a: ReviewAction) => void, anchor: LineAnchor | null = lineAnchor(0, ['Bold and code'])) {
  dispatch({ type: 'startCompose', sectionId: '1.1', anchor });
}

describe('CommentsList', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  describe('filters', () => {
    it('offers Open / Resolved / All chips with Open selected', () => {
      const { container } = renderList();
      const chips = Array.from(container.querySelectorAll('.chips .chip'));
      expect(chips.map((c) => c.textContent)).toEqual(['Open', 'Resolved', 'All']);
      expect(chips.map((c) => c.classList.contains('on'))).toEqual([true, false, false]);
      expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    });

    it('lists open threads in document order by default', () => {
      const { container } = renderList();
      expect(listed(container)).toEqual(['open in 1.1', 'open in 1.2', '# Outdated 1', 'outdated']);
    });

    it('shows only resolved threads under Resolved', () => {
      const { container, review } = renderList();
      fireEvent.click(chip('Resolved'));
      expect(review.current.state.ui.filter).toBe('resolved');
      expect(listed(container)).toEqual(['resolved', '# Outdated 1', 'outdated']);
    });

    it('shows every thread under All, section-level threads first within a section', () => {
      const { container } = renderList();
      fireEvent.click(chip('All'));
      expect(listed(container)).toEqual(['resolved', 'open in 1.1', 'open in 1.2', '# Outdated 1', 'outdated']);
    });

    it('says "Nothing here." when the filter matches no thread', () => {
      const { container } = renderList([open11]);
      fireEvent.click(chip('Resolved'));
      expect(listed(container)).toEqual(['Nothing here.']);
    });
  });

  describe('outdated group', () => {
    it('always lists outdated threads at the bottom, resolved or not, under every filter', () => {
      const { container } = renderList([outdated, open11, outdatedResolved]);
      for (const filter of ['Open', 'Resolved', 'All']) {
        fireEvent.click(chip(filter));
        expect(listed(container).slice(-3)).toEqual(['# Outdated 2', 'outdated', 'outdated resolved']);
      }
    });

    it('shows the last anchor text and marks the cards outdated', () => {
      const { container } = renderList([outdated]);
      const card = container.querySelector('.thread')!;
      expect(card.classList.contains('is-outdated')).toBe(true);
      expect(card.querySelector('.th-quote')!.textContent).toBe('A paragraph that was rewritten');
    });

    it('is hidden when no thread is outdated', () => {
      const { container } = renderList([open11]);
      expect(container.querySelector('.group-h')).toBeNull();
    });
  });

  it('labels thread cards with their section number and heading', () => {
    const { container } = renderList([open11]);
    expect(container.querySelector('.thread .loc')!.textContent).toBe('§ 1.1 Task 1');
  });

  describe('composer', () => {
    it('appears at the top while composing, with the section and the quoted block text', () => {
      const { container, review } = renderList();
      expect(container.querySelector('.composer')).toBeNull();
      startCompose(review.current.dispatch);
      return vi.waitFor(() => {
        expect(listed(container)[0]).toBe('composer');
        const composer = container.querySelector('.composer')!;
        expect(composer.querySelector('.lbl')!.textContent).toBe('New comment · § 1.1 Task 1');
        expect(composer.querySelector('.th-quote')!.textContent).toBe('Bold and code');
        expect(document.activeElement).toBe(composer.querySelector('textarea'));
      });
    });

    it('has no quote for a whole-section comment', async () => {
      const { container, review } = renderList([]);
      startCompose(review.current.dispatch, null);
      await vi.waitFor(() => expect(container.querySelector('.composer')).not.toBeNull());
      expect(container.querySelector('.composer .th-quote')).toBeNull();
    });

    it('hides the empty state while composing', async () => {
      const { container, review } = renderList([]);
      expect(listed(container)).toEqual(['Nothing here.']);
      startCompose(review.current.dispatch);
      await vi.waitFor(() => expect(listed(container)).toEqual(['composer']));
    });

    it('cannot post an empty body; posts a trimmed body as a new thread', async () => {
      const { container, review } = renderList([]);
      startCompose(review.current.dispatch);
      await vi.waitFor(() => expect(container.querySelector('.composer')).not.toBeNull());
      const textarea = container.querySelector('.composer textarea')!;
      expect(button('Comment')).toHaveProperty('disabled', true);
      fireEvent.input(textarea, { target: { value: '   ' } });
      expect(button('Comment')).toHaveProperty('disabled', true);
      fireEvent.input(textarea, { target: { value: '  Why bold?  ' } });
      fireEvent.click(button('Comment'));

      const [created] = review.current.state.review.threads;
      expect(created).toMatchObject({ sectionId: '1.1', anchor: lineAnchor(0, ['Bold and code']) });
      expect(created.comments[0]).toMatchObject({ author: 'reviewer', body: 'Why bold?' });
      expect(review.current.state.ui.composing).toBeNull();
      expect(listed(container)).toEqual(['Why bold?']);
    });

    it('Cancel stops composing', async () => {
      const { container, review } = renderList();
      startCompose(review.current.dispatch);
      await vi.waitFor(() => expect(container.querySelector('.composer')).not.toBeNull());
      fireEvent.click(button('Cancel'));
      expect(review.current.state.ui.composing).toBeNull();
      expect(container.querySelector('.composer')).toBeNull();
    });

    it('Esc stops composing', async () => {
      const { container, review } = renderList();
      startCompose(review.current.dispatch);
      await vi.waitFor(() => expect(container.querySelector('.composer')).not.toBeNull());
      fireEvent.keyDown(container.querySelector('.composer textarea')!, { key: 'Escape' });
      expect(review.current.state.ui.composing).toBeNull();
    });
  });
});
