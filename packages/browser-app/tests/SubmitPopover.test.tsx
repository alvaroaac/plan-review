// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { Answer, LoadedReview, ReviewItem, SubmitRequest } from '@plan-review/core';
import { FakeReviewClient, type ReviewClient } from '@plan-review/core/client';
import { SubmitPopover } from '../src/components/SubmitPopover.js';
import { Toast } from '../src/components/Toast.js';
import { answer, assumptionItem, decisionItem, mockLoaded, renderWithReview } from './test-utils.js';

const thirdItem: ReviewItem = {
  id: 'cookie-scope',
  kind: 'decision',
  label: 'Refresh cookie scope',
  question: 'Where does the refresh cookie live?',
  options: [{ key: 'A', text: 'Path-scoped', pick: true }],
  sectionId: '1.2',
  hash: 'h-cookie',
};

function loadedWith(answers: Record<string, Answer>, items: ReviewItem[] = [decisionItem, assumptionItem, thirdItem]): LoadedReview {
  const base = mockLoaded();
  return { ...base, items, review: { ...base.review, answers } };
}

function renderPopover(loaded: LoadedReview = loadedWith({}), client: ReviewClient = new FakeReviewClient({ loaded })) {
  const utils = renderWithReview(<SubmitPopover />, loaded, client);
  act(() => utils.review.current.dispatch({ type: 'openSubmit' }));
  return { ...utils, client };
}

const button = (name: string) => screen.getByRole('button', { name });
const gateRows = (container: Element) =>
  Array.from(container.querySelectorAll('.gate-list .srow')).map((r) => r.querySelector('.t')!.textContent);

describe('SubmitPopover', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows a summary field and both verdict buttons, enabled even with open items (soft gate)', () => {
    const { container } = renderPopover();
    expect(container.querySelector('textarea.field')).toBeTruthy();
    expect((button('Request changes') as HTMLButtonElement).disabled).toBe(false);
    expect((button('Approve') as HTMLButtonElement).disabled).toBe(false);
  });

  it('lists open, changed and deferred items in document order, but not answered ones', () => {
    const { container } = renderPopover(loadedWith({
      'retry-backoff': answer(decisionItem, 'A', 'stale-hash'),
      'auth-latency': answer(assumptionItem, 'deferred'),
      'cookie-scope': answer(thirdItem, 'A'),
    }));
    expect(gateRows(container)).toEqual(['Retry backoff', 'Auth server latency']);
    const summaries = Array.from(container.querySelectorAll('.gate-list .srow .s')).map((s) => s.textContent);
    expect(summaries).toEqual(['changed since you answered', 'Deferred']);
  });

  it('says how many items are unanswered when open items exist', () => {
    const { container } = renderPopover(loadedWith({
      'retry-backoff': answer(decisionItem, 'A', 'stale-hash'),
      'auth-latency': answer(assumptionItem, 'deferred'),
    }));
    expect(container.querySelector('.gate-h')!.textContent).toBe('2 unanswered · 1 deferred');
  });

  it('labels the list with the deferred count only when nothing is unanswered', () => {
    const { container } = renderPopover(loadedWith({
      'retry-backoff': answer(decisionItem, 'A'),
      'auth-latency': answer(assumptionItem, 'deferred'),
      'cookie-scope': answer(thirdItem, 'A'),
    }));
    expect(container.querySelector('.gate-h')!.textContent).toBe('1 deferred');
  });

  it('shows "All answered" and no list when every item is answered', () => {
    const { container } = renderPopover(loadedWith({
      'retry-backoff': answer(decisionItem, 'A'),
      'auth-latency': answer(assumptionItem, 'holds'),
      'cookie-scope': answer(thirdItem, 'A'),
    }));
    expect(container.querySelector('.gate-list')).toBeNull();
    expect(container.querySelector('.gate-h')!.textContent).toBe('All answered');
  });

  it('shows no item gate for a plan without items', () => {
    const { container } = renderPopover(loadedWith({}, []));
    expect(container.querySelector('.gate-h')).toBeNull();
    expect(container.querySelector('.gate-list')).toBeNull();
  });

  it('clicking a listed item focuses it on the Decisions tab, scrolls the doc to it and closes the popover', () => {
    const doc = document.createElement('div');
    doc.innerHTML = '<div class="main"><div class="scroll"><span id="mk-auth-latency"></span></div></div>';
    document.body.appendChild(doc);
    const scroller = doc.querySelector<HTMLElement>('.scroll')!;
    scroller.scrollTo = vi.fn() as unknown as typeof scroller.scrollTo;

    const { container, review } = renderPopover();
    act(() => review.current.dispatch({ type: 'setTab', tab: 'comments' }));
    act(() => review.current.dispatch({ type: 'openSubmit' }));
    fireEvent.click(container.querySelectorAll('.gate-list .srow')[1]);

    expect(review.current.state.ui.focus).toEqual({ kind: 'item', id: 'auth-latency' });
    expect(review.current.state.ui.tab).toBe('decisions');
    expect(review.current.state.ui.submitOpen).toBe(false);
    expect(scroller.scrollTo).toHaveBeenCalled();
    doc.remove();
  });

  it('Escape closes the popover', () => {
    const { review } = renderPopover();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(review.current.state.ui.submitOpen).toBe(false);
  });

  describe('summary', () => {
    const summary = () => document.querySelector<HTMLTextAreaElement>('.submit-pop textarea')!;

    it('survives closing and reopening the popover', () => {
      const { review } = renderPopover();
      fireEvent.input(summary(), { target: { value: 'Half-written thought' } });
      act(() => review.current.dispatch({ type: 'closeSubmit' }));
      expect(document.querySelector('.submit-pop')).toBeNull();
      act(() => review.current.dispatch({ type: 'openSubmit' }));
      expect(summary().value).toBe('Half-written thought');
    });

    it('survives a jump to a gate item', () => {
      const { container, review } = renderPopover();
      fireEvent.input(summary(), { target: { value: 'Before the jump' } });
      fireEvent.click(container.querySelectorAll('.gate-list .srow')[0]);
      expect(review.current.state.ui.submitOpen).toBe(false);
      act(() => review.current.dispatch({ type: 'openSubmit' }));
      expect(summary().value).toBe('Before the jump');
    });
  });

  describe('focus management', () => {
    const trigger = () => button('Submit review');

    it('is a labelled dialog that focuses the summary when it opens', () => {
      renderPopover();
      const dialog = screen.getByRole('dialog', { name: 'Submit review' });
      expect(document.activeElement).toBe(dialog.querySelector('textarea'));
    });

    it('returns focus to the trigger when it closes', async () => {
      renderPopover();
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(document.activeElement).toBe(trigger()));
    });

    it('traps Tab and Shift+Tab inside the dialog', () => {
      renderPopover();
      const dialog = screen.getByRole('dialog', { name: 'Submit review' });
      const first = dialog.querySelector('textarea')!;
      const last = button('Approve');
      last.focus();
      fireEvent.keyDown(last, { key: 'Tab' });
      expect(document.activeElement).toBe(first);
      fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(last);
    });
  });

  describe('submitting', () => {
    it('flushes the pending autosave before submitting, then shows the submitted state', async () => {
      const calls: string[] = [];
      const loaded = loadedWith({});
      const client: ReviewClient = {
        loadDocument: async () => loaded,
        saveProgress: async () => { calls.push('save'); },
        submitReview: async (req: SubmitRequest) => { calls.push(`submit:${req.verdict}:${req.summary}`); return { ok: true, output: 'out' }; },
      };
      const { container, review } = renderPopover(loaded, client);
      act(() => review.current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
      fireEvent.input(container.querySelector('textarea.field')!, { target: { value: 'Looks good' } });
      fireEvent.click(button('Approve'));

      await waitFor(() => expect(review.current.state.ui.submitted).toEqual({ output: 'out' }));
      expect(calls).toEqual(['save', 'submit:approved:Looks good']);
    });

    it('Request changes submits the changes_requested verdict', async () => {
      const { client } = renderPopover();
      fireEvent.click(button('Request changes'));
      await waitFor(() => expect((client as FakeReviewClient).submits).toHaveLength(1));
      expect((client as FakeReviewClient).submits[0]).toEqual({ verdict: 'changes_requested', summary: '' });
    });

    it('disables both buttons while the submit is in flight', async () => {
      const loaded = loadedWith({});
      const client: ReviewClient = {
        loadDocument: async () => loaded,
        saveProgress: async () => {},
        submitReview: () => new Promise(() => {}),
      };
      renderPopover(loaded, client);
      fireEvent.click(button('Approve'));
      await waitFor(() => expect((button('Approve') as HTMLButtonElement).disabled).toBe(true));
      expect((button('Request changes') as HTMLButtonElement).disabled).toBe(true);
    });

    it('records the error and the request when the submit fails', async () => {
      const loaded = loadedWith({});
      const client: ReviewClient = {
        loadDocument: async () => loaded,
        saveProgress: async () => {},
        submitReview: () => Promise.reject(new Error('Submit cancelled — no destination chosen.')),
      };
      const { container, review } = renderPopover(loaded, client);
      fireEvent.input(container.querySelector('textarea.field')!, { target: { value: 'Fix the retries' } });
      fireEvent.click(button('Request changes'));
      await waitFor(() => expect(review.current.state.ui.submitError).toEqual({
        message: 'Submit cancelled — no destination chosen.',
        request: { verdict: 'changes_requested', summary: 'Fix the retries' },
      }));
    });

    it('fails without submitting when the pending autosave cannot be saved', async () => {
      const loaded = loadedWith({});
      const client = new FakeReviewClient({ loaded });
      client.saveProgress = () => Promise.reject(new Error('offline'));
      const { review } = renderPopover(loaded, client);
      act(() => review.current.dispatch({ type: 'answer', itemId: 'retry-backoff', choice: 'A', note: '' }));
      fireEvent.click(button('Approve'));
      await waitFor(() => expect(review.current.state.ui.submitError?.message).toBe('offline'));
      expect(client.submits).toHaveLength(0);
    });
  });
});

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the message and hides itself after 3.2 s', () => {
    const { container } = render(<Toast message="Review sent · 2 answered" />);
    expect(container.querySelector('.toast')!.textContent).toBe('Review sent · 2 answered');
    act(() => { vi.advanceTimersByTime(3199); });
    expect(container.querySelector('.toast')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1); });
    expect(container.querySelector('.toast')).toBeNull();
  });
});
