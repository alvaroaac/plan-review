// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { FakeReviewClient } from '@plan-review/core';
import type { ReviewClient } from '@plan-review/core';
import { App } from '../src/App.js';
import { mockPlanDoc } from './test-utils.js';

describe('App', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Basic rendering ────────────────────────────────────────────────────────

  it('shows loading state initially', () => {
    const client: ReviewClient = {
      loadDocument: () => new Promise(() => {}), // never resolves
      saveSession: async () => {},
      submitReview: async () => ({ ok: true }),
    };
    render(<App client={client} />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('fetches and renders document', async () => {
    const client = new FakeReviewClient({ document: mockPlanDoc });
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByText('Test Plan')).toBeTruthy());
  });

  it('renders three panels after load', async () => {
    const client = new FakeReviewClient({ document: mockPlanDoc });
    const { container } = render(<App client={client} />);
    await waitFor(() => screen.getByText('Test Plan'));
    expect(container.querySelector('.toc-panel')).toBeTruthy();
    expect(container.querySelector('.content-area')).toBeTruthy();
    expect(container.querySelector('.comment-sidebar')).toBeTruthy();
  });

  it('shows mode badge', async () => {
    const client = new FakeReviewClient({ document: mockPlanDoc });
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByText('plan')).toBeTruthy());
  });

  it('shows error state on fetch failure', async () => {
    const client: ReviewClient = {
      loadDocument: () => Promise.reject(new Error('Network error')),
      saveSession: async () => {},
      submitReview: async () => ({ ok: true }),
    };
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByText(/Error:/)).toBeTruthy());
  });

  it('hydrates sidebar from restored session comments', async () => {
    const restoredComments = [
      { sectionId: '1.1', text: 'persisted one', timestamp: new Date('2026-04-15') },
      { sectionId: '1.2', text: 'persisted two', timestamp: new Date('2026-04-15') },
    ];
    const client: ReviewClient = {
      loadDocument: async () => ({
        document: mockPlanDoc,
        contentHash: 'sha256:test',
        restoredSession: { comments: restoredComments, activeSection: null, stale: false },
      }),
      saveSession: async () => {},
      submitReview: async () => ({ ok: true }),
    };

    render(<App client={client} />);

    // Comments sidebar shows both rehydrated entries.
    await waitFor(() => expect(screen.getByText('persisted one')).toBeTruthy());
    expect(screen.getByText('persisted two')).toBeTruthy();
    expect(screen.getByText('Comments (2)')).toBeTruthy();
  });

  it('disables submit button when no comments', async () => {
    const client = new FakeReviewClient({ document: mockPlanDoc });
    render(<App client={client} />);
    await waitFor(() => screen.getByText('Test Plan'));
    const btn = screen.getByText('Submit Review') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // ── Gap 1: Full add-comment flow (section-level) ───────────────────────────

  it('full section-level comment flow: click link → input → add → sidebar updates', async () => {
    const client = new FakeReviewClient({ document: mockPlanDoc });
    const { container } = render(<App client={client} />);
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
    const client = new FakeReviewClient({ document: mockPlanDoc });
    const { container } = render(<App client={client} />);
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

  it('delete removes correct comment and submit sends remaining comments', async () => {
    const client = new FakeReviewClient({ document: mockPlanDoc });

    render(<App client={client} />);
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

    // Submit — client.submitReview should carry only the remaining comment
    const submitBtn = screen.getByText('Submit Review') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(client.submits).toHaveLength(1);
      expect(client.submits[0]).toHaveLength(1);
      expect(client.submits[0][0].text).toBe('Second comment');
    });

    // Submitted state shown
    await waitFor(() => expect(screen.getByText(/Review submitted/)).toBeTruthy());
  });

  // ── Gap 4: Navigation + active section sync ────────────────────────────────

  it('clicking TOC item marks the correct SectionView as active', async () => {
    const client = new FakeReviewClient({ document: mockPlanDoc });
    const { container } = render(<App client={client} />);
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
    const client = new FakeReviewClient({ document: mockPlanDoc });
    const { container } = render(<App client={client} />);
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

  // ── Auto-save session on comment change ──────────────────────────────────

  it('calls client.saveSession after adding a comment', async () => {
    const client = new FakeReviewClient({ document: mockPlanDoc, contentHash: 'hash-abc' });

    render(<App client={client} />);
    await waitFor(() => screen.getByText('Test Plan'));

    // Add a section-level comment
    const links = screen.getAllByText('Add comment to entire section');
    fireEvent.click(links[0]);
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Test auto-save' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(screen.getByText('Test auto-save')).toBeTruthy());

    // Wait for debounce (500ms) + margin
    await new Promise((r) => setTimeout(r, 600));

    // Verify saveSession was called with the new comment + contentHash from loadDocument
    expect(client.sessionSaves.length).toBeGreaterThan(0);
    const lastSave = client.sessionSaves[client.sessionSaves.length - 1];
    expect(lastSave.comments).toHaveLength(1);
    expect(lastSave.comments[0].text).toBe('Test auto-save');
    expect(lastSave.contentHash).toBe('hash-abc');
  });

  function fireMessage(data: unknown) {
    // jsdom's MessageEvent constructor strips unknown init keys — define `data` manually.
    const ev = new Event('message') as MessageEvent;
    Object.defineProperty(ev, 'data', { value: data });
    window.dispatchEvent(ev);
  }

  it('shows stale banner when host broadcasts planChanged with a different hash', async () => {
    const client = new FakeReviewClient({ document: mockPlanDoc, contentHash: 'hash-orig' });
    const { container } = render(<App client={client} />);
    await waitFor(() => screen.getByText('Test Plan'));
    // Let the contentHash effect register its listener after state settles.
    await new Promise((r) => setTimeout(r, 50));

    // No banner yet.
    expect(container.querySelector('.banner-warn')).toBeNull();

    // Simulate the extension host posting a planChanged event with a new hash.
    fireMessage({ kind: 'event', type: 'planChanged', newContentHash: 'hash-new' });

    await waitFor(() => expect(container.querySelector('.banner-warn')).toBeTruthy());
  });

  it('ignores planChanged event when newContentHash matches the loaded hash', async () => {
    const client = new FakeReviewClient({ document: mockPlanDoc, contentHash: 'hash-same' });
    const { container } = render(<App client={client} />);
    await waitFor(() => screen.getByText('Test Plan'));
    await new Promise((r) => setTimeout(r, 50));

    fireMessage({ kind: 'event', type: 'planChanged', newContentHash: 'hash-same' });

    // Give any state update a tick, then confirm no banner.
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('.banner-warn')).toBeNull();
  });

  it('does not saveSession when loadDocument did not supply contentHash', async () => {
    // Stub client that omits contentHash from loadDocument result.
    const saves: unknown[] = [];
    const client: ReviewClient = {
      loadDocument: async () => ({ document: mockPlanDoc }),
      saveSession: async (s) => { saves.push(s); },
      submitReview: async () => ({ ok: true as const }),
    };

    render(<App client={client} />);
    await waitFor(() => screen.getByText('Test Plan'));

    const links = screen.getAllByText('Add comment to entire section');
    fireEvent.click(links[0]);
    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.input(textarea, { target: { value: 'Hash-less' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(screen.getByText('Hash-less')).toBeTruthy());

    await new Promise((r) => setTimeout(r, 600));

    // No saveSession should have fired because contentHash is unknown.
    expect(saves).toHaveLength(0);
  });
});
