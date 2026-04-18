import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpTransport } from '../../src/transport.js';
import { parse } from '../../src/parser.js';

// Boot the real HttpTransport against examples/renderer-fixture.md once per
// suite. Playwright drives headless Chromium against it. We assert post-mount
// DOM (mermaid SVG present, KaTeX typeset, footnote section in place, etc.)
// and computed styles — the things vitest unit tests cannot see.

const FIXTURE = resolve(import.meta.dirname, '..', '..', 'examples', 'renderer-fixture.md');
const SCREENSHOT_DIR = resolve(import.meta.dirname, 'screenshots');

let transport: HttpTransport;
let baseUrl: string;

test.beforeAll(async () => {
  // Start each run from a clean screenshot dir — stale PNGs from a prior run
  // would otherwise mask a regression that silently stopped rendering a section.
  rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const input = readFileSync(FIXTURE, 'utf-8');
  const doc = parse(input);
  transport = new HttpTransport();
  transport.sendDocument(doc);
  const { url } = await transport.start(0);
  baseUrl = url;
});

test.afterAll(async () => {
  await transport.stop();
});

async function gotoAndWait(page: Page): Promise<void> {
  await page.goto(baseUrl);
  // Wait for the top bar — proxy for "App rendered and /api/doc resolved".
  await expect(page.locator('header.top-bar h1')).toBeVisible();
  // Section containers all mount before mermaid/katex kick in.
  await expect(page.locator('div[id^="section-"]')).not.toHaveCount(0);
}

test('document loads and renders every section', async ({ page }) => {
  await gotoAndWait(page);

  await expect(page.locator('header.top-bar h1')).toHaveText(/Renderer Fixture/);

  // Each `##` in the fixture becomes a section. Count them and assert the DOM
  // matches — otherwise we've lost a section somewhere in the parser.
  const input = readFileSync(FIXTURE, 'utf-8');
  const h2Count = (input.match(/^## /gm) ?? []).length;
  await expect(page.locator('div[id^="section-"]')).toHaveCount(h2Count);
});

test('mermaid diagrams render as inline SVG', async ({ page }) => {
  await gotoAndWait(page);

  // Raw <pre class="mermaid"> should get replaced by mermaid.run(). Allow time
  // for the CDN fetch — this is the whole point of the visual suite. If the
  // CDN is blocked, this fails and the failure attachment shows raw source —
  // the correct signal.
  await expect(page.locator('svg[id^="mermaid"]').first()).toBeVisible({ timeout: 30_000 });

  // Fixture has two mermaid blocks (flowchart + sequence).
  await expect(page.locator('svg[id^="mermaid"]')).toHaveCount(2);
  // And every remaining <pre class="mermaid"> must carry the processed marker.
  await expect(page.locator('pre.mermaid:not([data-processed])')).toHaveCount(0);
});

test('KaTeX typesets inline and display math', async ({ page }) => {
  await gotoAndWait(page);

  // Inline: fixture has `$E = mc^2$` and one more — expect >= 2.
  await expect(page.locator('.math-inline .katex').first()).toBeVisible({ timeout: 30_000 });
  const inlineCount = await page.locator('.math-inline .katex').count();
  expect(inlineCount).toBeGreaterThanOrEqual(2);

  // Display: the Fourier transform line.
  await expect(page.locator('.math-display .katex-display, .math-display .katex').first()).toBeVisible();
});

test('footnotes section appears under the Footnotes heading', async ({ page }) => {
  await gotoAndWait(page);

  const footnotes = page.locator('section.footnotes');
  await expect(footnotes).toHaveCount(1);

  // Should live inside a section-view, not at document root (guards against
  // the "footnotes floated to the top" regression the audit flagged). The
  // parent section's H2 heading text should be "Footnotes".
  const parentHeading = await footnotes.evaluate((el) => {
    const parent = el.closest('div[id^="section-"]');
    return parent?.querySelector('h2')?.textContent?.trim() ?? null;
  });
  expect(parentHeading).toBe('Footnotes');
});

test('nested lists produce nested <ul>/<ol> DOM with visible markers', async ({ page }) => {
  await gotoAndWait(page);

  // Unordered nested section: `- one / - one-a / - one-a-i`.
  // The top-level list renderer emits one <ul> per top-level item with the
  // nested list rendered inside the first item. So the OUTER ul should have a
  // `ul ul` descendant for the one/one-a/one-a-i chain.
  const nestedUl = page.locator('div[id^="section-"]').filter({ hasText: 'Unordered, nested' }).first()
    .locator('ul ul');
  await expect(nestedUl.first()).toBeVisible();

  // And a 3-deep chain must exist.
  const deepUl = page.locator('div[id^="section-"]').filter({ hasText: 'Unordered, nested' }).first()
    .locator('ul ul ul');
  await expect(deepUl.first()).toBeVisible();

  // Computed style: the nested <ul> must have a non-"none" list-style-type.
  // Otherwise nested items lose their bullets — the visible "nesting broken"
  // bug the user reported.
  const listStyle = await nestedUl.first().evaluate((el) => getComputedStyle(el).listStyleType);
  expect(listStyle).not.toBe('none');
});

test('GFM admonitions render with chrome and title', async ({ page }) => {
  await gotoAndWait(page);

  const note = page.locator('blockquote.admonition-note').first();
  await expect(note).toBeVisible();
  await expect(note.locator('.admonition-title')).toHaveText(/Note/i);

  const warning = page.locator('blockquote.admonition-warning').first();
  await expect(warning).toBeVisible();
  await expect(warning.locator('.admonition-title')).toHaveText(/Warning/i);
});

test('inline HTML (<kbd>, <sub>, <sup>) is visible on the dark background', async ({ page }) => {
  await gotoAndWait(page);

  const kbd = page.locator('kbd').first();
  await expect(kbd).toBeVisible();

  // "Visible on dark" means computed color must differ from computed background
  // of its nearest ancestor that actually has a background. Simpler proxy: kbd
  // itself should have a non-transparent background OR a distinct border,
  // otherwise it blends into the page.
  const styled = await kbd.evaluate((el) => {
    const s = getComputedStyle(el);
    const bg = s.backgroundColor;
    const border = s.borderTopWidth;
    return {
      backgroundColor: bg,
      borderTopWidth: border,
      hasDistinctChrome:
        (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ||
        (parseFloat(border) > 0),
    };
  });
  expect(styled.hasDistinctChrome).toBe(true);

  await expect(page.locator('sub').first()).toBeVisible();
  await expect(page.locator('sup').first()).toBeVisible();
});

test('per-section screenshots — written to tests/visual/screenshots/', async ({ page }) => {
  await gotoAndWait(page);
  // Wait a beat for mermaid + katex to resolve so screenshots aren't snapped
  // mid-render. Other tests already asserted both exist; here we just want the
  // pixels stable.
  await page.locator('svg[id^="mermaid"]').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await page.locator('.math-inline .katex').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(500);

  const sections = await page.locator('div[id^="section-"]').all();
  for (const section of sections) {
    const id = await section.getAttribute('id');
    if (!id) continue;
    const heading = (await section.locator('h2').first().textContent())?.trim() ?? id;
    const safeHeading = heading.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    await section.screenshot({ path: resolve(SCREENSHOT_DIR, `${id}__${safeHeading}.png`) });
  }
});
