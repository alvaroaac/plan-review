// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { App } from '../../src/browser/App.js';
import { mockPlanDoc } from './test-utils.js';

function mockFetchDoc() {
  return vi.fn().mockResolvedValueOnce({
    json: () => Promise.resolve({ document: mockPlanDoc }),
  });
}

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Basic rendering ────────────────────────────────────────────────────────

  it('shows loading state initially', () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('fetches and renders document', async () => {
    vi.stubGlobal('fetch', mockFetchDoc());
    render(<App />);
    await waitFor(() => expect(screen.getByText('Test Plan')).toBeTruthy());
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/doc');
  });

  it('renders three panels after load', async () => {
    vi.stubGlobal('fetch', mockFetchDoc());
    const { container } = render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));
    expect(container.querySelector('.toc-panel')).toBeTruthy();
    expect(container.querySelector('.content-area')).toBeTruthy();
    expect(container.querySelector('.comment-sidebar')).toBeTruthy();
  });

  it('shows mode badge', async () => {
    vi.stubGlobal('fetch', mockFetchDoc());
    render(<App />);
    await waitFor(() => expect(screen.getByText('plan')).toBeTruthy());
  });

  it('shows error state on fetch failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Error:/)).toBeTruthy());
  });

  it('disables submit button when no comments', async () => {
    vi.stubGlobal('fetch', mockFetchDoc());
    render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));
    const btn = screen.getByText('Submit Review') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // ── Gap 1: Full add-comment flow (section-level) ───────────────────────────

  it('full section-level comment flow: click link → input → add → sidebar updates', async () => {
    vi.stubGlobal('fetch', mockFetchDoc());
    const { container } = render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Click "Add comment to entire section" on the first reviewable section (1.1 = Task 1)
    const links = screen.getAllByText('Add comment to entire section');
    fireEvent.click(links[0]);

    // CommentInput opens in sidebar with section-level label
    const textarea = screen.getByPlaceholderText('Add a comment...');
    expect(screen.getByText('Commenting on entire section:')).toBeTruthy();

    // Section 1.1 gets being-commented highlight
    expect(container.querySelector('#section-1\\.1')?.classList.contains('being-commented')).toBe(true);

    // Type a comment and submit
    fireEvent.input(textarea, { target: { value: 'Looks good' } });
    fireEvent.click(screen.getByText('Add'));

    // Comment card appears in sidebar
    await waitFor(() => expect(screen.getByText('Looks good')).toBeTruthy());
    expect(screen.getByText('Comments (1)')).toBeTruthy();
    expect(screen.getByText('Entire section')).toBeTruthy();

    // being-commented cleared after submission
    expect(container.querySelector('.section-view.being-commented')).toBeNull();

    // Submit button is now enabled
    const submitBtn = screen.getByText('Submit Review') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  // ── Gap 2: Line range selection end-to-end ─────────────────────────────────

  it('full line-anchored comment flow: gutter click → shift-click → input → add → sidebar', async () => {
    vi.stubGlobal('fetch', mockFetchDoc());
    const { container } = render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Section 1.1 body is "**Bold** and `code`" — renders as 1 paragraph LineBlock
    const gutters = container.querySelectorAll('#section-1\\.1 .line-gutter');
    expect(gutters.length).toBeGreaterThan(0);

    // First click: sets rangeStart, range-start-hint appears
    fireEvent.click(gutters[0]);
    expect(container.querySelector('.range-start-hint')).toBeTruthy();

    // Shift-click same gutter: single-line selection confirmed
    fireEvent.click(gutters[0], { shiftKey: true });

    // CommentInput opens with line-anchored label (line 1, 1-indexed)
    expect(screen.getByText('Commenting on line 1:')).toBeTruthy();
    // range-start-hint cleared after selection confirmed
    expect(container.querySelector('.range-start-hint')).toBeNull();

    // Type and submit
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Anchored comment' } });
    fireEvent.click(screen.getByText('Add'));

    // Anchored comment card appears in sidebar
    await waitFor(() => expect(screen.getByText('Anchored comment')).toBeTruthy());
    expect(screen.getByText('Line 1')).toBeTruthy();
    expect(screen.getByText('Comments (1)')).toBeTruthy();

    // The commented line gets ◆ gutter marker
    const gutter = container.querySelector('#section-1\\.1 .line-gutter');
    expect(gutter?.textContent).toBe('◆');
  });

  // ── Gap 3: Delete + submit sequence ────────────────────────────────────────

  async function addSectionComment(linkIndex: number, text: string) {
    const links = screen.getAllByText('Add comment to entire section');
    fireEvent.click(links[linkIndex]);
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: text } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
  }

  it('delete removes correct comment and submit POSTs remaining comments', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({ json: () => Promise.resolve({ document: mockPlanDoc }) })
        .mockResolvedValueOnce({ ok: true }),
    );

    render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Add two comments
    await addSectionComment(0, 'First comment');
    await addSectionComment(0, 'Second comment');
    expect(screen.getByText('Comments (2)')).toBeTruthy();

    // Delete the first comment
    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    // Only second comment remains
    expect(screen.queryByText('First comment')).toBeNull();
    expect(screen.getByText('Second comment')).toBeTruthy();
    expect(screen.getByText('Comments (1)')).toBeTruthy();

    // Submit — POST should carry only the remaining comment
    const submitBtn = screen.getByText('Submit Review') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const postCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === '/api/review',
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall![1].body);
      expect(body.comments).toHaveLength(1);
      expect(body.comments[0].text).toBe('Second comment');
    });

    // Submitted state shown
    await waitFor(() => expect(screen.getByText(/Review submitted/)).toBeTruthy());
  });

  // ── Gap 4: Navigation + active section sync ────────────────────────────────

  it('clicking TOC item marks the correct SectionView as active', async () => {
    vi.stubGlobal('fetch', mockFetchDoc());
    const { container } = render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Initially no section is active
    expect(container.querySelector('.section-view.active')).toBeNull();

    // Click "Task 2" TOC item (use toc-panel scope to avoid matching the h2 in the content area)
    const tocPanel = container.querySelector('.toc-panel')!;
    const tocItems = tocPanel.querySelectorAll('.toc-heading');
    const task2TocItem = Array.from(tocItems).find((el) => el.textContent === 'Task 2')!;
    fireEvent.click(task2TocItem);

    // Section 1.2 has .active class; section 1.1 does not
    expect(container.querySelector('#section-1\\.2')?.classList.contains('active')).toBe(true);
    expect(container.querySelector('#section-1\\.1')?.classList.contains('active')).toBe(false);

    // scrollIntoView was called on the section element
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

    // Navigate to Task 1 — active switches
    const task1TocItem = Array.from(tocPanel.querySelectorAll('.toc-heading')).find(
      (el) => el.textContent === 'Task 1',
    )!;
    fireEvent.click(task1TocItem);
    expect(container.querySelector('#section-1\\.1')?.classList.contains('active')).toBe(true);
    expect(container.querySelector('#section-1\\.2')?.classList.contains('active')).toBe(false);
  });

  it('section gains being-commented class while comment input is open', async () => {
    vi.stubGlobal('fetch', mockFetchDoc());
    const { container } = render(<App />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Before clicking: no section is being-commented
    expect(container.querySelector('.section-view.being-commented')).toBeNull();

    // Open comment input on Task 1 (1.1)
    const links = screen.getAllByText('Add comment to entire section');
    fireEvent.click(links[0]);

    // Section 1.1 is highlighted as being-commented
    expect(container.querySelector('#section-1\\.1')?.classList.contains('being-commented')).toBe(true);
    // Section 1.2 is not
    expect(container.querySelector('#section-1\\.2')?.classList.contains('being-commented')).toBe(false);

    // Cancel the comment input
    fireEvent.click(screen.getByText('Cancel'));

    // being-commented class removed
    expect(container.querySelector('.section-view.being-commented')).toBeNull();
  });
});
