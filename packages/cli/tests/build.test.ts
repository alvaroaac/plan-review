import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// The browser HTML is produced by @plan-review/browser-app. The CLI's
// `build:browser` script copies that output into packages/cli/dist/browser/
// during the CLI build. We test the browser-app output directly to avoid
// racing with other CLI tests that read the copied asset.
const browserAppHtml = resolve(root, '../browser-app/dist/index.html');

describe('browser build', () => {
  beforeAll(() => {
    const browserAppRoot = resolve(root, '../browser-app');
    execSync('node build.js', { cwd: browserAppRoot, stdio: 'pipe' });
  }, 30000);

  const outHtml = browserAppHtml;

  it('produces dist/index.html', () => {
    expect(existsSync(outHtml)).toBe(true);
  });

  it('contains inline JavaScript', () => {
    const html = readFileSync(outHtml, 'utf-8');
    expect(html).toContain('<script>');
    expect(html).toContain('preact');
  });

  it('contains inline CSS', () => {
    const html = readFileSync(outHtml, 'utf-8');
    expect(html).toContain('<style>');
    expect(html).toContain('--bg-primary');
  });

  it('is a valid HTML document', () => {
    const html = readFileSync(outHtml, 'utf-8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<div id="app">');
  });
});
