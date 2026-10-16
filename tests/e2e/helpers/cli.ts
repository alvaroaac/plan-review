import { test as base, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const DEMO_PLAN = join(ROOT, 'examples', 'demo-plan.md');

export interface CliOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export class CliRun {
  private stdout = '';
  private stderr = '';
  private closed = false;
  private readonly outcome: Promise<CliOutcome>;
  readonly url: Promise<string>;

  constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => { this.stdout += chunk; });
    child.stderr!.setEncoding('utf8').on('data', (chunk: string) => { this.stderr += chunk; });
    this.outcome = new Promise((resolve) => {
      child.once('close', (code, signal) => {
        this.closed = true;
        resolve({ code, signal, stdout: this.stdout, stderr: this.stderr });
      });
    });
    this.url = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CLI URL timed out: ${this.stderr}`)), 15_000);
      const onData = () => {
        const match = this.stderr.match(/http:\/\/[^\s]+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      };
      child.stderr!.on('data', onData);
      child.once('error', (err) => { clearTimeout(timer); reject(err); });
      child.once('close', () => {
        clearTimeout(timer);
        child.stderr!.off('data', onData);
        reject(new Error(`CLI exited before opening: ${this.stderr}`));
      });
    });
  }

  async waitForExit(): Promise<CliOutcome> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.outcome,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`CLI did not exit: ${this.stderr}`)), 10_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 2_000);
    try { await this.outcome; } finally { clearTimeout(timer); }
  }
}

export class CliHarness {
  private readonly runs: CliRun[] = [];

  constructor(readonly home: string) {}

  async start(plan = DEMO_PLAN, reviewId?: string): Promise<CliRun> {
    const args = [join(ROOT, 'packages', 'cli', 'dist', 'index.js'), plan, '-o', 'stdout'];
    if (reviewId) args.push('--review', reviewId);
    const run = new CliRun(spawn(process.execPath, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        PLAN_REVIEW_HOME: this.home,
        PATH: `${join(this.home, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    this.runs.push(run);
    await run.url;
    return run;
  }

  async dispose(): Promise<void> {
    await Promise.all(this.runs.map((run) => run.stop()));
    await rm(this.home, { recursive: true, force: true });
  }
}

export const test = base.extend<{ cli: CliHarness }>({
  cli: async ({}, use) => {
    const home = await mkdtemp(join(tmpdir(), 'plan-review-e2e-'));
    const cli = new CliHarness(home);
    try {
      await mkdir(join(home, 'bin'));
      for (const command of ['open', 'xdg-open']) {
        await writeFile(join(home, 'bin', command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      }
      await use(cli);
    } finally {
      await cli.dispose();
    }
  },
});

export { expect };

export function reviewId(stdout: string): string {
  const match = stdout.match(/Review `(rv_[0-9a-z]+)`/);
  expect(match, stdout).not.toBeNull();
  return match![1];
}

export function threadId(stdout: string): string {
  const match = stdout.match(/### `(t_[0-9a-z]+)`/);
  expect(match, stdout).not.toBeNull();
  return match![1];
}
