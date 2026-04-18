#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline';
import chalk from 'chalk';
import { resolve as resolvePath } from 'node:path';
import { parse } from './parser.js';
import { navigate } from './navigator.js';
import { formatReview } from './formatter.js';
import { writeOutput, isClaudeAvailable } from './output.js';
import type { OutputTarget, ReviewComment } from './types.js';
import { HttpTransport } from './transport.js';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { loadSession, saveSession, clearSession, computeContentHash, listSessions, getSessionDir } from './session.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();

program
  .name('plan-review')
  .description('Interactive CLI for reviewing AI-generated markdown plans')
  .version(version)
  .argument('[file]', 'Path to markdown file (omit to read stdin)')
  .option('-o, --output <target>', 'Output target: stdout, clipboard, file, claude')
  .option('--output-file <path>', 'Custom output file path (with --output file)')
  .option('--split-by <strategy>', 'Force split strategy: heading, separator')
  .option('--fresh', 'Skip session resume, start clean review')
  .option('--no-browser', 'Use the terminal review UI instead of the browser (SSH/CI/headless)')
  .action(async (file: string | undefined, opts: { output?: string; outputFile?: string; splitBy?: string; browser?: boolean; fresh?: boolean }) => {
    try {
      await run(file, opts);
    } catch (err) {
      if (err instanceof Error) {
        const cancelled = err.message.startsWith('Review cancelled');
        console.error(cancelled ? chalk.yellow(err.message) : chalk.red(`Error: ${err.message}`));
      }
      process.exit(1);
    }
  });

program
  .command('install-skill')
  .description('Install Claude Code skill to ~/.claude/skills/plan-review/')
  .action(() => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = join(__dirname, '..', 'skills', 'plan-review', 'SKILL.md');
    if (!existsSync(src)) {
      console.error(chalk.red('Skill file not found in package. Expected at: ' + src));
      process.exit(1);
    }
    const dest = join(homedir(), '.claude', 'skills', 'plan-review');
    mkdirSync(dest, { recursive: true });
    copyFileSync(src, join(dest, 'SKILL.md'));
    console.error(chalk.green(`Skill installed to ${dest}/SKILL.md`));
    console.error(chalk.dim('Claude Code will auto-discover it. Try: "I want to review this plan"'));
  });

program
  .command('sessions')
  .description('List all saved review sessions')
  .action(() => {
    const sessions = listSessions();
    const dir = getSessionDir();
    if (sessions.length === 0) {
      console.error(chalk.dim(`No saved sessions. (${dir})`));
      process.exit(0);
    }
    console.error(chalk.bold(`Saved review sessions (${dir}):\n`));
    for (const s of sessions) {
      const age = formatRelativeTime(s.lastModified);
      let status = '';
      if (s.stale === true) status = chalk.yellow(' | plan file changed since last review');
      else if (s.stale === null) status = chalk.red(' | plan file not found');
      console.error(`  ${s.planPath}`);
      console.error(chalk.dim(`    ${s.commentCount} comment${s.commentCount !== 1 ? 's' : ''} | last modified ${age}${status}\n`));
    }
  });

program.parse();

async function run(
  file: string | undefined,
  opts: { output?: string; outputFile?: string; splitBy?: string; browser?: boolean; fresh?: boolean },
): Promise<void> {
  // Validate explicit output target early, before the review starts
  const validTargets: OutputTarget[] = ['stdout', 'clipboard', 'file', 'claude'];
  if (opts.output !== undefined) {
    const explicitTarget = opts.output as OutputTarget;
    if (!validTargets.includes(explicitTarget)) {
      throw new Error(`Invalid output target: "${opts.output}". Use: ${validTargets.join(', ')}`);
    }
    // Fail fast: check claude availability before starting review
    if (explicitTarget === 'claude' && !isClaudeAvailable()) {
      console.error(chalk.red('Claude CLI not found in PATH.'));
      console.error(chalk.dim('Install: https://docs.anthropic.com/en/docs/claude-code'));
      console.error(chalk.yellow('Will fall back to stdout after review.'));
    }
  }

  // Read input — track whether it came from stdin
  const inputFromStdin = !file && !process.stdin.isTTY;
  const input = readInput(file);
  if (!input.trim()) {
    console.error(chalk.yellow('Empty file, nothing to review.'));
    process.exit(0);
  }

  // Parse
  const splitStrategy = opts.splitBy === 'heading' ? 'heading' as const
    : opts.splitBy === 'separator' ? 'separator' as const
    : 'auto' as const;
  const doc = parse(input, splitStrategy);

  console.error(chalk.dim(`Detected mode: ${doc.mode} | ${doc.sections.length} sections`));

  // Session resume logic
  const absPath = file ? resolvePath(file) : null;
  const contentHash = computeContentHash(input);

  let restoredActiveSection: string | null = null;
  if (absPath) {
    if (opts.fresh) {
      clearSession(absPath);
    } else {
      const session = loadSession(absPath, contentHash);
      if (session && session.comments.length > 0) {
        if (!session.stale) {
          console.error(chalk.green(`Resuming review (${session.comments.length} comment${session.comments.length !== 1 ? 's' : ''}).`));
          doc.comments = session.comments;
          restoredActiveSection = session.activeSection;
        } else {
          // Prompt user for stale session
          const answer = await promptYesNo(
            `Plan file changed since last review (${session.comments.length} comment${session.comments.length !== 1 ? 's' : ''}). Resume anyway?`,
            inputFromStdin,
          );
          if (answer) {
            console.error(chalk.yellow('Resuming with stale session.'));
            doc.comments = session.comments;
            restoredActiveSection = session.activeSection;
          } else {
            clearSession(absPath);
          }
        }
      }
    }
  }

  // Navigate (interactive review or browser)
  let reviewed;
  if (opts.browser) {
    const transport = new HttpTransport();
    transport.sendDocument(doc);
    transport.setInitialActiveSection(restoredActiveSection);

    if (absPath) {
      transport.onSessionSave((comments, activeSection) => {
        saveSession(absPath, contentHash, comments, activeSection);
      });
    }

    const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — overall ceiling
    const HEARTBEAT_TIMEOUT_MS = 30 * 1000;  // 30s without a heartbeat while visible = browser gone
    const reviewPromise = new Promise<ReviewComment[]>((resolve, reject) => {
      const idleTimer = setTimeout(
        () => reject(new Error('Browser review timed out after 30 minutes of inactivity')),
        IDLE_TIMEOUT_MS,
      );
      let heartbeatTimer: NodeJS.Timeout | null = null;
      const armHeartbeat = (): void => {
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        heartbeatTimer = setTimeout(() => {
          clearTimeout(idleTimer);
          reject(new Error('Review cancelled: browser closed (heartbeat lost)'));
        }, HEARTBEAT_TIMEOUT_MS);
      };
      const clearAll = (): void => {
        clearTimeout(idleTimer);
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      };
      transport.onHeartbeat(armHeartbeat);
      transport.onPause(() => {
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      });
      transport.onCancel(() => {
        clearAll();
        reject(new Error('Review cancelled: browser closed'));
      });
      transport.onReviewSubmit((comments) => {
        clearAll();
        resolve(comments);
      });
    });

    const { url } = await transport.start(0);
    process.stderr.write(`Review server running at ${url}\n`);

    try {
      const openCmd = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start'
        : 'xdg-open';
      spawnSync(openCmd, [url], { stdio: 'ignore' });
    } catch {
      process.stderr.write(`Open ${url} in your browser\n`);
    }

    try {
      doc.comments = await reviewPromise;
    } finally {
      await transport.stop();
    }
    reviewed = doc;
  } else {
    const onCommentChange = absPath
      ? () => saveSession(absPath, contentHash, doc.comments, null)
      : undefined;
    reviewed = await navigate(doc, inputFromStdin, onCommentChange);
  }

  // Clear session after successful review completion
  if (absPath) clearSession(absPath);

  // Determine output target after review is complete
  let outputTarget: OutputTarget;
  if (opts.output !== undefined) {
    outputTarget = opts.output as OutputTarget;
  } else {
    outputTarget = await promptOutputTarget(inputFromStdin);
    // Check claude availability after prompting
    if (outputTarget === 'claude' && !isClaudeAvailable()) {
      console.error(chalk.red('Claude CLI not found in PATH.'));
      console.error(chalk.dim('Install: https://docs.anthropic.com/en/docs/claude-code'));
      console.error(chalk.yellow('Falling back to stdout.'));
      outputTarget = 'stdout';
    }
  }

  // Format and output
  const output = formatReview(reviewed);
  writeOutput(output, outputTarget, { outputFile: opts.outputFile, inputFile: file });
}

async function promptOutputTarget(inputFromStdin: boolean): Promise<OutputTarget> {
  const ttyInput = inputFromStdin
    ? (await import('node:fs')).createReadStream('/dev/tty')
    : process.stdin;

  const rl = readline.createInterface({
    input: ttyInput,
    output: process.stderr,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      chalk.cyan('> Output: (s)tdout, (c)lipboard, (f)ile, cl(a)ude? '),
      (a) => resolve(a.trim().toLowerCase()),
    );
  });
  rl.close();

  switch (answer) {
    case 's': case 'stdout': return 'stdout';
    case 'c': case 'clipboard': return 'clipboard';
    case 'f': case 'file': return 'file';
    case 'a': case 'claude': return 'claude';
    default: return 'stdout';
  }
}

async function promptYesNo(message: string, inputFromStdin: boolean): Promise<boolean> {
  const ttyInput = inputFromStdin
    ? (await import('node:fs')).createReadStream('/dev/tty')
    : process.stdin;

  const rl = readline.createInterface({
    input: ttyInput,
    output: process.stderr,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.yellow(`${message} (y/n) `), (a) => resolve(a.trim().toLowerCase()));
  });
  rl.close();

  return answer === 'y' || answer === 'yes';
}

function readInput(file: string | undefined): string {
  if (file) {
    if (!existsSync(file)) {
      throw new Error(`File not found: ${file}`);
    }
    return readFileSync(file, 'utf-8');
  }

  // Read from stdin (piped)
  if (!process.stdin.isTTY) {
    return readFileSync('/dev/stdin', 'utf-8');
  }

  // No file, no stdin pipe — show help
  program.help();
  return ''; // unreachable
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
