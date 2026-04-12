#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import * as readline from 'node:readline';
import chalk from 'chalk';
import { parse } from './parser.js';
import { navigate } from './navigator.js';
import { formatReview } from './formatter.js';
import { writeOutput, isClaudeAvailable } from './output.js';
import type { OutputTarget } from './types.js';

const program = new Command();

program
  .name('plan-review')
  .description('Interactive CLI for reviewing AI-generated markdown plans')
  .version('0.1.0')
  .argument('[file]', 'Path to markdown file (omit to read stdin)')
  .option('-o, --output <target>', 'Output target: stdout, clipboard, file, claude')
  .option('--output-file <path>', 'Custom output file path (with --output file)')
  .option('--split-by <strategy>', 'Force split strategy: heading, separator')
  .action(async (file: string | undefined, opts: { output?: string; outputFile?: string; splitBy?: string }) => {
    try {
      await run(file, opts);
    } catch (err) {
      if (err instanceof Error) {
        console.error(chalk.red(`Error: ${err.message}`));
      }
      process.exit(1);
    }
  });

program.parse();

async function run(
  file: string | undefined,
  opts: { output?: string; outputFile?: string; splitBy?: string },
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

  // Navigate (interactive review)
  // When input came from stdin, navigator opens /dev/tty for prompts
  const reviewed = await navigate(doc, inputFromStdin);

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
