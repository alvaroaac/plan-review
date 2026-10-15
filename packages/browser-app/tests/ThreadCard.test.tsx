// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/preact';
import type { Section, Thread } from '@plan-review/core';
import { ThreadCard } from '../src/components/ThreadCard.js';
import { SectionView } from '../src/components/SectionView.js';
import { useReview } from '../src/state/ReviewContext.js';
import { lineAnchor, mockLoaded, mockPlanDoc, renderWithReview, thread } from './test-utils.js';

const NOW = new Date('2026-10-15T12:00:00.000Z');

const conversation: Thread = thread('t1', '1.1', lineAnchor(0, ['Bold and code']), {
  comments: [
    { id: 'c1', author: 'reviewer', body: 'Why bold?', createdAt: '2026-10-15T11:46:00.000Z' },
    { id: 'c2', author: 'agent', body: 'For emphasis.', createdAt: '2026-10-15T09:00:00.000Z' },
  ],
});

// Reads the thread back from state, as CommentsList does, so actions re-render the card.
function LiveCard() {
  const { state } = useReview();
  return <ThreadCard thread={state.review.threads[0]} loc="§ 1.1 Task 1" />;
}

function renderCard(t: Thread = conversation) {
  const base = mockLoaded();
  return renderWithReview(<LiveCard />, { ...base, review: { ...base.review, threads: [t] } });
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const queryButton = (name: string | RegExp) => screen.queryByRole('button', { name });
const replyInput = () => screen.getByPlaceholderText('Reply…');
const comments = (container: Element) =>
  Array.from(container.querySelectorAll('.cmt'), (c) => ({
    who: c.querySelector('.cmt-meta b')!.textContent,
    body: c.querySelector('p')!.textContent,
    agent: c.classList.contains('is-agent'),
  }));

describe('ThreadCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the section loc and the anchored text as a quote', () => {
    const { container } = renderCard();
    expect(container.querySelector('.th-head .loc')!.textContent).toBe('§ 1.1 Task 1');
    expect(container.querySelector('.th-quote')!.textContent).toBe('Bold and code');
  });

  it('joins a multi-line anchor into one quote', () => {
    const { container } = renderCard(thread('t1', '1.1', lineAnchor(0, ['First line', 'Second line'])));
    expect(container.querySelector('.th-quote')!.textContent).toBe('First line Second line');
  });

  it('has no quote for a whole-section thread', () => {
    const { container } = renderCard(thread('t1', '1.1', null));
    expect(container.querySelector('.th-quote')).toBeNull();
  });

  it('labels comments You (reviewer) and Agent (agent), with relative times', () => {
    const { container } = renderCard();
    expect(comments(container)).toEqual([
      { who: 'You', body: 'Why bold?', agent: false },
      { who: 'Agent', body: 'For emphasis.', agent: true },
    ]);
    expect(Array.from(container.querySelectorAll('.cmt-meta span'), (s) => s.textContent)).toEqual(['14m', '3h']);
  });

  it('gives agent comments a distinct avatar and no edit controls', () => {
    const { container } = renderCard();
    const [mine, agent] = Array.from(container.querySelectorAll('.cmt'));
    expect(mine.querySelector('.ava')!.classList.contains('ava-reviewer')).toBe(true);
    expect(agent.querySelector('.ava')!.classList.contains('ava-agent')).toBe(true);
    expect(agent.querySelector('button, input, textarea, [contenteditable]')).toBeNull();
  });

  it('replies on Enter with a trimmed body and clears the input', () => {
    const { review } = renderCard();
    fireEvent.input(replyInput(), { target: { value: '  Fair enough  ' } });
    fireEvent.keyDown(replyInput(), { key: 'Enter' });
    const posted = review.current.state.review.threads[0].comments;
    expect(posted).toHaveLength(3);
    expect(posted[2]).toMatchObject({ author: 'reviewer', body: 'Fair enough' });
    expect((replyInput() as HTMLInputElement).value).toBe('');
  });

  it('does not post an empty reply', () => {
    const { review } = renderCard();
    fireEvent.keyDown(replyInput(), { key: 'Enter' });
    fireEvent.input(replyInput(), { target: { value: '   ' } });
    fireEvent.keyDown(replyInput(), { key: 'Enter' });
    expect(review.current.state.review.threads[0].comments).toHaveLength(2);
  });

  it('resolves an open thread', () => {
    const { container, review } = renderCard();
    fireEvent.click(button(/Resolve/));
    expect(review.current.state.review.threads[0].resolved).toBe(true);
    expect(container.querySelector('.thread')!.classList.contains('is-resolved')).toBe(true);
  });

  it('reopens a resolved thread, which has no reply input', () => {
    const { review } = renderCard({ ...conversation, resolved: true });
    expect(screen.queryByPlaceholderText('Reply…')).toBeNull();
    expect(queryButton(/Resolve/)).toBeNull();
    fireEvent.click(button('Reopen'));
    expect(review.current.state.review.threads[0].resolved).toBe(false);
  });

  it('resolving or replying does not focus the thread', () => {
    const { review } = renderCard();
    fireEvent.click(replyInput());
    fireEvent.click(button(/Resolve/));
    expect(review.current.state.ui.focus).toBeNull();
  });

  it('clicking the card focuses the thread and scrolls the document to its highlight', () => {
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo;
    const base = mockLoaded();
    const { container, review } = renderWithReview(
      <>
        <ThreadCard thread={conversation} loc="§ 1.1 Task 1" />
        <div class="main"><div class="scroll"><span id="hl-t1">Bold and code</span></div></div>
      </>,
      { ...base, review: { ...base.review, threads: [conversation] } },
    );
    fireEvent.click(container.querySelector('.thread')!);
    expect(review.current.state.ui.focus).toEqual({ kind: 'thread', id: 't1' });
    expect(scrollTo).toHaveBeenCalledWith({ top: -180, behavior: 'smooth' });
  });

  it('a whole-section thread scrolls the document to its section heading', () => {
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo;
    const t = thread('t1', '1.1', null);
    const base = mockLoaded();
    const { container } = renderWithReview(
      <>
        <ThreadCard thread={t} loc="§ 1.1 Task 1" />
        <div class="main"><div class="scroll"><h3 id="sec-1.1">Task 1</h3></div></div>
      </>,
      { ...base, review: { ...base.review, threads: [t] } },
    );
    fireEvent.click(container.querySelector('.thread')!);
    expect(scrollTo).toHaveBeenCalledWith({ top: -180, behavior: 'smooth' });
  });

  it('focusing the card outlines its highlight in the document', () => {
    const section: Section = { ...mockPlanDoc.sections[1], body: 'Bold and code' };
    const base = mockLoaded();
    const { container } = renderWithReview(
      <>
        <ThreadCard thread={conversation} loc="§ 1.1 Task 1" />
        <SectionView section={section} num="1.1" />
      </>,
      { ...base, document: { ...mockPlanDoc, sections: [section] }, review: { ...base.review, threads: [conversation] } },
    );
    const hl = () => container.querySelector('#hl-t1')!;
    expect(hl().classList.contains('is-focus')).toBe(false);
    fireEvent.click(container.querySelector('.thread')!);
    expect(hl().classList.contains('is-focus')).toBe(true);
    expect(container.querySelector('.thread')!.classList.contains('is-focus')).toBe(true);
  });

  it('scrolls into view when the thread is focused from the document', async () => {
    const { container, review } = renderCard();
    review.current.dispatch({ type: 'focus', target: { kind: 'thread', id: 't1' } });
    const card = container.querySelector('#th-t1')!;
    await vi.waitFor(() => expect(card.scrollIntoView).toHaveBeenCalled());
  });
});
