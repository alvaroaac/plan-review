import { test, expect } from './helpers/cli.js';
import { addParagraphComment, answerDecision, submit } from './helpers/review.js';

test('answers a decision, defers another, and requests changes with a paragraph comment', async ({ page, cli }) => {
  const run = await cli.start();
  await page.goto(await run.url);
  await expect(page.locator('.doc-title')).toHaveText(/User Authentication System/);
  await answerDecision(page);

  const deferred = page.locator('#card-logout-scope');
  await deferred.getByRole('button', { name: 'Defer', exact: true }).click();
  await deferred.getByPlaceholder("What's needed first, or who should decide? (optional)").fill('Needs security-team input.');
  await deferred.locator('.defer-panel').getByRole('button', { name: 'Defer', exact: true }).click();
  await expect(deferred.locator('.answer')).toContainText('Deferred');
  await expect(page.locator('.stepper')).toContainText('1 of 4 answered · 1 deferred');

  const comment = 'Make the email index unique and verify it in the migration.';
  await addParagraphComment(page, comment);
  await submit(page, 'Request changes', 'Resolve the remaining security questions.');
  const outcome = await run.waitForExit();
  expect(outcome).toMatchObject({ code: 0, signal: null });
  expect(outcome.stdout).toContain('### `rate-limit-store` · Rate limit store — **B**: Postgres table keyed by email (your pick was A)');
  expect(outcome.stdout).toContain('### `logout-scope` · Logout scope — **Deferred**');
  expect(outcome.stdout).toContain('> Needs security-team input.');
  expect(outcome.stdout).toContain('**Changes requested**');
  expect(outcome.stdout).toContain('Resolve the remaining security questions.');
  expect(outcome.stdout).toContain('## Open threads');
  expect(outcome.stdout).toContain(`- **Reviewer:** ${comment}`);
  expect(outcome.stdout).toMatch(/--review rv_[0-9a-z]+/);
});
