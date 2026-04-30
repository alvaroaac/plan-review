// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { SubmitReviewPanel } from '../src/SubmitReviewPanel.js';

describe('SubmitReviewPanel', () => {
  it('renders the split-button with chevron', () => {
    const { getByText } = render(<SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />);
    expect(getByText(/Submit Review/i)).toBeTruthy();
  });

  it('opens popover with verdict radios + summary textarea on click', () => {
    const { getByText, getByPlaceholderText, getByLabelText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    expect(getByLabelText(/Approve/i)).toBeTruthy();
    expect(getByLabelText(/Comment/i)).toBeTruthy();
    expect(getByPlaceholderText(/leave a summary/i)).toBeTruthy();
  });

  it('submit button is enabled for Approve regardless of comments/summary', () => {
    const { getByText, getByLabelText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    fireEvent.click(getByLabelText(/Approve/i));
    const submitBtn = getByText('Submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('Comment verdict is disabled with empty summary AND zero comments', () => {
    const { getByText, getByLabelText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    fireEvent.click(getByLabelText(/Comment/i));
    const submitBtn = getByText('Submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('Comment verdict is enabled when summary is non-empty', () => {
    const { getByText, getByLabelText, getByPlaceholderText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    fireEvent.click(getByLabelText(/Comment/i));
    const textarea = getByPlaceholderText(/leave a summary/i) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'something' } });
    const submitBtn = getByText('Submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('Comment verdict is enabled when commentCount > 0', () => {
    const { getByText, getByLabelText } = render(
      <SubmitReviewPanel commentCount={2} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    fireEvent.click(getByLabelText(/Comment/i));
    const submitBtn = getByText('Submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('calls onSubmit with verdict + summary on confirm', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { getByText, getByLabelText, getByPlaceholderText } = render(
      <SubmitReviewPanel commentCount={1} onSubmit={onSubmit} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    fireEvent.click(getByLabelText(/Approve/i));
    const textarea = getByPlaceholderText(/leave a summary/i) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'great work' } });
    fireEvent.click(getByText('Submit'));
    expect(onSubmit).toHaveBeenCalledWith('approved', 'great work');
  });

  it('Cancel closes the popover', () => {
    const { getByText, queryByLabelText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    expect(queryByLabelText(/Approve/i)).toBeTruthy();
    fireEvent.click(getByText('Cancel'));
    expect(queryByLabelText(/Approve/i)).toBeNull();
  });

  it('Escape closes the popover', () => {
    const { getByText, queryByLabelText } = render(
      <SubmitReviewPanel commentCount={0} onSubmit={vi.fn()} />,
    );
    fireEvent.click(getByText(/Submit Review/i));
    expect(queryByLabelText(/Approve/i)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByLabelText(/Approve/i)).toBeNull();
  });

  it('outer button is disabled when disabled prop is true', () => {
    const { getByText } = render(<SubmitReviewPanel commentCount={0} disabled onSubmit={vi.fn()} />);
    const button = getByText(/Submit Review/i).closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
