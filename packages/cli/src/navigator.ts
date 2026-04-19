import * as readline from 'node:readline';
import chalk from 'chalk';
import type { PlanDocument, ReviewComment, Section } from '@plan-review/core';
import { renderSection, renderToc } from './renderer.js';

export async function navigate(doc: PlanDocument, inputFromStdin: boolean = false, onCommentChange?: () => void): Promise<PlanDocument> {
  // When input was read from stdin, stdin is exhausted.
  // Open /dev/tty directly for interactive prompts.
  const ttyInput = inputFromStdin
    ? (await import('node:fs')).createReadStream('/dev/tty')
    : process.stdin;

  const rl = readline.createInterface({
    input: ttyInput,
    output: process.stderr,
  });

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer.trim()));
    });

  const reviewableSections = getReviewableSections(doc);

  let running = true;

  while (running) {
    console.error(renderToc(doc));
    const input = await ask(
      chalk.cyan('> Enter section (e.g. 1.1), \'all\' for linear review, or \'done\' to finish: '),
    );

    if (input === 'done' || input === 'q') {
      running = false;
    } else if (input === 'all') {
      await linearReview(doc, reviewableSections, ask, onCommentChange);
    } else {
      const section = findSection(doc, input);
      if (section) {
        const startIdx = reviewableSections.indexOf(section);
        await linearReview(doc, reviewableSections.slice(startIdx), ask, onCommentChange);
      } else {
        console.error(chalk.red(`Section "${input}" not found. Try again.`));
      }
    }
  }

  rl.close();
  printSummary(doc);
  return doc;
}

async function linearReview(
  doc: PlanDocument,
  sections: Section[],
  ask: (prompt: string) => Promise<string>,
  onCommentChange?: () => void,
): Promise<void> {
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    console.error(renderSection(section));

    const input = await ask(
      chalk.cyan('> Comment (enter to skip, \'toc\' for menu, \'back\' for previous): '),
    );

    if (input === 'toc') {
      return;
    } else if (input === 'back') {
      i -= (i > 0) ? 2 : 1; // -2 to go back (loop increments), -1 to re-show current
      continue;
    } else if (input !== '') {
      doc.comments.push({
        sectionId: section.id,
        text: input,
        timestamp: new Date(),
      });
      onCommentChange?.();
    }
  }
}

export function findSection(doc: PlanDocument, input: string): Section | undefined {
  // Try exact ID match first
  const byId = doc.sections.find((s) => s.id === input);
  if (byId) return byId;

  // Try numeric index for generic mode
  const num = parseInt(input, 10);
  if (!isNaN(num)) {
    const reviewable = getReviewableSections(doc);
    if (num >= 1 && num <= reviewable.length) {
      return reviewable[num - 1];
    }
  }

  return undefined;
}

export function getReviewableSections(doc: PlanDocument): Section[] {
  return doc.sections.filter((s) =>
    doc.mode === 'plan' ? s.level === 3 : s.level >= 2,
  );
}

export function printSummary(doc: PlanDocument): void {
  const reviewable = getReviewableSections(doc);
  const commentedIds = new Set(doc.comments.map((c) => c.sectionId));

  console.error('');
  console.error(chalk.bold('Review Summary'));
  console.error(`  Sections: ${reviewable.length}`);
  console.error(`  Commented: ${chalk.green(String(commentedIds.size))}`);
  console.error(`  Skipped: ${chalk.dim(String(reviewable.length - commentedIds.size))}`);
  console.error(`  Total comments: ${doc.comments.length}`);
  console.error('');
}
