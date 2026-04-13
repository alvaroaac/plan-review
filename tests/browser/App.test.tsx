// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { App } from '../../src/browser/App.js';
import { mockPlanDoc } from './test-utils.js';

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('fetches and renders document', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ document: mockPlanDoc }),
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Test Plan')).toBeTruthy();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/doc');
  });

  it('renders three panels after load', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ document: mockPlanDoc }),
    });

    const { container } = render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    expect(container.querySelector('.toc-panel')).toBeTruthy();
    expect(container.querySelector('.content-area')).toBeTruthy();
    expect(container.querySelector('.comment-sidebar')).toBeTruthy();
  });

  it('shows mode badge', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ document: mockPlanDoc }),
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('plan')).toBeTruthy();
    });
  });

  it('adds comment through UI flow', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ document: mockPlanDoc }),
    });

    render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Click Add Comment on first task section
    const addButtons = screen.getAllByText('Add Comment');
    fireEvent.click(addButtons[0]);

    // Type and submit comment
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Great task' } });
    fireEvent.click(screen.getByText('Add'));

    // Comment should appear in sidebar
    expect(screen.getByText('Great task')).toBeTruthy();
    expect(screen.getByText('Comments (1)')).toBeTruthy();
  });

  it('submits review via POST', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: () => Promise.resolve({ document: mockPlanDoc }) })
      .mockResolvedValueOnce({ ok: true });

    render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Add a comment
    const addButtons = screen.getAllByText('Add Comment');
    fireEvent.click(addButtons[0]);
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Review comment' } });
    fireEvent.click(screen.getByText('Add'));

    // Submit review
    fireEvent.click(screen.getByText('Submit Review'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/review', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  it('shows submitted state after successful submit', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: () => Promise.resolve({ document: mockPlanDoc }) })
      .mockResolvedValueOnce({ ok: true });

    render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Add comment and submit
    fireEvent.click(screen.getAllByText('Add Comment')[0]);
    fireEvent.input(screen.getByPlaceholderText('Add a comment...'), { target: { value: 'Done' } });
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Submit Review'));

    await waitFor(() => {
      expect(screen.getByText(/Review submitted/)).toBeTruthy();
    });
  });

  it('shows error state on fetch failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Error:/)).toBeTruthy();
    });
  });

  it('disables submit button when no comments', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ document: mockPlanDoc }),
    });

    render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    const submitBtn = screen.getByText('Submit Review') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });
});
