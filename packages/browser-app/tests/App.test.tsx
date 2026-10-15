// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { FakeReviewClient } from '@plan-review/core/client';
import type { ReviewClient } from '@plan-review/core';
import { App } from '../src/App.js';
import { mockLoaded } from './test-utils.js';

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

  it('Submit review opens the submit popover state', async () => {
    const { container } = await renderLoaded();
    const btn = screen.getByRole('button', { name: 'Submit review' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('header.top')).toBeTruthy();
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
});
