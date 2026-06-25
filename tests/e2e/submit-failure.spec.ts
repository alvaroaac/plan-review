import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from '../../packages/core/src/parser.js';
import { HttpTransport } from '../../packages/cli/src/transport.js';
import type { ReviewSubmission } from '../../packages/core/src/types.js';

const DEMO_PLAN = resolve(import.meta.dirname, '..', '..', 'examples', 'demo-plan.md');

let transport: HttpTransport;
let baseUrl: string;
let submissions: ReviewSubmission[];

test.beforeEach(async () => {
  const input = readFileSync(DEMO_PLAN, 'utf-8');
  const doc = parse(input);
  submissions = [];
  transport = new HttpTransport();
  transport.sendDocument(doc);
  transport.setAssetBaseDir(dirname(DEMO_PLAN));
  transport.onReviewSubmit((submission) => {
    submissions.push(submission);
  });
  const started = await transport.start(0);
  baseUrl = started.url;
});

test.afterEach(async () => {
  await transport?.stop();
});

async function addSectionComment(page: Page, text: string): Promise<void> {
  await page.locator('#section-1\\.1 .add-section-comment-link').click();
  await page.getByPlaceholder('Add a comment...').fill(text);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(text)).toBeVisible();
}

async function openSubmitPopover(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Submit Review ▾' }).click();
  await expect(page.getByRole('dialog', { name: 'Submit review' })).toBeVisible();
}

async function confirmSubmit(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
}

test('submits comments, verdict, and summary on the happy path', async ({ page }) => {
  const comment = 'Happy path comment from the real browser.';

  await page.goto(baseUrl);
  await expect(page.locator('header.top-bar h1')).toHaveText(/User Authentication System/);
  await addSectionComment(page, comment);

  await openSubmitPopover(page);
  await page.getByPlaceholder('Leave a summary...').fill('Looks ready from e2e.');
  await confirmSubmit(page);

  await expect(page.getByText('Review submitted. You can close this tab.')).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    verdict: 'approved',
    summary: 'Looks ready from e2e.',
    comments: [
      expect.objectContaining({
        sectionId: '1.1',
        text: comment,
      }),
    ],
  });
});

test('requires either comments or a summary for comment-only submissions', async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator('header.top-bar h1')).toHaveText(/User Authentication System/);

  await openSubmitPopover(page);
  await page.getByLabel('Comment').check();

  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
  await page.getByPlaceholder('Leave a summary...').fill('Leaving only an overall comment.');
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
});

test('keeps a copyable review when the API dies before submit', async ({ page }) => {
  const comment = 'This comment survives an API-side failure.';

  await page.goto(baseUrl);
  await expect(page.locator('header.top-bar h1')).toHaveText(/User Authentication System/);
  await addSectionComment(page, comment);

  await transport.stop();

  await openSubmitPopover(page);
  await confirmSubmit(page);

  await expect(page.getByRole('heading', { name: 'Submit failed' })).toBeVisible();
  await expect(page.getByText('Copy the review and paste it into your agent session.')).toBeVisible();
  await expect(page.getByText(/^Error:/)).toHaveCount(0);

  const reviewText = await page.locator('.submit-failure-review').inputValue();
  expect(reviewText).toContain('# Plan Review: User Authentication System');
  expect(reviewText).toContain('## Section 1.1: Task 1.1: Create users table');
  expect(reviewText).toContain(comment);
});

test('copies the recovered review text to the clipboard after submit failure', async ({ page, context }) => {
  const comment = 'Clipboard recovery comment from e2e.';

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
  await page.goto(baseUrl);
  await addSectionComment(page, comment);

  await transport.stop();
  await openSubmitPopover(page);
  await confirmSubmit(page);
  await expect(page.getByRole('heading', { name: 'Submit failed' })).toBeVisible();

  const reviewText = await page.locator('.submit-failure-review').inputValue();
  await page.getByRole('button', { name: 'Copy review to clipboard' }).click();

  await expect(page.getByText('Copied')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(reviewText);
  expect(reviewText).toContain(comment);
});
