import { expect, type Page } from '@playwright/test';

export async function answerDecision(page: Page, note = 'Use the existing shared database.'): Promise<void> {
  const card = page.locator('#card-rate-limit-store');
  // The radio is visually hidden; users select its containing option label.
  await card.locator('label.opt', { hasText: 'Postgres table keyed by email' }).click();
  await expect(card.getByRole('radio', { name: /Postgres table keyed by email/ })).toBeChecked();
  await card.getByPlaceholder('Rationale (optional)').fill(note);
  await card.getByRole('button', { name: 'Save decision', exact: true }).click();
  await expect(card.locator('.answer')).toContainText('B · Postgres table keyed by email');
}

export async function addParagraphComment(page: Page, body: string): Promise<void> {
  const paragraph = page.locator('.doc > section .para').filter({ hasText: 'Add an index on' });
  await paragraph.hover();
  await paragraph.getByRole('button', { name: 'Comment on this paragraph' }).click();
  await page.getByPlaceholder('Add a comment…').fill(body);
  await page.locator('.composer').getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.locator('.thread .cmt p')).toHaveText(body);
  await expect(page.locator('.thread .th-quote')).toContainText('Add an index on');
}

export async function openSubmit(page: Page, summary?: string): Promise<void> {
  await page.getByRole('button', { name: 'Submit review', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Submit review' })).toBeVisible();
  if (summary !== undefined) await page.getByPlaceholder('Summary for the agent (optional)').fill(summary);
}

export async function submit(page: Page, verdict: 'Request changes' | 'Approve', summary = ''): Promise<void> {
  await openSubmit(page, summary);
  await page.getByRole('button', { name: verdict, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review submitted', exact: true })).toBeVisible();
}
