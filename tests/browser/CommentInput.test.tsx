// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { CommentInput } from '../../src/browser/CommentInput.js';

describe('CommentInput', () => {
  it('renders textarea and buttons', () => {
    render(<CommentInput sectionId="1.1" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByPlaceholderText('Add a comment...')).toBeTruthy();
    expect(screen.getByText('Add')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('calls onSubmit with sectionId and text', () => {
    const onSubmit = vi.fn();
    render(<CommentInput sectionId="1.1" onSubmit={onSubmit} onCancel={vi.fn()} />);

    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Looks good' } });
    fireEvent.click(screen.getByText('Add'));

    expect(onSubmit).toHaveBeenCalledWith('1.1', 'Looks good');
  });

  it('calls onCancel when Cancel clicked', () => {
    const onCancel = vi.fn();
    render(<CommentInput sectionId="1.1" onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not submit empty text', () => {
    const onSubmit = vi.fn();
    render(<CommentInput sectionId="1.1" onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('Add'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('pre-fills textarea with initialText for editing', () => {
    render(<CommentInput sectionId="1.1" onSubmit={vi.fn()} onCancel={vi.fn()} initialText="Existing comment" />);
    const textarea = screen.getByPlaceholderText('Add a comment...') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Existing comment');
  });

  it('clears textarea after submit', () => {
    render(<CommentInput sectionId="1.1" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const textarea = screen.getByPlaceholderText('Add a comment...') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'Comment text' } });
    fireEvent.click(screen.getByText('Add'));
    expect(textarea.value).toBe('');
  });
});
