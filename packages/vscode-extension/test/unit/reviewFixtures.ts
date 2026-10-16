import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileReviewStore, type Answer, type Thread } from '@plan-review/core';

export const markdown = '# Plan\n\n## Design\n\nOriginal text.\n\n```decision id=storage\nquestion: Where to store?\n- A: Files\n- B: Database\n```\n';
export const now = new Date('2026-10-15T12:00:00.000Z');
export const answer: Answer = { choice: 'A', note: 'Simple', itemHash: 'hash', round: 1, updatedAt: now.toISOString() };
export function thread(sectionId: string): Thread {
  return {
    id: 't_abc123', sectionId,
    anchor: { type: 'lines', startLine: 0, endLine: 0, lineTexts: ['Original text.'] },
    resolved: false, outdated: false, createdRound: 1,
    comments: [{ id: 'c_abcdefgh', author: 'reviewer', body: 'Please clarify', createdAt: now.toISOString() }],
  };
}
export async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'pr-vscode-'));
  return { dir, planFsPath: join(dir, 'plan.md'), store: new FileReviewStore({ dir: join(dir, 'reviews') }), cleanup: () => rm(dir, { recursive: true, force: true }) };
}
