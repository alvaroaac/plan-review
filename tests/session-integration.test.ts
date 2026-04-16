import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'plan-review-integration-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual('node:os');
  return { ...actual, homedir: () => testDir };
});

import { saveSession, loadSession, clearSession, computeContentHash, listSessions } from '../src/session.js';

describe('session integration', () => {
  const planPath = '/tmp/integration-test-plan.md';
  const planContent = '# Test Plan\n\n## Task 1\n\nDo something.';
  const hash = computeContentHash(planContent);

  it('full round-trip: save → load → modify → load stale → clear', () => {
    const comments = [
      { sectionId: '1.1', text: 'Fix this', timestamp: new Date() },
      { sectionId: '1.2', text: 'Check that', timestamp: new Date() },
    ];
    saveSession(planPath, hash, comments, '1.1');

    // Load — not stale
    const result = loadSession(planPath, hash);
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(false);
    expect(result!.comments).toHaveLength(2);
    expect(result!.activeSection).toBe('1.1');

    // Load with different hash — stale
    const staleResult = loadSession(planPath, computeContentHash('modified plan'));
    expect(staleResult).not.toBeNull();
    expect(staleResult!.stale).toBe(true);
    expect(staleResult!.comments).toHaveLength(2);

    // List
    const sessions = listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].commentCount).toBe(2);

    // Clear
    clearSession(planPath);
    expect(loadSession(planPath, hash)).toBeNull();
    expect(listSessions()).toHaveLength(0);
  });

  it('same file at two paths = two independent sessions', () => {
    const path1 = '/tmp/plan-copy-1.md';
    const path2 = '/tmp/plan-copy-2.md';
    saveSession(path1, hash, [{ sectionId: '1.1', text: 'A', timestamp: new Date() }], null);
    saveSession(path2, hash, [{ sectionId: '2.1', text: 'B', timestamp: new Date() }], null);

    const s1 = loadSession(path1, hash);
    const s2 = loadSession(path2, hash);
    expect(s1!.comments[0].text).toBe('A');
    expect(s2!.comments[0].text).toBe('B');
    expect(listSessions()).toHaveLength(2);
  });

  it('auto-save overwrites previous session', () => {
    saveSession(planPath, hash, [{ sectionId: '1.1', text: 'First', timestamp: new Date() }], null);
    saveSession(planPath, hash, [
      { sectionId: '1.1', text: 'First', timestamp: new Date() },
      { sectionId: '1.2', text: 'Second', timestamp: new Date() },
    ], '1.2');

    const result = loadSession(planPath, hash);
    expect(result!.comments).toHaveLength(2);
    expect(result!.activeSection).toBe('1.2');
  });
});
