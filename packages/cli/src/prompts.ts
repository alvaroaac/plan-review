import * as readline from 'node:readline';
import chalk from 'chalk';
import type { OutputTarget } from '@plan-review/core';

// When stdin is the piped plan, readline can't reuse it for prompts — open
// /dev/tty directly so the terminal still answers keystrokes.
async function ttyInputStream(inputFromStdin: boolean): Promise<NodeJS.ReadableStream> {
  return inputFromStdin
    ? (await import('node:fs')).createReadStream('/dev/tty')
    : process.stdin;
}

export async function promptOutputTarget(inputFromStdin: boolean): Promise<OutputTarget> {
  const rl = readline.createInterface({
    input: await ttyInputStream(inputFromStdin),
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

export async function promptYesNo(message: string, inputFromStdin: boolean): Promise<boolean> {
  const rl = readline.createInterface({
    input: await ttyInputStream(inputFromStdin),
    output: process.stderr,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.yellow(`${message} (y/n) `), (a) => resolve(a.trim().toLowerCase()));
  });
  rl.close();

  return answer === 'y' || answer === 'yes';
}
