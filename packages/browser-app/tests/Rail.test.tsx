// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/preact';
import type { Answer, ReviewItem, Thread } from '@plan-review/core';
import { Rail } from '../src/components/Rail.js';
import { answer, assumptionItem, decisionItem, mockLoaded, renderWithReview, thread } from './test-utils.js';

const cookieItem: ReviewItem = { ...decisionItem, id: 'cookie-scope', label: 'Cookie scope', sectionId: '1.2', hash: 'h-cookie' };
const legacyItem: ReviewItem = { ...decisionItem, id: 'legacy-window', label: 'Legacy window', sectionId: '1.2', hash: 'h-legacy' };
const items = [decisionItem, assumptionItem, cookieItem, legacyItem];

function renderRail(answers: Record<string, Answer> = {}, threads: Thread[] = [], railItems = items) {
  const base = mockLoaded();
  return renderWithReview(<Rail />, { ...base, items: railItems, review: { ...base.review, answers, threads } });
}

const tab = (name: RegExp) => screen.getByRole('tab', { name });
const groups = (container: Element) =>
  Array.from(container.querySelectorAll('.rail-list > .group-h, .rail-list > .item-card')).map((el) =>
    el.classList.contains('group-h') ? `# ${el.firstElementChild!.textContent} ${el.lastElementChild!.textContent}` : el.querySelector('.ic-label')!.textContent,
  );

describe('Rail', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('badges Decisions with open + changed items and Comments with open, non-outdated threads', () => {
    const { container } = renderRail(
      {
        'retry-backoff': answer(decisionItem, 'A', 'old-hash'), // changed
        'auth-latency': answer(assumptionItem, 'holds'),
        'cookie-scope': answer(cookieItem, 'deferred'),
      },
      [
        thread('t1', '1.1', null),
        thread('t2', '1.1', null, { resolved: true }),
        thread('t3', '1.2', null),
        thread('t4', '1.2', null, { outdated: true }),
      ],
    );
    const [decisions, comments] = Array.from(container.querySelectorAll('.tab'));
    expect(decisions.textContent).toBe('Decisions 2');
    expect(decisions.querySelector('.ct')!.classList.contains('hot')).toBe(true);
    expect(comments.textContent).toBe('Comments 2');
    expect(comments.querySelector('.ct')!.classList.contains('hot')).toBe(false);
  });

  it('does not highlight the Decisions badge when nothing is open', () => {
    const { container } = renderRail({ 'retry-backoff': answer(decisionItem, 'A') }, [], [decisionItem]);
    const badge = container.querySelector('.tab .ct')!;
    expect(badge.textContent).toBe('0');
    expect(badge.classList.contains('hot')).toBe(false);
  });

  it('has no Decisions tab when the plan has no items', () => {
    renderRail({}, [], []);
    expect(screen.queryByRole('tab', { name: /Decisions/ })).toBeNull();
    expect(tab(/Comments/).getAttribute('aria-selected')).toBe('true');
  });

  it('switches between the Decisions and Comments tabs', () => {
    const { container, review } = renderRail();
    expect(tab(/Decisions/).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tab(/Comments/));
    expect(review.current.state.ui.tab).toBe('comments');
    expect(container.querySelector('.item-card')).toBeNull();
    fireEvent.click(tab(/Decisions/));
    expect(container.querySelectorAll('.item-card')).toHaveLength(4);
  });

  it('groups items into Needs your answer (incl. changed), Deferred and Answered, in doc order', () => {
    const { container } = renderRail({
      'retry-backoff': answer(decisionItem, 'A'),
      'auth-latency': answer(assumptionItem, 'deferred'),
      'legacy-window': answer(legacyItem, 'B', 'old-hash'),
    });
    expect(groups(container)).toEqual([
      '# Needs your answer 2', 'Cookie scope', 'Legacy window',
      '# Deferred 1', 'Auth server latency',
      '# Answered 1', 'Retry backoff',
    ]);
  });

  it('hides empty groups', () => {
    const { container } = renderRail({ 'auth-latency': answer(assumptionItem, 'holds') }, [], [decisionItem, assumptionItem]);
    expect(groups(container)).toEqual(['# Needs your answer 1', 'Retry backoff', '# Answered 1', 'Auth server latency']);
  });

  it('lists threads in the Comments tab', () => {
    const { container } = renderRail({}, [thread('t1', '1.1', null)]);
    fireEvent.click(tab(/Comments/));
    expect(container.querySelector('.chips')).not.toBeNull();
    expect(container.querySelectorAll('.rail-list > .thread')).toHaveLength(1);
  });

  it('labels each card with its section number', () => {
    const { container } = renderRail({}, [], [decisionItem]);
    expect(container.querySelector('.item-card .loc')!.textContent).toBe('§ 1.1');
  });
});
