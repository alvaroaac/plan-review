// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { SectionView } from '../src/SectionView.js';
import type { Section } from '@plan-review/core';

const planTask: Section = {
  id: '1.1',
  heading: 'Create schema',
  level: 3,
  body: '**Bold text** and `inline code`',
  parent: 'milestone-1',
  dependencies: { dependsOn: ['1.0'], blocks: ['1.2'] },
  verification: 'npm test',
  relatedFiles: ['src/schema.ts'],
};

const milestone: Section = {
  id: 'milestone-1',
  heading: 'Foundation',
  level: 2,
  body: 'Setup work for the feature.',
};

const genericSection: Section = {
  id: 'section-1',
  heading: 'Introduction',
  level: 2,
  body: 'Some introductory text.',
};

const multiLineSection: Section = {
  id: 'section-2',
  heading: 'Multi-line',
  level: 2,
  body: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.',
};

const defaultProps = {
  commentedLines: new Set<number>(),
  onLineComment: vi.fn(),
  onSectionComment: vi.fn(),
};

describe('SectionView', () => {
  it('renders section heading', () => {
    render(<SectionView section={planTask} mode="plan" isActive={false} {...defaultProps} />);
    expect(screen.getByText('Create schema')).toBeTruthy();
  });

  it('renders markdown body content', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={false} {...defaultProps} />
    );
    const bodyDiv = container.querySelector('.section-body');
    expect(bodyDiv?.innerHTML).toContain('Bold text');
    expect(bodyDiv?.innerHTML).toContain('inline code');
  });

  it('shows dependency metadata in plan mode for tasks', () => {
    render(<SectionView section={planTask} mode="plan" isActive={false} {...defaultProps} />);
    expect(screen.getByText(/Depends on:/)).toBeTruthy();
    expect(screen.getByText(/Blocks:/)).toBeTruthy();
    expect(screen.getByText(/Verify:/)).toBeTruthy();
  });

  it('hides metadata for milestones in plan mode', () => {
    render(<SectionView section={milestone} mode="plan" isActive={false} {...defaultProps} />);
    expect(screen.queryByText(/Depends on:/)).toBeNull();
  });

  it('hides metadata in generic mode', () => {
    render(<SectionView section={genericSection} mode="generic" isActive={false} {...defaultProps} />);
    expect(screen.queryByText(/Depends on:/)).toBeNull();
  });

  it('shows "Add comment to entire section" for reviewable sections', () => {
    render(<SectionView section={planTask} mode="plan" isActive={false} {...defaultProps} />);
    expect(screen.getByText('Add comment to entire section')).toBeTruthy();
  });

  it('hides "Add comment to entire section" for milestones in plan mode', () => {
    render(<SectionView section={milestone} mode="plan" isActive={false} {...defaultProps} />);
    expect(screen.queryByText('Add comment to entire section')).toBeNull();
  });

  it('shows "Add comment to entire section" for level 2 in generic mode', () => {
    render(<SectionView section={genericSection} mode="generic" isActive={false} {...defaultProps} />);
    expect(screen.getByText('Add comment to entire section')).toBeTruthy();
  });

  it('calls onSectionComment when "Add comment to entire section" clicked', () => {
    const onSectionComment = vi.fn();
    render(
      <SectionView
        section={planTask}
        mode="plan"
        isActive={false}
        commentedLines={new Set()}
        onLineComment={vi.fn()}
        onSectionComment={onSectionComment}
      />
    );
    fireEvent.click(screen.getByText('Add comment to entire section'));
    expect(onSectionComment).toHaveBeenCalledWith('1.1');
  });

  it('shows range-start-hint after gutter click', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={false} {...defaultProps} />
    );
    const gutter = container.querySelector('.line-gutter');
    if (gutter) fireEvent.click(gutter);
    expect(container.querySelector('.range-start-hint')).toBeTruthy();
  });

  it('calls onLineComment on shift-click after initial click', () => {
    const onLineComment = vi.fn();
    const { container } = render(
      <SectionView
        section={planTask}
        mode="plan"
        isActive={false}
        commentedLines={new Set()}
        onLineComment={onLineComment}
        onSectionComment={vi.fn()}
      />
    );
    const gutters = container.querySelectorAll('.line-gutter');
    if (gutters.length > 0) {
      fireEvent.click(gutters[0]);
      fireEvent.click(gutters[0], { shiftKey: true });
      expect(onLineComment).toHaveBeenCalledOnce();
    }
  });

  it('applies being-commented class when pendingAnchor is null (section-level)', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={false} {...defaultProps} pendingAnchor={null} />
    );
    expect(container.querySelector('.section-view.being-commented')).toBeTruthy();
  });

  it('does not apply being-commented class when pendingAnchor is undefined', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={false} {...defaultProps} />
    );
    expect(container.querySelector('.section-view.being-commented')).toBeNull();
  });

  it('marks pending lines with pending-comment class when pendingAnchor is set', () => {
    const anchor = { type: 'lines' as const, startLine: 0, endLine: 0, lineTexts: ['Bold text and inline code'] };
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={false} {...defaultProps} pendingAnchor={anchor} />
    );
    expect(container.querySelector('.line-block.pending-comment')).toBeTruthy();
    // section box itself should NOT have being-commented class
    expect(container.querySelector('.section-view.being-commented')).toBeNull();
  });

  it('applies active class when isActive', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={true} {...defaultProps} />
    );
    expect(container.querySelector('.section-view.active')).toBeTruthy();
  });

  it('sets id attribute for scroll targeting', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={false} {...defaultProps} />
    );
    expect(container.querySelector('#section-1\\.1')).toBeTruthy();
  });

  it('marks commented lines with hasComment prop', () => {
    const { container } = render(
      <SectionView
        section={planTask}
        mode="plan"
        isActive={false}
        commentedLines={new Set([0])}
        onLineComment={vi.fn()}
        onSectionComment={vi.fn()}
      />
    );
    // First line block should have has-comment class
    const firstBlock = container.querySelector('.line-block');
    expect(firstBlock?.classList.contains('has-comment')).toBe(true);
  });

  it('shows in-range class on hovered line after gutter click (single-line preview)', () => {
    const { container } = render(
      <SectionView section={multiLineSection} mode="generic" isActive={false} {...defaultProps} />
    );
    const gutters = container.querySelectorAll('.line-gutter');
    const blocks = container.querySelectorAll('.line-block');
    // Click first gutter to set rangeStart
    fireEvent.click(gutters[0]);
    // Hover over same line — should show in-range
    fireEvent.mouseEnter(blocks[0]);
    expect(blocks[0].classList.contains('in-range')).toBe(true);
  });

  it('shows in-range on all lines between rangeStart and hovered line', () => {
    const { container } = render(
      <SectionView section={multiLineSection} mode="generic" isActive={false} {...defaultProps} />
    );
    const gutters = container.querySelectorAll('.line-gutter');
    const blocks = container.querySelectorAll('.line-block');

    // Click first gutter to set rangeStart=0
    fireEvent.click(gutters[0]);
    // Hover over third line — lines 0,1,2 should all be in-range
    fireEvent.mouseEnter(blocks[2]);

    expect(blocks[0].classList.contains('in-range')).toBe(true);
    expect(blocks[1].classList.contains('in-range')).toBe(true);
    expect(blocks[2].classList.contains('in-range')).toBe(true);
  });

  it('clears range state after shift-click confirms selection', () => {
    const onLineComment = vi.fn();
    const { container } = render(
      <SectionView
        section={multiLineSection}
        mode="generic"
        isActive={false}
        commentedLines={new Set()}
        onLineComment={onLineComment}
        onSectionComment={vi.fn()}
      />
    );
    const gutters = container.querySelectorAll('.line-gutter');

    // Click first gutter, then shift-click third
    fireEvent.click(gutters[0]);
    fireEvent.click(gutters[2], { shiftKey: true });

    expect(onLineComment).toHaveBeenCalledOnce();
    // rangeStart should be cleared — no hint shown
    expect(container.querySelector('.range-start-hint')).toBeNull();
  });
});
