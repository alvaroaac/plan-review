import type { PlanDocument, ReviewComment, ReviewVerdict } from './types.js';

function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_`~\[\]#>|])/g, '\\$1');
}

function sortComments(comments: ReviewComment[]): ReviewComment[] {
  return [...comments].sort((a, b) => {
    const aLine = a.anchor?.startLine ?? Infinity;
    const bLine = b.anchor?.startLine ?? Infinity;
    return aLine - bLine;
  });
}

function verdictLabel(verdict: ReviewVerdict): string {
  return verdict === 'approved' ? 'Approved' : 'Comment';
}

export interface FormatReviewOptions {
  verdict: ReviewVerdict;
  summary: string;
}

export function formatReview(doc: PlanDocument, opts: FormatReviewOptions): string {
  const commentedSectionIds = new Set(doc.comments.map((c) => c.sectionId));
  const reviewableSections = doc.sections.filter((s) =>
    doc.mode === 'plan' ? s.level === 3 : s.level >= 2,
  );
  const commentedSections = reviewableSections.filter((s) => commentedSectionIds.has(s.id));

  const parts: string[] = [];

  parts.push(`# Plan Review: ${doc.title}`);
  parts.push('');
  parts.push('## Review Summary');
  parts.push(`- **Verdict:** ${verdictLabel(opts.verdict)}`);
  parts.push(`- **Sections reviewed:** ${commentedSections.length}/${reviewableSections.length}`);
  parts.push(`- **Comments:** ${doc.comments.length}`);
  const skippedCount = reviewableSections.length - commentedSections.length;
  parts.push(
    `- **Skipped:** ${skippedCount} section${skippedCount === 1 ? '' : 's'} without comments`,
  );

  if (opts.summary.trim() !== '') {
    parts.push('');
    parts.push('## Overall Comments');
    parts.push('');
    parts.push(escapeMarkdown(opts.summary));
  }

  if (commentedSections.length > 0) {
    parts.push('');
    parts.push('---');
  }

  for (const section of commentedSections) {
    const sectionComments = sortComments(
      doc.comments.filter((c) => c.sectionId === section.id),
    );

    parts.push('');
    parts.push(`## Section ${section.id}: ${section.heading}`);
    parts.push('');

    if (doc.mode === 'plan' && section.dependencies) {
      const deps = section.dependencies;
      if (deps.dependsOn.length > 0) {
        parts.push(`Depends on: ${deps.dependsOn.join(', ')}`);
      }
      if (deps.blocks.length > 0) {
        parts.push(`Blocks: ${deps.blocks.join(', ')}`);
      }
      parts.push('');
    }

    for (const comment of sectionComments) {
      if (comment.anchor) {
        parts.push('### Reviewer Comment');
        parts.push('');
        for (const line of comment.anchor.lineTexts) {
          parts.push(`> ${line}`);
        }
        parts.push('');
        parts.push(escapeMarkdown(comment.text));
      } else {
        parts.push('### Reviewer Comment (entire section)');
        parts.push('');
        parts.push(escapeMarkdown(comment.text));
      }
      parts.push('');
      parts.push('---');
    }
  }

  return parts.join('\n');
}
