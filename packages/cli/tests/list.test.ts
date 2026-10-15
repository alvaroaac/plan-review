import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { extractItems, FileReviewStore, openReview, parse, saveProgress, submitRound } from '@plan-review/core';

const root = resolve(import.meta.dirname, '..');
const now = new Date('2026-10-15T12:00:00.000Z');
const markdown = '# Older plan\n\n## Section\n\n```decision id=storage\nquestion: Which storage?\n- A: Files\n- B: Database\n```\n\n```assumption id=browser\nstatement: Browsers are supported.\n```\n\n```decision id=retry\nquestion: Retry?\n- A: Yes\n- B: No\n```';
let home: string;
let store: FileReviewStore;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plan-review-list-'));
  store = new FileReviewStore({ dir: join(home, 'reviews') });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));
const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src/index.ts'), ...args], {
  cwd: root, encoding: 'utf8', env: { ...process.env, PLAN_REVIEW_HOME: home, NO_COLOR: '1' }, timeout: 15000,
});

async function seed() {
  const older = await openReview(store, { markdown, now });
  const answers = Object.fromEntries(older.loaded.items.slice(0, 2).map((item, index) => [item.id, {
    choice: index === 0 ? 'A' : 'deferred', note: '', itemHash: item.hash, round: 1, updatedAt: now.toISOString(),
  }]));
  await saveProgress(store, older.review.id, { answers, threads: [] }, now, new Set(older.loaded.items.map((item) => item.id)));
  const newer = await openReview(store, { markdown: '# Newer plan', now: new Date('2026-10-15T13:00:00Z') });
  const approved = await openReview(store, { markdown: '# Approved plan', now: new Date('2026-10-15T14:00:00Z') });
  await submitRound(store, approved.review.id, { verdict: 'approved', summary: '' }, new Date('2026-10-15T14:01:00Z'));
  return { older, newer, approved };
}

describe('list command', () => {
  it('prints No open reviews. when the review store is empty', () => {
    const result = run(['list']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('No open reviews.');
  });

  it('lists open reviews newest first with id, title, round, timestamp and item counts', async () => {
    const { older, newer, approved } = await seed();
    const result = run(['list']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/ID\s+TITLE\s+ROUND\s+UPDATED\s+ANSWERED\/DEFERRED\/OPEN/);
    expect(result.stdout).not.toContain('STATUS');
    expect(result.stdout).not.toContain(approved.review.id);
    expect(result.stdout.indexOf(newer.review.id)).toBeLessThan(result.stdout.indexOf(older.review.id));
    expect(result.stdout).toMatch(new RegExp(`${older.review.id}\\s+Older plan\\s+1\\s+${now.toISOString()}\\s+1/1/1`));
  });

  it('--all includes approved reviews and a STATUS column', async () => {
    const { approved, newer } = await seed();
    const result = run(['list', '--all']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('STATUS');
    expect(result.stdout).toContain('approved');
    expect(result.stdout).toContain('open');
    expect(result.stdout.indexOf(approved.review.id)).toBeLessThan(result.stdout.indexOf(newer.review.id));
  });

  it('uses only the last round items, excludes removed answers and treats changed answers as open', async () => {
    const { older } = await seed();
    await submitRound(store, older.review.id, { verdict: 'changes_requested', summary: '' }, now);
    const lastPlan = '# Older plan\n\n## Section\n\n```decision id=storage\nquestion: Which NEW storage?\n- A: Files\n- B: Database\n```\n\n```assumption id=current\nstatement: Current assumption.\n```';
    await openReview(store, { markdown: lastPlan, reviewId: older.review.id, now: new Date('2026-10-15T15:00:00Z') });
    const result = run(['list']);
    expect(result.stdout).toMatch(new RegExp(`${older.review.id}\\s+Older plan\\s+2\\s+\\S+\\s+0/0/2`));
    // All three assumption verdicts count as answered.
    const item = extractItems(parse(lastPlan)).items[1];
    const review = (await store.get(older.review.id))!;
    await saveProgress(store, review.id, { answers: { ...review.answers, current: { choice: 'no', note: '', itemHash: item.hash, round: 2, updatedAt: now.toISOString() } }, threads: [] }, new Date('2026-10-15T15:00:00Z'), new Set(extractItems(parse(lastPlan)).items.map((item) => item.id)));
    expect(run(['list']).stdout).toMatch(new RegExp(`${older.review.id}\\s+Older plan\\s+2\\s+\\S+\\s+1/0/1`));
  });

  it('sessions is an alias of list, including --all, and ignores legacy session files', async () => {
    mkdirSync(join(home, 'sessions'));
    writeFileSync(join(home, 'sessions', 'old.json'), JSON.stringify({ version: 1, planPath: '/old/plan.md', comments: [], lastModified: now.toISOString() }));
    expect(run(['sessions']).stdout.trim()).toBe('No open reviews.');
    await seed();
    expect(run(['sessions']).stdout).toBe(run(['list']).stdout);
    expect(run(['sessions', '--all']).stdout).toBe(run(['list', '--all']).stdout);
  });
});
