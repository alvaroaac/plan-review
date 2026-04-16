import { execSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import type { OutputTarget } from './types.js';

export function writeOutput(
  content: string,
  target: OutputTarget,
  options: { outputFile?: string; inputFile?: string } = {},
): void {
  switch (target) {
    case 'stdout':
      process.stdout.write(content + '\n');
      break;
    case 'clipboard':
      writeToClipboard(content);
      break;
    case 'file':
      writeToFile(content, options.outputFile, options.inputFile);
      break;
    case 'claude':
      sendToClaude(content);
      break;
  }
}

function writeToClipboard(content: string): void {
  const cmd = getClipboardCommand(process.platform);
  if (!cmd) {
    console.error(chalk.yellow('Clipboard not supported on this platform. Falling back to stdout.'));
    process.stdout.write(content + '\n');
    return;
  }

  try {
    execSync(cmd, { input: content, stdio: ['pipe', 'ignore', 'ignore'] });
    console.error(chalk.green('Review copied to clipboard.'));
  } catch {
    console.error(chalk.yellow('Failed to copy to clipboard. Falling back to stdout.'));
    process.stdout.write(content + '\n');
  }
}

function writeToFile(content: string, outputFile?: string, inputFile?: string): void {
  const filePath = outputFile
    ? resolve(outputFile)
    : inputFile
      ? resolve(inputFile.replace(/\.md$/, '.review.md'))
      : resolve('review.md');

  try {
    writeFileSync(filePath, content, 'utf-8');
    console.error(chalk.green(`Review written to ${filePath}`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Failed to write file: ${msg}`));
    console.error(chalk.yellow('Falling back to stdout.'));
    process.stdout.write(content + '\n');
  }
}

function sendToClaude(content: string): void {
  if (!isClaudeAvailable()) {
    console.error(
      chalk.red('Claude CLI not found in PATH.'),
    );
    console.error(chalk.dim('Install: https://docs.anthropic.com/en/docs/claude-code'));
    console.error(chalk.yellow('Falling back to stdout.'));
    process.stdout.write(content + '\n');
    return;
  }

  const child = spawn('claude', [], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  child.stdin.write(content);
  child.stdin.end();
  child.on('error', (err) => {
    console.error(chalk.yellow(`Failed to pipe to claude: ${err.message}. Falling back to stdout.`));
    process.stdout.write(content + '\n');
  });
}

export function getClipboardCommand(platform: string): string | null {
  switch (platform) {
    case 'darwin':
      return 'pbcopy';
    case 'linux':
      return 'xclip -selection clipboard';
    case 'win32':
      return 'clip';
    default:
      return null;
  }
}

export function isClaudeAvailable(): boolean {
  try {
    execSync('which claude', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
