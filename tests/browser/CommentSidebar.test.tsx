// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { CommentSidebar } from '../../src/browser/CommentSidebar.js';
import { mockPlanDoc } from './test-utils.js';
import type { ReviewComment } from '../../src/types.js';

const sections = mockPlanDoc.sections;

describe('CommentSidebar', () => {
  it('shows empty state when no comments', () => {
    render(
      <CommentSidebar
        comments={[]}
        sections={sections}
        commentingTarget={null}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    expect(screen.getByText(/No comments yet/)).toBeTruthy();
  });

  it('displays existing comments grouped by section', () => {
    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'First comment', timestamp: new Date() },
      { sectionId: '1.2', text: 'Second comment', timestamp: new Date() },
    ];
    render(
      <CommentSidebar
        comments={comments}
        sections={sections}
        commentingTarget={null}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    expect(screen.getByText('First comment')).toBeTruthy();
    expect(screen.getByText('Second comment')).toBeTruthy();
    expect(screen.getByText('Task 1')).toBeTruthy();
    expect(screen.getByText('Task 2')).toBeTruthy();
  });

  it('shows CommentInput when commentingTarget is set', () => {
    render(
      <CommentSidebar
        comments={[]}
        sections={sections}
        commentingTarget={{ sectionId: '1.1' }}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText('Add a comment...')).toBeTruthy();
  });

  it('shows section heading (without prefix) when commentingTarget is set', () => {
    render(
      <CommentSidebar
        comments={[]}
        sections={sections}
        commentingTarget={{ sectionId: '1.1' }}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    // Header should be just the section title, no "Commenting on:" prefix
    expect(screen.getByText('Task 1')).toBeTruthy();
  });

  it('calls onAdd when comment submitted', () => {
    const onAdd = vi.fn();
    render(
      <CommentSidebar
        comments={[]}
        sections={sections}
        commentingTarget={{ sectionId: '1.1' }}
        onAdd={onAdd} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'New comment' } });
    fireEvent.click(screen.getByText('Add'));
    expect(onAdd).toHaveBeenCalledWith('1.1', 'New comment', undefined);
  });

  it('calls onCancelComment when Cancel clicked', () => {
    const onCancel = vi.fn();
    render(
      <CommentSidebar
        comments={[]}
        sections={sections}
        commentingTarget={{ sectionId: '1.1' }}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={onCancel}
      />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onDelete with correct index', () => {
    const onDelete = vi.fn();
    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'Comment A', timestamp: new Date() },
      { sectionId: '1.1', text: 'Comment B', timestamp: new Date() },
    ];
    render(
      <CommentSidebar
        comments={comments}
        sections={sections}
        commentingTarget={null}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={onDelete} onCancelComment={vi.fn()}
      />
    );
    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[1]);
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it('shows comment count in header', () => {
    const comments: ReviewComment[] = [
      { sectionId: '1.1', text: 'A comment', timestamp: new Date() },
    ];
    render(
      <CommentSidebar
        comments={comments}
        sections={sections}
        commentingTarget={null}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    expect(screen.getByText('Comments (1)')).toBeTruthy();
  });

  it('sorts anchored comments by line number within a section', () => {
    const comments: ReviewComment[] = [
      {
        sectionId: '1.1',
        text: 'Later comment',
        timestamp: new Date(),
        anchor: { type: 'lines', startLine: 5, endLine: 5, lineTexts: ['later'] },
      },
      {
        sectionId: '1.1',
        text: 'Earlier comment',
        timestamp: new Date(),
        anchor: { type: 'lines', startLine: 1, endLine: 1, lineTexts: ['earlier'] },
      },
    ];
    render(
      <CommentSidebar
        comments={comments}
        sections={sections}
        commentingTarget={null}
        onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelComment={vi.fn()}
      />
    );
    const cards = screen.getAllByText(/comment/i);
    // "Earlier comment" should appear before "Later comment" in the DOM
    const allText = document.body.textContent ?? '';
    expect(allText.indexOf('Earlier comment')).toBeLessThan(allText.indexOf('Later comment'));
  });
});
