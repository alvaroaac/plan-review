import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outHtml = resolve(root, 'dist/browser/index.html');

describe('browser build', () => {
  beforeAll(() => {
    execSync('node scripts/build-browser.js', { cwd: root, stdio: 'pipe' });
  }, 30000);

  it('produces dist/browser/index.html', () => {
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
