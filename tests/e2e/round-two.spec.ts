import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, DEMO_PLAN, reviewId, threadId } from './helpers/cli.js';
import { addParagraphComment, answerDecision, submit } from './helpers/review.js';

test('round 2 reopens an edited decision and carries the agent reply into its thread', async ({ page, cli }) => {
  const plan = join(cli.home, 'plan.md');
  await copyFile(DEMO_PLAN, plan);
  const first = await cli.start(plan);
  await page.goto(await first.url);
  await answerDecision(page);
  const comment = 'Explain how the email index prevents duplicate registration.';
  await addParagraphComment(page, comment);
  await submit(page, 'Request changes');
  const roundOne = await first.waitForExit();
  expect(roundOne.code).toBe(0);
  const id = reviewId(roundOne.stdout);
  const thread = threadId(roundOne.stdout);

  const question = 'Which shared store should hold login attempt counters across API instances?';
  const reply = 'The email index is unique, so concurrent duplicate registrations are rejected.';
  const original = await readFile(plan, 'utf8');
  expect(original).toContain('question: Where should login attempt counters live?');
  await writeFile(plan, original.replace('question: Where should login attempt counters live?', `question: ${question}`)
    + `\n\n\`\`\`reply thread=${thread}\n${reply}\n\`\`\`\n`);

  const second = await cli.start(plan, id);
  await page.goto(await second.url);
  await expect(page.locator('.kicker')).toHaveText('Plan · Round 2');
  await expect(page.locator('.doc-meta')).toContainText(id);
  const card = page.locator('#card-rate-limit-store');
  await expect(card.locator('.ic-changed')).toHaveText('changed since you answered');
  await expect(card.locator('.ic-q')).toHaveText(question);
  await expect(card.locator('.answer.is-prior')).toContainText('B · Postgres table keyed by email');
  await expect(card.getByRole('button', { name: 'Save decision' })).toBeDisabled();
  await page.getByRole('tab', { name: /Comments/ }).click();
  const carried = page.locator(`#th-${thread}`);
  await expect(carried.locator('.cmt p').first()).toHaveText(comment);
  await expect(carried.locator('.is-agent .cmt-meta b')).toHaveText('Agent');
  await expect(carried.locator('.is-agent p')).toHaveText(reply);
  await expect(carried).not.toHaveClass(/is-outdated/);
  await expect(page.locator('.doc')).not.toContainText(reply);
  await submit(page, 'Request changes');
  const roundTwo = await second.waitForExit();
  expect(roundTwo.code).toBe(0);
  expect(roundTwo.stdout).toContain(`Review \`${id}\` · Round 2`);
  expect(roundTwo.stdout).toContain('Rate limit store — *Unanswered* (plan changed since your answer)');
  expect(roundTwo.stdout).toContain(`- **Agent:** ${reply}`);
});
