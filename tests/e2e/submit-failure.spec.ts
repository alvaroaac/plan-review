import type { Page } from '@playwright/test';
import { test, expect, reviewId } from './helpers/cli.js';
import { addParagraphComment, answerDecision, openSubmit, submit } from './helpers/review.js';

async function failFirstSubmit(page: Page): Promise<void> {
  await page.route('**/api/review', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Submission temporarily unavailable' }),
  }), { times: 1 });
}

test('submits comments, verdict, and summary on the happy path', async ({ page, cli }) => {
  const run = await cli.start();
  const comment = 'Happy path comment from the real browser.';
  await page.goto(await run.url);
  await expect(page.locator('.doc-title')).toHaveText(/User Authentication System/);
  await addParagraphComment(page, comment);
  await submit(page, 'Approve', 'Looks ready from e2e.');

  const outcome = await run.waitForExit();
  expect(outcome).toMatchObject({ code: 0, signal: null });
  expect(outcome.stdout).toContain('**Approved**');
  expect(outcome.stdout).toContain('Looks ready from e2e.');
  expect(outcome.stdout).toContain('§ Task 1.1: Create users table');
  expect(outcome.stdout).toContain(`- **Reviewer:** ${comment}`);
});

test('allows summary-only requests for changes through the v2 soft gate', async ({ page, cli }) => {
  const run = await cli.start();
  await page.goto(await run.url);
  await openSubmit(page);
  // v2 replaces the required comment/summary gate with an advisory item list.
  const requestChanges = page.getByRole('button', { name: 'Request changes', exact: true });
  await expect(requestChanges).toBeEnabled();
  await expect(page.getByRole('dialog')).toContainText('4 unanswered');
  await page.getByPlaceholder('Summary for the agent (optional)').fill('Leaving only an overall comment.');
  await requestChanges.click();
  await expect(page.getByRole('heading', { name: 'Review submitted', exact: true })).toBeVisible();
  const outcome = await run.waitForExit();
  expect(outcome.code).toBe(0);
  expect(outcome.stdout).toContain('**Changes requested**');
  expect(outcome.stdout).toContain('Leaving only an overall comment.');
  expect(outcome.stdout).not.toContain('## Open threads');
});

test('keeps a copyable review after a failed submit and recovers to retry without losing progress', async ({ page, cli }) => {
  const run = await cli.start();
  const url = await run.url;
  const comment = 'This comment survives an API-side failure.';
  await page.goto(url);
  await answerDecision(page);
  await addParagraphComment(page, comment);
  await failFirstSubmit(page);
  await openSubmit(page, 'Preserve this summary across the retry.');
  await page.getByRole('button', { name: 'Request changes', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Submit failed' })).toBeVisible();
  await expect(page.getByText('Copy the review and paste it into your agent session.')).toBeVisible();
  await expect(page.locator('.result-err')).toHaveText('Submission temporarily unavailable');
  const reviewText = await page.locator('.submit-failure-review').inputValue();
  expect(reviewText).toContain('# Plan Review: User Authentication System');
  expect(reviewText).toContain('**Changes requested**');
  expect(reviewText).toContain('§ Task 1.1: Create users table');
  expect(reviewText).toContain(comment);
  expect(reviewText).toContain('Rate limit store — **B**: Postgres table keyed by email');
  expect(reviewText).toContain('Preserve this summary across the retry.');

  // The intercepted POST never froze the real round; its autosaved state remains available.
  const response = await page.request.get(new URL('/api/doc', url).href);
  expect(response.ok()).toBe(true);
  const loaded = await response.json();
  expect(loaded.review.answers['rate-limit-store'].choice).toBe('B');
  expect(loaded.review.threads[0].comments[0].body).toBe(comment);

  await page.getByRole('button', { name: 'Back to review' }).click();
  await expect(page.locator('.thread .cmt p')).toHaveText(comment);
  await page.getByRole('tab', { name: /Decisions/ }).click();
  await expect(page.locator('#card-rate-limit-store .answer')).toContainText('B · Postgres table keyed by email');
  await openSubmit(page);
  await expect(page.getByPlaceholder('Summary for the agent (optional)')).toHaveValue('Preserve this summary across the retry.');
  await page.getByRole('button', { name: 'Request changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review submitted', exact: true })).toBeVisible();
  const outcome = await run.waitForExit();
  expect(outcome).toMatchObject({ code: 0, signal: null });
  expect(reviewId(outcome.stdout)).toBe(reviewId(reviewText));
  expect(outcome.stdout.trim()).toBe(reviewText);
});

test('copies the recovered review text to the clipboard after submit failure', async ({ page, context, cli }) => {
  const run = await cli.start();
  const url = await run.url;
  const comment = 'Clipboard recovery comment from e2e.';
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  await page.goto(url);
  await addParagraphComment(page, comment);
  await failFirstSubmit(page);
  await openSubmit(page, 'Recover using the clipboard.');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Submit failed' })).toBeVisible();

  const reviewText = await page.locator('.submit-failure-review').inputValue();
  await page.getByRole('button', { name: 'Copy review to clipboard' }).click();
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(reviewText);
  expect(reviewText).toContain(comment);
  await page.getByRole('button', { name: 'Back to review' }).click();
  await submit(page, 'Approve', 'Recover using the clipboard.');
  const outcome = await run.waitForExit();
  expect(outcome.code).toBe(0);
  expect(outcome.stdout.trim()).toBe(reviewText);
});
