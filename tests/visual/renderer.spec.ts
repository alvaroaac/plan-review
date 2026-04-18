import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
  // Plan dir is needed so /_assets/<rel> can serve the fixture's local image.
  transport.setAssetBaseDir(dirname(FIXTURE));
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

test('footnotes section has populated bodies and inline refs render as <sup>', async ({ page }) => {
  await gotoAndWait(page);

  const footnoteSection = page.locator('section.footnotes');
  await expect(footnoteSection).toHaveCount(1);

  // Lives inside a section-view under the Footnotes heading, not at document root.
  const parentHeading = await footnoteSection.evaluate((el) => {
    const parent = el.closest('div[id^="section-"]');
    return parent?.querySelector('h2')?.textContent?.trim() ?? null;
  });
  expect(parentHeading).toBe('Footnotes');

  // Regression guard: marked-footnote recursively parses each body through our
  // custom renderer; without the fix, the <li>s were empty and bodies showed
  // as stray paragraphs above. Both body texts must live inside the section.
  const sectionHtml = await footnoteSection.evaluate((el) => el.innerHTML);
  expect(sectionHtml).toContain('The first footnote body');
  expect(sectionHtml).toContain('The second one');

  // And no stray duplicate body paragraph above the section.
  const footnotesSection = page.locator('div[id^="section-"]').filter({ has: footnoteSection }).first();
  const bodyDupes = await footnotesSection.locator('p', { hasText: 'The first footnote body' }).count();
  // One copy inside the <section>'s <p>, none above it.
  expect(bodyDupes).toBe(1);

  // Inline refs — the paragraph with [^note1][^note2] should mount <sup><a> markers.
  const refs = footnotesSection.locator('sup a[data-footnote-ref]');
  await expect(refs).toHaveCount(2);

  // The ref must be visible (non-zero size, non-transparent color).
  const firstRefStyle = await refs.first().evaluate((a) => {
    const s = getComputedStyle(a);
    const rect = a.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      color: s.color,
      text: a.textContent?.trim() ?? '',
    };
  });
  expect(firstRefStyle.width).toBeGreaterThan(0);
  expect(firstRefStyle.height).toBeGreaterThan(0);
  expect(firstRefStyle.text).toMatch(/^\d+$/);
});

test('nested lists produce nested <ul>/<ol> DOM with visible markers', async ({ page }) => {
  await gotoAndWait(page);

  const listsSection = page.locator('div[id^="section-"]').filter({ hasText: 'Unordered, nested' }).first();

  // Each level of the one / one-a / one-a-i chain must mount as its own <ul>.
  await expect(listsSection.locator('ul').first()).toBeVisible();
  await expect(listsSection.locator('ul ul').first()).toBeVisible();
  await expect(listsSection.locator('ul ul ul').first()).toBeVisible();

  // Computed style: each nested <ul> must have non-"none" list-style-type AND
  // real padding-inline-start. Either missing = bullets flatten into a single
  // visual column (the regression the audit flagged).
  const nestedUlStyle = await listsSection.locator('ul ul').first().evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      listStyleType: s.listStyleType,
      paddingInlineStart: parseFloat(s.paddingInlineStart),
    };
  });
  expect(nestedUlStyle.listStyleType).not.toBe('none');
  expect(nestedUlStyle.paddingInlineStart).toBeGreaterThan(0);
});

test('ordered list numbering continues across per-item LineBlocks', async ({ page }) => {
  await gotoAndWait(page);

  // The ## Lists section contains several subsections — target the
  // "Ordered, nested" ones by their first-item text. Our renderer emits one
  // <ol> per top-level item, so without `start=N` every item visually
  // restarts at "1." — the bug the fixture surfaced.
  const listsSection = page.locator('div[id^="section-"]').filter({ hasText: 'Ordered, nested' }).first();
  const firstOrdered = listsSection.locator('.line-inner > ol', { hasText: 'first' });
  const secondOrdered = listsSection.locator('.line-inner > ol', { hasText: 'second' });
  const thirdOrdered = listsSection.locator('.line-inner > ol', { hasText: 'third' });

  await expect(firstOrdered).toHaveAttribute('start', '1');
  await expect(secondOrdered).toHaveAttribute('start', '2');
  await expect(thirdOrdered).toHaveAttribute('start', '3');
});

test('GFM task-list checkbox sits inline with its label', async ({ page }) => {
  await gotoAndWait(page);

  const taskSection = page.locator('div[id^="section-"]').filter({ hasText: 'GitHub task list' }).first();
  const firstTaskItem = taskSection.locator('li.task-list-item').first();
  await expect(firstTaskItem).toBeVisible();

  // The checkbox and the label ("unchecked") must share a line. Regression
  // guard: marked wraps loose-item bodies in <p>, which default-displays block
  // and stacks the checkbox above the label.
  const layout = await firstTaskItem.evaluate((li) => {
    const cb = li.querySelector('input[type="checkbox"]');
    const txt = li.querySelector('p') ?? li;
    const cbRect = cb!.getBoundingClientRect();
    const txtRect = (txt as Element).getBoundingClientRect();
    return {
      // Same visual baseline within a small fuzz tolerance.
      sameLine: Math.abs(cbRect.top - txtRect.top) < 10,
    };
  });
  expect(layout.sameLine).toBe(true);
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

test('Docusaurus :::note ... ::: renders as an admonition with chrome', async ({ page }) => {
  await gotoAndWait(page);

  const admSection = page.locator('div[id^="section-"]').filter({ hasText: 'Admonitions' }).first();
  // The :::note fence in the fixture should land inside its own
  // blockquote.admonition-note — same chrome as the GFM > [!NOTE] form.
  const docusaurus = admSection.locator('blockquote.admonition-note', {
    hasText: 'Docusaurus-style note',
  });
  await expect(docusaurus).toBeVisible();
  await expect(docusaurus.locator('.admonition-title')).toHaveText(/Note/i);

  // Regression guard: body must not also escape into a sibling paragraph
  // (the failure mode would be the `:::` fences rendering as plain text).
  const stray = admSection.locator(
    'p:not(.admonition-title):not(blockquote.admonition-note p)',
    { hasText: 'Docusaurus-style note' },
  );
  await expect(stray).toHaveCount(0);
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

test('local image with relative src loads (served from plan dir)', async ({ page }) => {
  await gotoAndWait(page);

  // Fixture: ![local gif](demo-browser.gif). Should resolve relative to the
  // plan file's directory (examples/) and return a real GIF, not a 404.
  const imagesSection = page.locator('div[id^="section-"]').filter({ hasText: 'Images' }).first();
  const localImg = imagesSection.locator('img[alt="local gif"]');
  await expect(localImg).toBeVisible();

  const dims = await localImg.evaluate((img: HTMLImageElement) => ({
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    src: img.src,
  }));
  expect(dims.naturalWidth).toBeGreaterThan(0);
  expect(dims.naturalHeight).toBeGreaterThan(0);
  expect(dims.src).toMatch(/\/_assets\/demo-browser\.gif$/);
});

test('inline links use the dark-mode palette, not browser default blue', async ({ page }) => {
  await gotoAndWait(page);

  // Fixture has reference-style links pointing at https://example.com and a
  // GitHub URL. Browser default is rgb(0, 0, 238) — too saturated on the dark
  // background. Must be overridden in CSS.
  const linksSection = page.locator('div[id^="section-"]').filter({ hasText: 'Reference-style' }).first();
  const refLink = linksSection.locator('a[href="https://example.com"]').first();
  await expect(refLink).toBeVisible();

  const color = await refLink.evaluate((a) => getComputedStyle(a).color);
  expect(color).not.toBe('rgb(0, 0, 238)');
  expect(color).not.toBe('rgb(0, 0, 0)');
});

test('<details> wraps markdown content even across blank lines', async ({ page }) => {
  await gotoAndWait(page);

  const inlineHtmlSection = page.locator('div[id^="section-"]').filter({ hasText: 'Inline HTML' }).first();
  const details = inlineHtmlSection.locator('details').first();
  await expect(details).toBeAttached();

  // The "Hidden content with formatting…" paragraph must be a DESCENDANT of
  // <details>, not a sibling that escaped because the blank lines split it
  // into a separate LineBlock.
  const hiddenInside = details.locator('p', { hasText: 'Hidden content' });
  await expect(hiddenInside).toHaveCount(1);

  // <details> defaults to closed → its body is not rendered.
  const initiallyCollapsed = await details.evaluate((d: HTMLDetailsElement) => !d.open);
  expect(initiallyCollapsed).toBe(true);
  await expect(hiddenInside).not.toBeVisible();

  // Clicking the summary opens it.
  await details.locator('summary').click();
  await expect(hiddenInside).toBeVisible();
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
