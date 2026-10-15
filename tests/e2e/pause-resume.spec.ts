import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, reviewId, type CliHarness } from './helpers/cli.js';
import { addParagraphComment, answerDecision, submit } from './helpers/review.js';

async function pauseAndResume(page: Page, context: BrowserContext, cli: CliHarness, waitForAutosave: boolean): Promise<void> {
  const first = await cli.start();
  await page.goto(await first.url);
  await answerDecision(page);
  const comment = 'Keep this migration comment when the tab closes.';
  const saved = waitForAutosave ? page.waitForResponse((response) => {
    if (!response.url().endsWith('/api/session') || response.request().method() !== 'PUT') return false;
    const update = response.request().postDataJSON();
    return response.ok() && update.threads.some((thread: { comments: { body: string }[] }) =>
      thread.comments.some((entry) => entry.body === comment));
  }) : undefined;
  await addParagraphComment(page, comment);
  if (saved) await saved;
  const thread = await page.locator('.thread').getAttribute('id');

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
  await expect(resumedPage.locator('#card-rate-limit-store .note')).toHaveText('Use the existing shared database.');
  await resumedPage.getByRole('tab', { name: /Comments/ }).click();
  await expect(resumedPage.locator('.thread')).toHaveAttribute('id', thread!);
  await expect(resumedPage.locator('.thread .cmt p')).toHaveText(comment);
  await submit(resumedPage, 'Request changes');
  const outcome = await resumed.waitForExit();
  expect(outcome.code).toBe(0);
  expect(outcome.stdout).toContain(`Review \`${id}\` · Round 1`);
  expect(outcome.stdout).toContain(comment);
}

test('closing the tab pauses round 1 and restores its autosaved answer and thread on resume', async ({ page, context, cli }) => {
  await pauseAndResume(page, context, cli, true);
});

test.fixme('closing immediately after commenting preserves the pending thread on resume', async ({ page, context, cli }) => {
  // Bug: beforeunload can flush stale progress, losing a just-posted thread before the 500 ms autosave.
  await pauseAndResume(page, context, cli, false);
});
