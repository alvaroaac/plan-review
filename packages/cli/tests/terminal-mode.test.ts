import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entryPoint = join(projectRoot, 'src', 'index.ts');
const planWithItems = '# Plan\n\n## Storage\n\n```decision id=db\nquestion: Which db?\n- A: Postgres [pick]\n- B: SQLite\n```\n';
let home: string;
let planFile: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plan-review-terminal-'));
  planFile = join(home, 'plan.md');
  writeFileSync(planFile, planWithItems);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function runCli(args: string[], input: string) {
  return spawnSync('npx', ['tsx', entryPoint, planFile, '--cli', '-o', 'stdout', ...args], {
    cwd: projectRoot,
    encoding: 'utf-8',
    input,
    env: { ...process.env, PLAN_REVIEW_HOME: home, NO_COLOR: '1' },
    timeout: 15000,
  });
}

describe('terminal mode on v2 reviews', () => {
  it('prints review id, round and the unanswered line before the footer', () => {
    const result = runCli([], 'done\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Review `rv_\w+` · Round 1 · \*\*Changes requested\*\*/);
    expect(result.stdout).toContain('1 decisions/assumptions unanswered (answer them in browser mode)');
    expect(result.stdout.indexOf('unanswered (answer')).toBeLessThan(result.stdout.indexOf('**Next:**'));
  });

  it("maps 'approve' to an approved verdict", () => {
    const result = runCli([], 'approve\n');
    expect(result.stdout).toContain('· **Approved**');
  });

  it('fails on an unknown --review id', () => {
    const result = runCli(['--review', 'rv_nope'], 'done\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not found');
  });
});
