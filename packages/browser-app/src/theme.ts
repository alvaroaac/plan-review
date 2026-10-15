export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'plan-review-theme';

/** The VS Code webview theme from its body class, or null outside VS Code. */
export function vscodeTheme(): Theme | null {
  const classes = document.body.classList;
  if (classes.contains('vscode-dark')) return 'dark';
  if (classes.contains('vscode-light')) return 'light';
  return null;
}

/** VS Code body class, else the stored choice, else the OS preference. */
export function detectTheme(): Theme {
  return vscodeTheme() ?? storedTheme() ?? (prefersDark() ? 'dark' : 'light');
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage unavailable (private mode, blocked site data) — the choice just isn't remembered
  }
}

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}
