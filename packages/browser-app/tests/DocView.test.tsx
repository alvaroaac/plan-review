// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LoadedReview } from '@plan-review/core';
import { DocView } from '../src/components/DocView.js';
import { renderMermaidBlocks } from '../src/mermaid.js';
import { renderMathBlocks } from '../src/katex.js';
import { answer, decisionItem, mockLoaded, renderWithReview } from './test-utils.js';

vi.mock('../src/mermaid.js', () => ({ renderMermaidBlocks: vi.fn(async () => {}) }));
vi.mock('../src/katex.js', () => ({ renderMathBlocks: vi.fn(async () => {}) }));

function renderDoc(patch: Partial<LoadedReview> = {}, review: Partial<LoadedReview['review']> = {}) {
  const base = mockLoaded();
  return renderWithReview(<DocView />, { ...base, ...patch, review: { ...base.review, ...review } });
}

describe('DocView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('renders the kicker with the round number and the plan title', () => {
    const { container } = renderDoc();
    expect(container.querySelector('article.doc > .kicker')!.textContent).toBe('Plan · Round 2');
    expect(container.querySelector('h1.doc-title')!.textContent).toBe('Test Plan');
  });

  it('shows the review id and when the review was last updated', () => {
    const { container } = renderDoc({}, { answers: { 'retry-backoff': answer(decisionItem, 'A') } });
    const meta = container.querySelector('.doc-meta')!;
    expect(meta.textContent).toContain('Updated 2h ago');
    expect(meta.textContent).toContain('rv_abc12345');
  });

  it('falls back to the stored review time before anything was answered or commented', () => {
    const { container } = renderDoc();
    expect(container.querySelector('.doc-meta')!.textContent).toContain('Updated 3h ago');
  });

  it('renders the legend', () => {
    const { container } = renderDoc();
    expect(container.querySelector('.legend')!.textContent).toBe('DecisionAssumptionCommentHover a paragraph to comment');
  });

  it('renders every section', () => {
    const { container } = renderDoc();
    expect(Array.from(container.querySelectorAll('[id^="sec-"]'), (h) => h.id)).toEqual(['sec-milestone-1', 'sec-1.1', 'sec-1.2']);
  });

  describe('banners', () => {
    const banners = (container: Element) => Array.from(container.querySelectorAll('.callout'), (b) => b.textContent);

    it('shows no banner by default', () => {
      const { container } = renderDoc();
      expect(banners(container)).toEqual([]);
    });

    it('explains when the plan changed while the review was paused', () => {
      const { container } = renderDoc({}, { banner: 'planChangedWhilePaused' });
      expect(banners(container)).toHaveLength(1);
      expect(banners(container)[0]).toContain('The plan changed while this review was paused');
    });

    it('explains when the plan is unchanged since the last round', () => {
      const { container } = renderDoc({}, { banner: 'planUnchanged' });
      expect(banners(container)[0]).toContain('The plan hasn’t changed since the last round');
    });

    it('counts items that changed since they were answered', () => {
      const { container } = renderDoc({}, { answers: { 'retry-backoff': answer(decisionItem, 'A', 'old-hash') } });
      expect(banners(container)[0]).toContain('1 item changed since you answered it');
    });

    it('lists the warnings under a counted heading', () => {
      const { container } = renderDoc({ warnings: ['Line 4: missing id', 'Line 9: duplicate id'] });
      expect(banners(container)[0]).toContain('This plan has 2 warnings:');
      const items = Array.from(container.querySelectorAll('.callout li'), (li) => li.textContent);
      expect(items).toEqual(['Line 4: missing id', 'Line 9: duplicate id']);
    });

    it('uses the singular for one warning', () => {
      const { container } = renderDoc({ warnings: ['Line 4: missing id'] });
      expect(banners(container)[0]).toContain('This plan has 1 warning:');
    });
  });

  it('renders mermaid diagrams and math in the document after rendering', () => {
    const { container } = renderDoc();
    const article = container.querySelector('article.doc');
    expect(renderMermaidBlocks).toHaveBeenCalledWith(article);
    expect(renderMathBlocks).toHaveBeenCalledWith(article);
  });
});
