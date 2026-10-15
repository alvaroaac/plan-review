// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent } from '@testing-library/preact';
import type { LoadedReview, PlanDocument } from '@plan-review/core';
import { TocPanel } from '../src/components/TocPanel.js';
import {
  answer, assumptionItem, decisionItem, mockLoaded, renderWithReview, thread,
} from './test-utils.js';

const genericDoc: PlanDocument = {
  title: 'Generic',
  metadata: {},
  mode: 'generic',
  sections: [
    { id: 'section-1', heading: 'Overview', level: 2, body: 'a' },
    { id: 'section-2', heading: 'Scope', level: 2, body: 'b' },
  ],
  comments: [],
};

function renderToc(patch: Partial<LoadedReview> = {}, active: string | null = null) {
  return renderWithReview(<TocPanel active={active} />, { ...mockLoaded(), ...patch });
}

const rows = (container: Element) => Array.from(container.querySelectorAll('.idx-row'));

describe('TocPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists every section with its number and title under a Contents header', () => {
    const { container } = renderToc({ document: genericDoc, items: [] });
    expect(container.querySelector('nav.index > .idx-h')!.textContent).toBe('Contents');
    expect(rows(container).map((r) => [r.querySelector('.idx-num')!.textContent, r.querySelector('.idx-t')!.textContent]))
      .toEqual([['01', 'Overview'], ['02', 'Scope']]);
  });

  it('shows a dot per item coloured by kind and state', () => {
    const items = [{ ...decisionItem, sectionId: 'section-1' }, { ...assumptionItem, sectionId: 'section-1' }];
    const base = mockLoaded();
    const { container } = renderToc({
      document: genericDoc,
      items,
      review: { ...base.review, answers: { 'auth-latency': answer(assumptionItem, 'deferred') } },
    });
    const dots = Array.from(rows(container)[0].querySelectorAll('.idx-dot'), (d) => d.className);
    expect(dots).toEqual(['idx-dot k-decision open', 'idx-dot k-assumption deferred']);
    expect(rows(container)[1].querySelector('.idx-dots')).toBeNull();
  });

  it('shows the open-thread count, ignoring resolved and outdated threads', () => {
    const base = mockLoaded();
    const { container } = renderToc({
      document: genericDoc,
      items: [],
      review: {
        ...base.review,
        threads: [
          thread('t1', 'section-2', null),
          thread('t2', 'section-2', null),
          thread('t3', 'section-2', null, { resolved: true }),
          thread('t4', 'section-2', null, { outdated: true }),
        ],
      },
    });
    expect(rows(container)[0].querySelector('.idx-cmt')).toBeNull();
    expect(rows(container)[1].querySelector('.idx-cmt')!.textContent).toBe('2');
  });

  it('groups plan tasks under their milestone', () => {
    const { container } = renderToc();
    const milestone = container.querySelector('nav.index > .idx-sec')!;
    expect(milestone.querySelector(':scope > .idx-row .idx-t')!.textContent).toBe('Milestone 1');
    expect(milestone.querySelector(':scope > .idx-row .idx-num')!.textContent).toBe('01');
    const tasks = Array.from(milestone.querySelectorAll('.idx-tasks .idx-row'));
    expect(tasks.map((r) => [r.querySelector('.idx-num')!.textContent, r.querySelector('.idx-t')!.textContent]))
      .toEqual([['1.1', 'Task 1'], ['1.2', 'Task 2']]);
  });

  it('marks the active section', () => {
    const { container } = renderToc({}, '1.2');
    expect(rows(container).map((r) => r.classList.contains('on'))).toEqual([false, false, true]);
  });

  it('scrolls the document to a section when its row is clicked', () => {
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo;
    const { container } = renderWithReview(
      <>
        <TocPanel active={null} />
        <div class="main"><div class="scroll"><h3 id="sec-1.2">Task 2</h3></div></div>
      </>,
      mockLoaded(),
    );
    fireEvent.click(rows(container)[2]);
    expect(scrollTo).toHaveBeenCalledWith({ top: -40, behavior: 'smooth' });
  });
});
