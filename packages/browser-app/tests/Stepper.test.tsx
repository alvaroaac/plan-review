// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/preact';
import type { Answer, ReviewItem } from '@plan-review/core';
import { Stepper } from '../src/components/Stepper.js';
import { answer, assumptionItem, decisionItem, mockLoaded, renderWithReview } from './test-utils.js';

const cookieItem: ReviewItem = { ...decisionItem, id: 'cookie-scope', label: 'Cookie scope', sectionId: '1.2', hash: 'h-cookie' };
const items = [decisionItem, assumptionItem, cookieItem];

function renderStepper(answers: Record<string, Answer> = {}) {
  const base = mockLoaded();
  return renderWithReview(<Stepper />, { ...base, items, review: { ...base.review, answers } });
}

const segs = (container: Element) => Array.from(container.querySelectorAll<HTMLButtonElement>('.seg'));

describe('Stepper', () => {
  it('renders one segment per item in doc order with kind and state classes', () => {
    const { container } = renderStepper({
      'auth-latency': answer(assumptionItem, 'holds'),
      'cookie-scope': answer(cookieItem, 'deferred'),
    });
    expect(segs(container).map((s) => s.title)).toEqual(['Retry backoff', 'Auth server latency', 'Cookie scope']);
    expect(segs(container).map((s) => s.className)).toEqual([
      'seg k-decision open',
      'seg k-assumption done',
      'seg k-decision deferred',
    ]);
  });

  it('marks a changed item with the changed state', () => {
    const { container } = renderStepper({ 'retry-backoff': answer(decisionItem, 'A', 'old-hash') });
    expect(segs(container)[0].classList.contains('changed')).toBe(true);
  });

  it('outlines the focused segment', () => {
    const { container, review } = renderStepper();
    fireEvent.click(segs(container)[1]);
    expect(review.current.state.ui.focus).toEqual({ kind: 'item', id: 'auth-latency' });
    expect(review.current.state.ui.tab).toBe('decisions');
    expect(segs(container).map((s) => s.classList.contains('on'))).toEqual([false, true, false]);
  });

  it('shows how many items are answered and deferred', () => {
    const { container } = renderStepper({
      'auth-latency': answer(assumptionItem, 'holds'),
      'cookie-scope': answer(cookieItem, 'deferred'),
    });
    expect(container.querySelector('.st-lab')!.textContent).toBe('1 of 3 answered · 1 deferred');
  });

  it('leaves out the deferred count when nothing is deferred', () => {
    const { container } = renderStepper();
    expect(container.querySelector('.st-lab')!.textContent).toBe('0 of 3 answered');
  });

  it('Next open jumps to the first open item when nothing is focused', () => {
    const { review } = renderStepper({ 'retry-backoff': answer(decisionItem, 'A') });
    fireEvent.click(screen.getByRole('button', { name: 'Next open' }));
    expect(review.current.state.ui.focus).toEqual({ kind: 'item', id: 'auth-latency' });
  });

  it('Next open jumps to the next open or changed item after the focused one', () => {
    const { container, review } = renderStepper({
      'auth-latency': answer(assumptionItem, 'holds'),
      'cookie-scope': answer(cookieItem, 'A', 'old-hash'),
    });
    fireEvent.click(segs(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Next open' }));
    expect(review.current.state.ui.focus).toEqual({ kind: 'item', id: 'cookie-scope' });
  });

  it('Next open wraps around to the start', () => {
    const { container, review } = renderStepper();
    fireEvent.click(segs(container)[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Next open' }));
    expect(review.current.state.ui.focus).toEqual({ kind: 'item', id: 'retry-backoff' });
  });

  it('shows All answered instead of Next open when every item is answered or deferred', () => {
    const { container } = renderStepper({
      'retry-backoff': answer(decisionItem, 'A'),
      'auth-latency': answer(assumptionItem, 'holds'),
      'cookie-scope': answer(cookieItem, 'deferred'),
    });
    expect(screen.queryByRole('button', { name: 'Next open' })).toBeNull();
    expect(container.querySelector('.idx-all')!.textContent).toBe('All answered');
  });
});
