// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { TOCPanel } from '../src/TOCPanel.js';
import { mockPlanDoc, mockGenericDoc } from './test-utils.js';
import type { ReviewComment } from '@plan-review/core';

describe('TOCPanel', () => {
  describe('plan mode', () => {
    it('renders milestone headings', () => {
      render(<TOCPanel doc={mockPlanDoc} comments={[]} activeSection={null} onNavigate={vi.fn()} />);
      expect(screen.getByText('Milestone 1')).toBeTruthy();
    });

    it('renders task items under milestones', () => {
      render(<TOCPanel doc={mockPlanDoc} comments={[]} activeSection={null} onNavigate={vi.fn()} />);
      expect(screen.getByText('Task 1')).toBeTruthy();
      expect(screen.getByText('Task 2')).toBeTruthy();
    });

    it('shows checkmark for commented sections', () => {
      const comments: ReviewComment[] = [
        { sectionId: '1.1', text: 'OK', timestamp: new Date() },
      ];
      const { container } = render(
        <TOCPanel doc={mockPlanDoc} comments={comments} activeSection={null} onNavigate={vi.fn()} />
      );
      const commented = container.querySelectorAll('.commented');
      expect(commented.length).toBe(1);
    });

    it('marks active section', () => {
      const { container } = render(
        <TOCPanel doc={mockPlanDoc} comments={[]} activeSection="1.1" onNavigate={vi.fn()} />
      );
      expect(container.querySelector('.toc-item.active')).toBeTruthy();
    });

    it('calls onNavigate with section id on click', () => {
      const onNavigate = vi.fn();
      render(<TOCPanel doc={mockPlanDoc} comments={[]} activeSection={null} onNavigate={onNavigate} />);
      fireEvent.click(screen.getByText('Task 1'));
      expect(onNavigate).toHaveBeenCalledWith('1.1');
    });
  });

  describe('generic mode', () => {
    it('renders flat section list', () => {
      render(<TOCPanel doc={mockGenericDoc} comments={[]} activeSection={null} onNavigate={vi.fn()} />);
      expect(screen.getByText('Section One')).toBeTruthy();
      expect(screen.getByText('Section Two')).toBeTruthy();
    });

    it('calls onNavigate on click', () => {
      const onNavigate = vi.fn();
      render(<TOCPanel doc={mockGenericDoc} comments={[]} activeSection={null} onNavigate={onNavigate} />);
      fireEvent.click(screen.getByText('Section One'));
      expect(onNavigate).toHaveBeenCalledWith('section-1');
    });

    it('shows checkmark for commented sections', () => {
      const comments: ReviewComment[] = [
        { sectionId: 'section-2', text: 'Comment', timestamp: new Date() },
      ];
      const { container } = render(
        <TOCPanel doc={mockGenericDoc} comments={comments} activeSection={null} onNavigate={vi.fn()} />
      );
      expect(container.querySelectorAll('.commented').length).toBe(1);
    });
  });
});
