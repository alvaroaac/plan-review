// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { SectionView } from '../../src/browser/SectionView.js';
import type { Section } from '../../src/types.js';

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
});
