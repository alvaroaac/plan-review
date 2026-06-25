import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from '../../packages/core/src/parser.js';
import { HttpTransport } from '../../packages/cli/src/transport.js';

const DEMO_PLAN = resolve(import.meta.dirname, '..', '..', 'examples', 'demo-plan.md');

let transport: HttpTransport;
let baseUrl: string;

test.beforeEach(async () => {
  const input = readFileSync(DEMO_PLAN, 'utf-8');
  const doc = parse(input);
  transport = new HttpTransport();
  transport.sendDocument(doc);
  transport.setAssetBaseDir(dirname(DEMO_PLAN));
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

test('keeps a copyable review when the API dies before submit', async ({ page }) => {
  const comment = 'This comment survives an API-side failure.';

  await page.goto(baseUrl);
  await expect(page.locator('header.top-bar h1')).toHaveText(/User Authentication System/);
  await addSectionComment(page, comment);

  await transport.stop();

  await page.getByRole('button', { name: 'Submit Review ▾' }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Submit failed' })).toBeVisible();
  await expect(page.getByText('Copy the review and paste it into your agent session.')).toBeVisible();
  await expect(page.getByText(/^Error:/)).toHaveCount(0);

  const reviewText = await page.locator('.submit-failure-review').inputValue();
  expect(reviewText).toContain('# Plan Review: User Authentication System');
  expect(reviewText).toContain('## Section 1.1: Task 1.1: Create users table');
  expect(reviewText).toContain(comment);
});
