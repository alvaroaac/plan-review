import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, Page, Request } from '@playwright/test';
import type { ProgressUpdate } from '@plan-review/core';
import { test, expect, reviewId, type CliHarness, type CliRun } from './helpers/cli.js';
import { addParagraphComment, answerDecision, submit } from './helpers/review.js';

const COMMENT = 'Keep this migration comment when the tab closes.';
const NOTE = 'Use the existing shared database.';

function progressSaved(page: Page, matches: (update: ProgressUpdate) => boolean): Promise<Request> {
  return page.waitForResponse((response) => {
    if (!response.url().endsWith('/api/session') || response.request().method() !== 'PUT') return false;
    return response.ok() && matches(response.request().postDataJSON());
  }).then((response) => response.request());
}

const hasComment = (update: ProgressUpdate) =>
  update.threads.some((thread) => thread.comments.some((entry) => entry.body === COMMENT));

const SESSION = '**/api/session';

// Routine autosaves fail from here on, however fast or slow the test runs, so new
// progress can only reach the server through the unload save.
async function blockAutosave(page: Page): Promise<void> {
  await page.route(SESSION, (route) => route.abort());
}

async function persistedComments(cli: CliHarness): Promise<string[]> {
  const dir = join(cli.home, 'reviews');
  const reviews = await Promise.all((await readdir(dir)).filter((file) => file.endsWith('.json'))
    .map(async (file) => JSON.parse(await readFile(join(dir, file), 'utf-8')) as ProgressUpdate));
  return reviews.flatMap((review) => review.threads.flatMap((thread) => thread.comments.map((entry) => entry.body)));
}

async function closeAndResume(
  page: Page, context: BrowserContext, cli: CliHarness, first: CliRun, note = NOTE,
): Promise<void> {
  const thread = await page.locator('.thread').getAttribute('id');
  // An intercepted keepalive request can die with the closing page; let the unload save through as is.
  await page.unroute(SESSION);
  // Playwright skips beforeunload by default; run the real tab-close handlers.
  await page.close({ runBeforeUnload: true });
  const paused = await first.waitForExit();
  expect(paused).toMatchObject({ code: 0, signal: null });
  expect(paused.stdout).toContain('paused at round 1 (1/4 items answered)');
  expect(paused.stdout).toContain('The user has not finished reviewing — wait for them.');
  const id = reviewId(paused.stdout);
  expect(paused.stdout).toContain(`--review ${id}`);
  expect(paused.stdout).not.toContain('# Plan Review:');

  const resumed = await cli.start(undefined, id);
  const resumedPage = await context.newPage();
  await resumedPage.goto(await resumed.url);
  await expect(resumedPage.locator('.kicker')).toHaveText('Plan · Round 1');
  await expect(resumedPage.locator('.doc-meta')).toContainText(id);
  await expect(resumedPage.locator('#card-rate-limit-store .answer')).toContainText('B · Postgres table keyed by email');
  await expect(resumedPage.locator('#card-rate-limit-store .note')).toHaveText(note);
  await resumedPage.getByRole('tab', { name: /Comments/ }).click();
  await expect(resumedPage.locator('.thread')).toHaveAttribute('id', thread!);
  await expect(resumedPage.locator('.thread .cmt p')).toHaveText(COMMENT);
  await submit(resumedPage, 'Request changes');
  const outcome = await resumed.waitForExit();
  expect(outcome.code).toBe(0);
  expect(outcome.stdout).toContain(`Review \`${id}\` · Round 1`);
  expect(outcome.stdout).toContain(COMMENT);
}

test('closing the tab pauses round 1 and restores its autosaved answer and thread on resume', async ({ page, context, cli }) => {
  const first = await cli.start();
  await page.goto(await first.url);
  await answerDecision(page, NOTE);
  const saved = progressSaved(page, hasComment);
  await addParagraphComment(page, COMMENT);
  await saved;
  await closeAndResume(page, context, cli, first);
});

test('closing immediately after commenting preserves the pending thread on resume', async ({ page, context, cli }) => {
  const first = await cli.start();
  await page.goto(await first.url);
  await blockAutosave(page);
  await answerDecision(page, NOTE);
  await addParagraphComment(page, COMMENT);
  expect(await persistedComments(cli)).not.toContain(COMMENT);
  await closeAndResume(page, context, cli, first);
});

test('closing right after commenting on oversized progress saves just the new comment', async ({ page, context, cli }) => {
  const first = await cli.start();
  await page.goto(await first.url);
  const note = `${NOTE} ${'x'.repeat(70_000)}`;
  const saved = progressSaved(page, (update) => update.answers['rate-limit-store']?.note === note);
  await answerDecision(page, note);
  // Over the 64 KiB keepalive cap, under the server's 1 MiB body limit.
  expect(Buffer.byteLength((await saved).postData()!)).toBeGreaterThan(65_536);

  await blockAutosave(page);
  await addParagraphComment(page, COMMENT);
  expect(await persistedComments(cli)).not.toContain(COMMENT);
  await closeAndResume(page, context, cli, first, note);
});
