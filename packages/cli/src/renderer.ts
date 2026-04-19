import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';
import type { Section, PlanDocument } from '@plan-review/core';

marked.use(markedTerminal());

export function renderSection(section: Section): string {
  const parts: string[] = [];

  if (section.level === 3 && section.dependencies) {
    parts.push(renderMetadataHeader(section));
    parts.push('');
  }

  const heading = `${'#'.repeat(section.level)} ${section.heading}`;
  const body = section.body || '';
  const markdown = `${heading}\n\n${body}`;
  parts.push(marked.parse(markdown) as string);

  return parts.join('\n');
}

function renderMetadataHeader(section: Section): string {
  const deps = section.dependencies!;
  const dependsOn = deps.dependsOn.length > 0 ? deps.dependsOn.join(', ') : '(none)';
  const blocks = deps.blocks.length > 0 ? deps.blocks.join(', ') : '(none)';

  const lines: string[] = [
    `Task ${section.id}: ${section.heading}`,
    `← Depends on: ${dependsOn}`,
    `→ Blocks: ${blocks}`,
  ];

  if (section.relatedFiles && section.relatedFiles.length > 0) {
    const fileList =
      section.relatedFiles.length <= 2
        ? section.relatedFiles.join(', ')
        : `${section.relatedFiles[0]} (+${section.relatedFiles.length - 1} more)`;
    lines.push(`Files: ${fileList}`);
  }

  if (section.verification) {
    lines.push(`Verify: ${section.verification}`);
  }

  const maxLen = Math.max(...lines.map((l) => l.length));
  const width = Math.min(maxLen + 4, process.stdout.columns || 80);
  const innerWidth = width - 2;

  const top = chalk.dim(`┌${'─'.repeat(innerWidth)}┐`);
  const bottom = chalk.dim(`└${'─'.repeat(innerWidth)}┘`);
  const content = lines.map(
    (l) => chalk.dim('│') + ' ' + chalk.cyan(l.slice(0, innerWidth - 2).padEnd(innerWidth - 2)) + ' ' + chalk.dim('│'),
  );

  return [top, ...content, bottom].join('\n');
}

export function renderToc(doc: PlanDocument): string {
  const parts: string[] = [];
  const commentedIds = new Set(doc.comments.map((c) => c.sectionId));

  parts.push('');
  parts.push(chalk.bold.underline(doc.title));
  parts.push('');

  if (doc.mode === 'plan') {
    for (const section of doc.sections) {
      if (section.level === 2) {
        parts.push(chalk.bold.yellow(`  ${section.heading}`));
      } else if (section.level === 3) {
        const marker = commentedIds.has(section.id) ? chalk.green('✓') : ' ';
        parts.push(`    ${marker} ${chalk.dim(section.id)}  ${section.heading}`);
      }
    }
  } else {
    const reviewable = doc.sections.filter((s) => s.level >= 2);
    for (let i = 0; i < reviewable.length; i++) {
      const section = reviewable[i];
      const num = String(i + 1).padStart(2);
      const marker = commentedIds.has(section.id) ? chalk.green('✓') : ' ';
      parts.push(`  ${marker} ${chalk.dim(num)}  ${section.heading}`);
    }
  }

  const commentedCount = commentedIds.size;
  const reviewable = doc.sections.filter((s) =>
    doc.mode === 'plan' ? s.level === 3 : s.level >= 2,
  );
  const remaining = reviewable.length - commentedCount;

  parts.push('');
  parts.push(
    `  ${chalk.green(`${commentedCount} section${commentedCount !== 1 ? 's' : ''} commented`)}` +
      `  ${chalk.dim(`${remaining} remaining`)}`,
  );
  parts.push('');

  return parts.join('\n');
}
