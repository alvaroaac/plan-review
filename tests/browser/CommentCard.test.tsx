// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { CommentCard } from '../../src/browser/CommentCard.js';
import type { ReviewComment } from '../../src/types.js';

const mockComment: ReviewComment = {
  sectionId: '1.1',
  text: 'This looks correct',
  timestamp: new Date('2026-04-13'),
};

describe('CommentCard', () => {
  it('displays comment text and section heading', () => {
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('This looks correct')).toBeTruthy();
    expect(screen.getByText('Task 1')).toBeTruthy();
  });

  it('shows edit and delete buttons', () => {
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('calls onDelete when Delete clicked', () => {
    const onDelete = vi.fn();
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('switches to edit mode on Edit click', () => {
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    const textarea = screen.getByPlaceholderText('Add a comment...') as HTMLTextAreaElement;
    expect(textarea.value).toBe('This looks correct');
  });

  it('calls onEdit with new text after editing', () => {
    const onEdit = vi.fn();
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={onEdit} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));

    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Updated comment' } });
    fireEvent.click(screen.getByText('Add'));

    expect(onEdit).toHaveBeenCalledWith('Updated comment');
  });

  it('returns to display mode on edit cancel', () => {
    render(<CommentCard comment={mockComment} sectionHeading="Task 1" onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('This looks correct')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
  });
});
