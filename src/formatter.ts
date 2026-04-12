import type { PlanDocument } from './types.js';

export function formatReview(doc: PlanDocument): string {
  const commentedSectionIds = new Set(doc.comments.map((c) => c.sectionId));
  const reviewableSections = doc.sections.filter((s) =>
    doc.mode === 'plan' ? s.level === 3 : s.level >= 2,
  );
  const commentedSections = reviewableSections.filter((s) => commentedSectionIds.has(s.id));

  const parts: string[] = [];

  parts.push(`# Plan Review: ${doc.title}`);
  parts.push('');
  parts.push('## Review Summary');
  parts.push(`- **Sections reviewed:** ${commentedSections.length}/${reviewableSections.length}`);
  parts.push(`- **Comments:** ${doc.comments.length}`);
  parts.push(
    `- **Skipped:** ${reviewableSections.length - commentedSections.length} sections without comments`,
  );
  parts.push('');
  parts.push('---');

  for (const section of commentedSections) {
    const sectionComments = doc.comments.filter((c) => c.sectionId === section.id);

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

    parts.push('### Original Content');
    const blockquoted = section.body
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    parts.push(blockquoted);
    parts.push('');

    for (const comment of sectionComments) {
      parts.push('### Reviewer Comment');
      parts.push(comment.text);
      parts.push('');
    }

    parts.push('---');
  }

  return parts.join('\n');
}
