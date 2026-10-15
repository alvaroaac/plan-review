import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
const entryPoint = join(projectRoot, 'src', 'index.ts');
let home: string;
const children: ChildProcess[] = [];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'plan-review-index-'));
  mkdirSync(join(home, 'bin'));
  for (const command of ['open', 'xdg-open', 'start']) {
    const path = join(home, 'bin', command);
    writeFileSync(path, '#!/bin/sh\nexit 0\n');
    chmodSync(path, 0o755);
  }
});
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  rmSync(home, { recursive: true, force: true });
});
function cliEnv() {
  return { ...process.env, PLAN_REVIEW_HOME: home, PATH: `${join(home, 'bin')}:${process.env.PATH}`, NO_COLOR: '1' };
}

async function startCli(args: string[], input?: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', entryPoint, ...args], {
    cwd: projectRoot, env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  let ready!: (url: string) => void;
  let failed!: (error: Error) => void;
  const url = new Promise<string>((resolve, reject) => { ready = resolve; failed = reject; });
  child.stdout.on('data', (data) => { stdout += data.toString(); });
  child.stderr.on('data', (data) => {
    stderr += data.toString();
    const match = stderr.match(/Review server running at (http:\/\/localhost:\d+)/);
    if (match) ready(match[1]);
  });
  const done = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on('close', (status) => {
      failed(new Error(`CLI exited before server startup: ${stderr}`));
      resolve({ status, stdout, stderr });
    });
  });
  child.on('error', failed);
  child.stdin.end(input);
  return { url: await url, done };
}


function runCli(args: string[], stdinData?: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync('npx', ['tsx', entryPoint, ...args], {
    cwd: projectRoot,
    encoding: 'utf-8',
    input: stdinData,
    env: { ...cliEnv(), ...env },
    timeout: 15000,
  });
}

describe('index.ts CLI', () => {
  it('--help exits with code 0 and mentions plan-review', () => {
    const result = runCli(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain('plan-review');
  });

  it('--help shows -o option without a default value', () => {
    const result = runCli(['--help']);
    expect(result.status).toBe(0);
    const helpText = result.stdout + result.stderr;
    expect(helpText).toContain('-o, --output <target>');
    // No "(default: stdout)" should appear since we removed the default
    expect(helpText).not.toContain('default: stdout');
  });

  it('--version outputs the version from package.json', () => {
    const result = runCli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it('exits 1 with "File not found" when file does not exist', () => {
    const result = runCli(['nonexistent.md']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('File not found');
  });

  it('exits 1 with "Invalid output target" for invalid -o value', () => {
    const fixtureFile = join(__dirname, 'fixtures', 'generic-document.md');
    const result = runCli(['-o', 'invalid', fixtureFile]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid output target');
  });

  it('--fresh flag is accepted without error', () => {
    // Force terminal mode here — the default browser mode would boot an HTTP
    // server and block this test waiting for a tab that never opens.
    const fixtureFile = join(__dirname, 'fixtures', 'generic-document.md');
    const result = runCli([fixtureFile, '--fresh', '--cli', '-o', 'stdout'], 'done\n');
    expect(result.stderr).not.toContain('unknown option');
  });

  it('--cli opt-out is recognised (default is browser)', () => {
    const result = runCli(['--help']);
    const helpText = result.stdout + result.stderr;
    expect(helpText).toContain('--cli');
    // The old --browser flag was opt-in; the new default is browser mode, so
    // the help should NOT advertise --browser as an option any more.
    expect(helpText).not.toMatch(/^\s*--browser\s/m);
  });

  it('--help advertises --review, --fresh and list', () => {
    const result = runCli(['--help']);
    expect(result.stdout).toContain('--review <id>');
    expect(result.stdout).toContain('--fresh');
    expect(result.stdout).toContain('list');
  });

  it.each(['-', undefined])('accepts stdin input with %s and pauses on stdout despite -o file', async (file) => {
    const outputFile = join(home, 'review.md');
    const { url, done } = await startCli([...(file ? [file] : []), '-o', 'file', '--output-file', outputFile], '# Piped plan\n\n## Section\nBody');
    const loaded = await (await fetch(`${url}/api/doc`)).json();
    const saved = JSON.parse(readFileSync(join(home, 'reviews', `${loaded.review.id}.json`), 'utf8'));
    expect(saved.planPath).toBeUndefined();
    expect((await fetch(`${url}/api/cancel`, { method: 'POST' })).status).toBe(204);
    const result = await done;
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Review \`${loaded.review.id}\` paused at round 1`);
    expect(result.stderr).not.toContain('Review cancelled');
    expect(existsSync(outputFile)).toBe(false);
  });

  it('normalizes the file path and forwards --fresh to review resolution', async () => {
    const { FileReviewStore, openReview } = await import('@plan-review/core');
    const path = join(home, 'plan.md');
    writeFileSync(path, '# Plan\n\n## Section\nBody');
    const store = new FileReviewStore({ dir: join(home, 'reviews') });
    const opened = await openReview(store, { markdown: readFileSync(path, 'utf8'), planPath: path, now: new Date('2026-10-15T12:00:00Z') });
    const relative = (await import('node:path')).relative(projectRoot, path);
    for (const fresh of [false, true]) {
      const { url, done } = await startCli([relative, '-o', 'stdout', ...(fresh ? ['--fresh'] : [])]);
      const loaded = await (await fetch(`${url}/api/doc`)).json();
      expect(loaded.review.id === opened.review.id).toBe(!fresh);
      expect((await store.get(loaded.review.id))?.planPath).toBe(path);
      await fetch(`${url}/api/cancel`, { method: 'POST' });
      expect((await done).status).toBe(0);
    }
  });

  it.each(['unknown', 'approved'] as const)('--review %s exits 1 with the core error before server startup', async (state) => {
    const { FileReviewStore, openReview, submitRound } = await import('@plan-review/core');
    const store = new FileReviewStore({ dir: join(home, 'reviews') });
    let id = 'rv_missing';
    if (state === 'approved') {
      const opened = await openReview(store, { markdown: '# Plan', now: new Date('2026-10-15T12:00:00Z') });
      id = opened.review.id;
      await submitRound(store, id, { verdict: 'approved', summary: '' }, new Date('2026-10-15T12:00:00Z'));
    }
    const result = runCli(['-', '--review', id, '-o', 'stdout'], '# Plan');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(state === 'unknown' ? `Review ${id} not found` : `Review ${id} is approved; run without --review to start a new review`);
    expect(result.stderr).not.toContain('Review server running');
  });

  it.each(['stdout', 'file', 'clipboard', 'claude'])('routes submitted output to %s and exits 0', async (target) => {
    const outputFile = join(home, 'output.md');
    for (const command of ['pbcopy', 'xclip', 'clip', 'claude']) {
      const path = join(home, 'bin', command);
      writeFileSync(path, `#!/bin/sh\ncat > '${outputFile}'\n`);
      chmodSync(path, 0o755);
    }
    const { url, done } = await startCli(['-', '-o', target, '--output-file', outputFile], '# Submitted plan');
    const response = await fetch(`${url}/api/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'approved', summary: 'Ready.' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const result = await done;
    expect(result.status).toBe(0);
    const output = target === 'stdout' ? result.stdout.trimEnd() : readFileSync(outputFile, 'utf8');
    expect(output).toBe(body.output);
    expect(output).toContain('**Approved**');
    if (target !== 'stdout') expect(result.stdout).toBe('');
  });
});
