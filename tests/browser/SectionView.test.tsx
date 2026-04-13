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

describe('SectionView', () => {
  it('renders section heading', () => {
    render(<SectionView section={planTask} mode="plan" isActive={false} onComment={vi.fn()} />);
    expect(screen.getByText('Create schema')).toBeTruthy();
  });

  it('renders markdown body as HTML', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={false} onComment={vi.fn()} />
    );
    const bodyDiv = container.querySelector('.section-body');
    expect(bodyDiv?.innerHTML).toContain('<strong>');
    expect(bodyDiv?.innerHTML).toContain('<code>');
  });

  it('shows dependency metadata in plan mode for tasks', () => {
    render(<SectionView section={planTask} mode="plan" isActive={false} onComment={vi.fn()} />);
    expect(screen.getByText(/Depends on:/)).toBeTruthy();
    expect(screen.getByText(/Blocks:/)).toBeTruthy();
    expect(screen.getByText(/Verify:/)).toBeTruthy();
  });

  it('hides metadata for milestones in plan mode', () => {
    render(<SectionView section={milestone} mode="plan" isActive={false} onComment={vi.fn()} />);
    expect(screen.queryByText(/Depends on:/)).toBeNull();
  });

  it('hides metadata in generic mode', () => {
    render(<SectionView section={genericSection} mode="generic" isActive={false} onComment={vi.fn()} />);
    expect(screen.queryByText(/Depends on:/)).toBeNull();
  });

  it('shows Add Comment button for reviewable sections', () => {
    render(<SectionView section={planTask} mode="plan" isActive={false} onComment={vi.fn()} />);
    expect(screen.getByText('Add Comment')).toBeTruthy();
  });

  it('hides Add Comment for milestones in plan mode', () => {
    render(<SectionView section={milestone} mode="plan" isActive={false} onComment={vi.fn()} />);
    expect(screen.queryByText('Add Comment')).toBeNull();
  });

  it('shows Add Comment for level 2 in generic mode', () => {
    render(<SectionView section={genericSection} mode="generic" isActive={false} onComment={vi.fn()} />);
    expect(screen.getByText('Add Comment')).toBeTruthy();
  });

  it('calls onComment when Add Comment clicked', () => {
    const onComment = vi.fn();
    render(<SectionView section={planTask} mode="plan" isActive={false} onComment={onComment} />);
    fireEvent.click(screen.getByText('Add Comment'));
    expect(onComment).toHaveBeenCalledOnce();
  });

  it('applies active class when isActive', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={true} onComment={vi.fn()} />
    );
    expect(container.querySelector('.section-view.active')).toBeTruthy();
  });

  it('sets id attribute for scroll targeting', () => {
    const { container } = render(
      <SectionView section={planTask} mode="plan" isActive={false} onComment={vi.fn()} />
    );
    expect(container.querySelector('#section-1\\.1')).toBeTruthy();
  });
});
