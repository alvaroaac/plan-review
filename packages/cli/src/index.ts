import { Command } from 'commander';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import {
  parse,
  formatReview,
  extractItems,
  itemCounts,
} from '@plan-review/core';
import type { OutputTarget } from '@plan-review/core';
import { navigate } from './navigator.js';
import { writeOutput, isClaudeAvailable } from './output.js';
import { createRequire } from 'node:module';
import { promptOutputTarget } from './prompts.js';
import { browserReview, createReviewStore } from './browser-review.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();
interface ReviewOptions {
  output?: string;
  outputFile?: string;
  splitBy?: string;
  cli?: boolean;
  fresh?: boolean;
  review?: string;
}

program
  .name('plan-review')
  .description('Interactive CLI for reviewing AI-generated markdown plans')
  .version(version)
  .argument('[file]', 'Path to markdown file (omit to read stdin)')
  .option('-o, --output <target>', 'Output target: stdout, clipboard, file, claude')
  .option('--output-file <path>', 'Custom output file path (with --output file)')
  .option('--split-by <strategy>', 'Force split strategy: heading, separator')
  .option('--review <id>', 'Resume a review by id')
  .option('--fresh', 'Start a new review even if one is open for this file')
  .option('--cli', 'Use the terminal review UI instead of the browser (SSH/CI/headless)')
  .action(async (file: string | undefined, opts: ReviewOptions) => {
    try {
      await run(file, opts);
    } catch (err) {
      if (err instanceof Error) {
        console.error(chalk.red(`Error: ${err.message}`));
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
  .command('list')
  .alias('sessions')
  .description('List saved reviews')
  .option('--all', 'Include approved reviews')
  .action(async (opts: { all?: boolean }) => {
    const reviews = await createReviewStore().list(opts.all ? undefined : { status: 'open' });
    if (reviews.length === 0) {
      process.stdout.write('No open reviews.\n');
      return;
    }
    const rows = reviews.map((review) => {
      const round = review.rounds[review.rounds.length - 1];
      const { items } = extractItems(parse(round.plan));
      const { decisions: d, assumptions: a } = itemCounts(items, review.answers);
      const answered = d.answered + a.holds + a.unsure + a.no;
      const counts = `${answered}/${d.deferred + a.deferred}/${d.open + a.open}`;
      return [review.id, review.title, String(round.n), review.updatedAt, counts,
        ...(opts.all ? [review.status] : [])];
    });
    const header = ['ID', 'TITLE', 'ROUND', 'UPDATED', 'ANSWERED/DEFERRED/OPEN',
      ...(opts.all ? ['STATUS'] : [])];
    const widths = header.map((label, index) => Math.max(label.length, ...rows.map((row) => row[index].length)));
    for (const row of [header, ...rows]) {
      process.stdout.write(row.map((value, index) => value.padEnd(widths[index])).join('  ').trimEnd() + '\n');
    }
  });

program.parse();

async function run(
  file: string | undefined,
  opts: ReviewOptions,
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
  const inputFromStdin = (!file || file === '-') && !process.stdin.isTTY;
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

  let output: string;
  if (!opts.cli) {
    const result = await browserReview({
      markdown: input,
      ...(file && file !== '-' ? { planPath: resolvePath(file) } : {}),
      reviewId: opts.review,
      fresh: opts.fresh,
      splitBy: splitStrategy,
    });
    if (result.kind === 'paused') {
      process.stdout.write(result.output + '\n');
      return;
    }
    output = result.output;
  } else {
    const reviewed = await navigate(doc, inputFromStdin);
    output = formatReview(reviewed, { verdict: null, summary: '' });
  }

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
  writeOutput(output, outputTarget, { outputFile: opts.outputFile, inputFile: file === '-' ? undefined : file });
}

function readInput(file: string | undefined): string {
  if (file && file !== '-') {
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
