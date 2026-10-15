// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { FakeReviewClient } from '@plan-review/core/client';
import type { ReviewClient } from '@plan-review/core';
import { App } from '../src/App.js';
import { answer, assumptionItem, decisionItem, mockLoaded, thread } from './test-utils.js';

const THEME_KEY = 'plan-review-theme';

function mockColorScheme(dark: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: dark && query === '(prefers-color-scheme: dark)',
    media: query,
  })) as unknown as typeof window.matchMedia;
}

async function renderLoaded(client: ReviewClient = new FakeReviewClient({ loaded: mockLoaded() })) {
  const utils = render(<App client={client} />);
  await waitFor(() => expect(utils.container.querySelector('header.top')).toBeTruthy());
  return utils;
}

const html = () => document.documentElement;

describe('App', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    localStorage.clear();
    mockColorScheme(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.className = '';
    html().removeAttribute('data-theme');
  });

  it('shows a loading state until the document arrives', () => {
    const client: ReviewClient = {
      loadDocument: () => new Promise(() => {}),
      saveProgress: async () => {},
      submitReview: async () => ({ ok: true, output: '' }),
    };
    render(<App client={client} />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('shows the error when loading fails', async () => {
    const client: ReviewClient = {
      loadDocument: () => Promise.reject(new Error('Network error')),
      saveProgress: async () => {},
      submitReview: async () => ({ ok: true, output: '' }),
    };
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByText('Error: Network error')).toBeTruthy());
  });

  it('retries a failed load', async () => {
    const loadDocument = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(mockLoaded());
    const client: ReviewClient = { loadDocument, saveProgress: async () => {}, submitReview: async () => ({ ok: true, output: '' }) };
    const { container } = render(<App client={client} />);
    await waitFor(() => expect(screen.getByText('Error: Network error')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(container.querySelector('header.top')).toBeTruthy());
    expect(loadDocument).toHaveBeenCalledTimes(2);
  });

  it('renders the top bar with brand, plan title crumb, theme toggle and Submit review', async () => {
    const { container } = await renderLoaded();
    const top = container.querySelector('header.top')!;
    expect(top.querySelector('.brand')!.textContent).toBe('plan-review');
    expect(top.querySelector('.crumb b')!.textContent).toBe('Test Plan');
    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit review' })).toBeTruthy();
  });

  it('renders the three-column grid: contents, document, rail', async () => {
    const { container } = await renderLoaded();
    const main = container.querySelector('.app > .main')!;
    expect(main.children).toHaveLength(3);
    expect(main.children[0].matches('nav.index')).toBe(true);
    expect(main.children[1].matches('.scroll')).toBe(true);
    expect(main.children[1].querySelector('article.doc')).toBeTruthy();
    expect(main.children[2].matches('aside.side')).toBe(true);
  });

  it('Submit review toggles the submit popover', async () => {
    await renderLoaded();
    const btn = screen.getByRole('button', { name: 'Submit review' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Submit review' })).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByRole('dialog', { name: 'Submit review' })).toBeNull();
  });

  it('closes the submit popover on a click outside it', async () => {
    const { container } = await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
    fireEvent.mouseDown(container.querySelector('article.doc')!);
    expect(screen.queryByRole('dialog', { name: 'Submit review' })).toBeNull();
  });

  it('shows the stepper in the top bar between the crumb and the theme toggle', async () => {
    const { container } = await renderLoaded();
    const children = Array.from(container.querySelector('header.top')!.children);
    const stepper = children.findIndex((el) => el.matches('.stepper'));
    expect(children[stepper - 1].matches('.sp')).toBe(true);
    expect(children[stepper + 1].matches('.sp')).toBe(true);
    expect(children[stepper - 2].matches('.crumb')).toBe(true);
  });

  it('hides the stepper when the plan has no items', async () => {
    const { container } = await renderLoaded(new FakeReviewClient({ loaded: mockLoaded({ items: [] }) }));
    expect(container.querySelector('.stepper')).toBeNull();
  });

  it('renders the contents and the document', async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll('nav.index .idx-row')).toHaveLength(3);
    expect(container.querySelector('article.doc h1.doc-title')!.textContent).toBe('Test Plan');
  });

  it('marks the section scrolled past the top as active in the contents', async () => {
    const { container } = await renderLoaded();
    const scroll = container.querySelector<HTMLElement>('.main > .scroll')!;
    const tops: Record<string, number> = { 'sec-milestone-1': -300, 'sec-1.1': 100, 'sec-1.2': 400 };
    for (const [id, top] of Object.entries(tops)) {
      document.getElementById(id)!.getBoundingClientRect = () => ({ top } as DOMRect);
    }
    // The scroll listener is attached in an effect, which runs after paint.
    await waitFor(() => {
      fireEvent.scroll(scroll);
      expect(container.querySelector('.idx-row.on .idx-t')!.textContent).toBe('Task 1');
    });
  });

  describe('theme', () => {
    it('defaults to prefers-color-scheme', async () => {
      mockColorScheme(true);
      await renderLoaded();
      expect(html().dataset.theme).toBe('dark');
    });

    it('prefers the stored theme over prefers-color-scheme', async () => {
      mockColorScheme(true);
      localStorage.setItem(THEME_KEY, 'light');
      await renderLoaded();
      expect(html().dataset.theme).toBe('light');
    });

    it('applies the theme while still loading', () => {
      localStorage.setItem(THEME_KEY, 'dark');
      const client: ReviewClient = {
        loadDocument: () => new Promise(() => {}),
        saveProgress: async () => {},
        submitReview: async () => ({ ok: true, output: '' }),
      };
      render(<App client={client} />);
      expect(html().dataset.theme).toBe('dark');
    });

    it('toggle flips data-theme and persists the choice', async () => {
      await renderLoaded();
      expect(html().dataset.theme).toBe('light');
      expect(localStorage.getItem(THEME_KEY)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
      expect(html().dataset.theme).toBe('dark');
      expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    });

    it('survives localStorage throwing', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
      mockColorScheme(true);
      await renderLoaded();
      expect(html().dataset.theme).toBe('dark');
      fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
      expect(html().dataset.theme).toBe('light');
    });

    it('inside VS Code ignores the stored theme and follows the body class', async () => {
      localStorage.setItem(THEME_KEY, 'light');
      document.body.className = 'vscode-dark';
      await renderLoaded();
      expect(html().dataset.theme).toBe('dark');
    });

    it('inside VS Code hides the toggle, tracks body class changes and stores nothing', async () => {
      document.body.className = 'vscode-dark';
      await renderLoaded();
      expect(screen.queryByRole('button', { name: 'Toggle theme' })).toBeNull();

      document.body.className = 'vscode-light';
      await waitFor(() => expect(html().dataset.theme).toBe('light'));
      expect(localStorage.getItem(THEME_KEY)).toBeNull();
    });
  });

  describe('submit', () => {
    const answered = () => {
      const base = mockLoaded();
      return mockLoaded({
        review: {
          ...base.review,
          answers: { 'retry-backoff': answer(decisionItem, 'B'), 'auth-latency': answer(assumptionItem, 'no') },
          threads: [thread('t_1', '1.1', null)],
        },
      });
    };

    async function submitWith(client: ReviewClient, verdict: 'Approve' | 'Request changes', summary = '') {
      await renderLoaded(client);
      fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
      if (summary) fireEvent.input(document.querySelector('.submit-pop textarea')!, { target: { value: summary } });
      fireEvent.click(screen.getByRole('button', { name: verdict }));
    }

    it('on success shows the submitted view and a toast summing up the review', async () => {
      await submitWith(new FakeReviewClient({ loaded: answered() }), 'Approve');
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Review submitted' })).toBeTruthy());
      expect(screen.getByText('You can close this tab.')).toBeTruthy();
      expect(document.querySelector('header.top')).toBeNull();
      expect(document.querySelector('.toast')!.textContent).toBe('Review sent · 2 answered, 1 assumption flagged, 1 comment');
    });

    it('omits item counts from the toast for a plan without items', async () => {
      await submitWith(new FakeReviewClient({ loaded: mockLoaded({ items: [] }) }), 'Approve');
      await waitFor(() => expect(document.querySelector('.toast')!.textContent).toBe('Review sent'));
    });

    describe('on failure', () => {
      const failing = (loaded = answered()): ReviewClient => ({
        loadDocument: async () => loaded,
        saveProgress: async () => {},
        submitReview: () => Promise.reject(new Error('Submit cancelled — no destination chosen.')),
      });

      it('shows the error and the review formatted from the current state', async () => {
        await submitWith(failing(), 'Request changes', 'Rethink the retries');
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Submit failed' })).toBeTruthy());
        expect(screen.getByText('Submit cancelled — no destination chosen.')).toBeTruthy();
        const text = document.querySelector<HTMLTextAreaElement>('textarea.submit-failure-review')!.value;
        expect(text).toContain('# Plan Review: Test Plan');
        expect(text).toContain('Review `rv_abc12345` · Round 2 · **Changes requested**');
        expect(text).toContain('Rethink the retries');
        expect(text).toContain('### `retry-backoff` · Retry backoff — **B**: Circuit breaker');
      });

      it('keeps the heartbeat alive while the failure is shown, so the server does not exit', async () => {
        await submitWith(failing(), 'Approve');
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Submit failed' })).toBeTruthy());
        await new Promise((r) => setTimeout(r, 50)); // let the shell's effects settle
        vi.mocked(fetch).mockClear();
        document.dispatchEvent(new Event('visibilitychange'));
        expect(fetch).toHaveBeenCalledWith('/api/heartbeat', expect.anything());
      });

      it('copies the review to the clipboard', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await submitWith(failing(), 'Approve');
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Submit failed' })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Copy review to clipboard' }));
        await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
        expect(writeText).toHaveBeenCalledWith(document.querySelector<HTMLTextAreaElement>('textarea.submit-failure-review')!.value);
      });

      it('says so when the clipboard is unavailable', async () => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
        await submitWith(failing(), 'Approve');
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Submit failed' })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Copy review to clipboard' }));
        await waitFor(() => expect(screen.getByText('Could not copy. Select the review below.')).toBeTruthy());
      });

      it('Back to review returns to the review with its answers and threads intact', async () => {
        await submitWith(failing(), 'Approve');
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Submit failed' })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Back to review' }));
        expect(screen.queryByRole('heading', { name: 'Submit failed' })).toBeNull();
        expect(document.querySelector('header.top')).toBeTruthy();
        expect(document.querySelector('.side .tab.on')!.textContent).toContain('Decisions');
        const answers = Array.from(document.querySelectorAll('.side .item-card .answer'), (a) => a.textContent);
        expect(answers).toHaveLength(2);
        expect(answers[0]).toContain('B · Circuit breaker');
        expect(answers[1]).toContain("Doesn't hold");
        fireEvent.click(screen.getByRole('tab', { name: /Comments/ }));
        expect(document.querySelectorAll('.side .thread')).toHaveLength(1);
      });

      it('Back to review restores the summary in the submit popover', async () => {
        await submitWith(failing(), 'Request changes', 'Rethink the retries');
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Submit failed' })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Back to review' }));
        fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
        expect(document.querySelector<HTMLTextAreaElement>('.submit-pop textarea')!.value).toBe('Rethink the retries');
      });
    });
  });
});
