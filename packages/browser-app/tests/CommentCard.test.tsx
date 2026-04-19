// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { CommentCard } from '../src/CommentCard.js';
import type { ReviewComment } from '@plan-review/core';

const mockComment: ReviewComment = {
  sectionId: '1.1',
  text: 'This looks correct',
  timestamp: new Date('2026-04-13'),
};

const mockCommentWithAnchor: ReviewComment = {
  sectionId: '1.1',
  text: 'This looks correct',
  timestamp: new Date('2026-04-13'),
  anchor: { type: 'lines', startLine: 2, endLine: 4, lineTexts: ['line A', 'line B', 'line C'] },
};

describe('CommentCard', () => {
  it('displays comment text and "Entire section" label for section-level comment', () => {
    render(<CommentCard comment={mockComment} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('This looks correct')).toBeTruthy();
    expect(screen.getByText('Entire section')).toBeTruthy();
  });

  it('displays anchor label and quoted lines for anchored comment', () => {
    render(<CommentCard comment={mockCommentWithAnchor} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Lines 3–5')).toBeTruthy();
    expect(screen.getByText('line A')).toBeTruthy();
    expect(screen.getByText('line B')).toBeTruthy();
    expect(screen.getByText('line C')).toBeTruthy();
  });

  it('displays single-line anchor label', () => {
    const comment: ReviewComment = {
      sectionId: '1.1',
      text: 'Single line comment',
      timestamp: new Date(),
      anchor: { type: 'lines', startLine: 0, endLine: 0, lineTexts: ['only line'] },
    };
    render(<CommentCard comment={comment} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Line 1')).toBeTruthy();
  });

  it('shows edit and delete buttons', () => {
    render(<CommentCard comment={mockComment} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('calls onDelete when Delete clicked', () => {
    const onDelete = vi.fn();
    render(<CommentCard comment={mockComment} onEdit={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('switches to edit mode on Edit click', () => {
    render(<CommentCard comment={mockComment} onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    const textarea = screen.getByPlaceholderText('Add a comment...') as HTMLTextAreaElement;
    expect(textarea.value).toBe('This looks correct');
  });

  it('calls onEdit with new text after editing', () => {
    const onEdit = vi.fn();
    render(<CommentCard comment={mockComment} onEdit={onEdit} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));

    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Updated comment' } });
    fireEvent.click(screen.getByText('Add'));

    expect(onEdit).toHaveBeenCalledWith('Updated comment');
  });

  it('returns to display mode on edit cancel', () => {
    render(<CommentCard comment={mockComment} onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('This looks correct')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
  });
});
