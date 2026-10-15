import { itemCounts, itemState } from './reviewModel.js';
import type {
  Answer,
  PlanDocument,
  Review,
  ReviewComment,
  ReviewItem,
  ReviewVerdict,
  Thread,
} from './types.js';

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

const VERDICT_LABELS: Record<string, string> = {
  holds: 'Holds',
  unsure: 'Not sure',
  no: "Doesn't hold",
};

function quote(text: string): string[] {
  return text.split('\n').map((line) => `> ${line}`);
}

function decisionResult(item: ReviewItem, answer: Answer | undefined): string {
  const state = itemState(item, answer);
  if (state === 'changed') return '*Unanswered* (plan changed since your answer)';
  if (!answer) return '*Unanswered*';
  if (state === 'deferred') return '**Deferred**';
  if (answer.choice === 'other') return '**Other**';
  const chosen = item.options?.find((o) => o.key === answer.choice);
  const pick = item.options?.find((o) => o.pick);
  const suffix = pick && pick.key !== answer.choice ? ` (your pick was ${pick.key})` : '';
  return `**${answer.choice}**: ${chosen?.text ?? ''}${suffix}`;
}

function assumptionResult(item: ReviewItem, answer: Answer | undefined): string {
  const state = itemState(item, answer);
  if (state === 'changed') return '*Unanswered* (plan changed since your answer)';
  if (!answer) return '*Unanswered*';
  if (state === 'deferred') return '**Deferred**';
  return `**${VERDICT_LABELS[answer.choice] ?? answer.choice}**`;
}

function itemBlock(item: ReviewItem, answers: Record<string, Answer>): string[] {
  const answer = Object.hasOwn(answers, item.id) ? answers[item.id] : undefined;
  const result =
    item.kind === 'decision' ? decisionResult(item, answer) : assumptionResult(item, answer);
  const lines = [`### \`${item.id}\` · ${item.label} — ${result}`];
  if (answer && answer.note.trim() !== '' && itemState(item, answer) !== 'changed') {
    lines.push(...quote(answer.note));
  }
  return lines;
}

function countsLines(review: Review, items: ReviewItem[], round: number): string[] {
  const counts = itemCounts(items, review.answers);
  const lines: string[] = [];
  const parts: string[] = [];

  const d = counts.decisions;
  const decisionParts = [
    d.answered && `${d.answered} answered`,
    d.deferred && `${d.deferred} deferred`,
    d.open && `${d.open} unanswered`,
  ].filter(Boolean);
  if (decisionParts.length > 0) parts.push(`Decisions: ${decisionParts.join(', ')}`);

  const a = counts.assumptions;
  const assumptionParts = [
    a.holds && `${a.holds} holds`,
    a.unsure && `${a.unsure} not sure`,
    a.no && `${a.no} doesn't hold`,
    a.deferred && `${a.deferred} deferred`,
    a.open && `${a.open} unanswered`,
  ].filter(Boolean);
  if (assumptionParts.length > 0) parts.push(`Assumptions: ${assumptionParts.join(', ')}`);

  if (parts.length > 0) lines.push(`- ${parts.join(' · ')}`);

  if (review.threads.length > 0) {
    const open = review.threads.filter((t) => !t.resolved && !t.outdated);
    const fresh = open.filter((t) => t.createdRound === round).length;
    const resolved = review.threads.filter((t) => t.resolved).length;
    lines.push(`- Threads: ${open.length} open (${fresh} new this round), ${resolved} resolved`);
  }
  return lines;
}

function threadBlock(thread: Thread, doc: PlanDocument): string[] {
  const heading = doc.sections.find((s) => s.id === thread.sectionId)?.heading ?? thread.sectionId;
  const lines = [`### \`${thread.id}\` · § ${heading}`];
  if (thread.anchor) lines.push(`> ${thread.anchor.lineTexts.join(' ')}`);
  for (const comment of thread.comments) {
    const author = comment.author === 'reviewer' ? 'Reviewer' : 'Agent';
    lines.push(`- **${author}:** ${comment.body.replace(/\n/g, '\n  ')}`);
  }
  return lines;
}

function section(title: string, blocks: string[][]): string[] {
  return blocks.length === 0 ? [] : ['', `## ${title}`, ...blocks.flat()];
}

function footer(review: Review, items: ReviewItem[], approved: boolean): string[] {
  if (approved) {
    const deferred = items.filter((i) => itemState(i, Object.hasOwn(review.answers, i.id) ? review.answers[i.id] : undefined) === 'deferred').length;
    return deferred === 0
      ? ['Approved.']
      : [`Approved. ${deferred} deferred item${deferred === 1 ? ' remains' : 's remain'} open — track them during implementation.`];
  }
  return [
    `**Next:** revise the plan and re-run with \`--review ${review.id}\`. Keep item ids stable.`,
    'Re-emit deferred items unchanged unless you resolve them. Answer threads with',
    '```reply thread=<id>``` blocks.',
  ];
}

export function formatReviewOutput(
  review: Review,
  items: ReviewItem[],
  doc: PlanDocument,
): string {
  const round = review.rounds[review.rounds.length - 1]!;
  const approved = round.verdict === 'approved';
  const verdict = approved ? '**Approved**' : '**Changes requested**';

  const lines = [`# Plan Review: ${review.title}`, `Review \`${review.id}\` · Round ${round.n} · ${verdict}`];

  const summary = [
    ...(round.summary?.trim() ? [round.summary.trim()] : []),
    ...countsLines(review, items, round.n),
  ];
  if (summary.length > 0) lines.push('', '## Summary', ...summary);

  const byKind = (kind: ReviewItem['kind']) =>
    items.filter((i) => i.kind === kind).map((i) => itemBlock(i, review.answers));
  lines.push(...section('Decisions', byKind('decision')));
  lines.push(...section('Assumptions', byKind('assumption')));

  const unresolved = review.threads.filter((t) => !t.resolved);
  lines.push(
    ...section('Open threads', unresolved.filter((t) => !t.outdated).map((t) => threadBlock(t, doc))),
  );
  lines.push(
    ...section('Outdated threads', unresolved.filter((t) => t.outdated).map((t) => threadBlock(t, doc))),
  );

  lines.push('', '---', ...footer(review, items, approved));
  return lines.join('\n');
}

export function formatPausedNotice(review: Review, items: ReviewItem[]): string {
  const round = review.rounds[review.rounds.length - 1]!;
  const answered = items.filter((i) => {
    const state = itemState(i, Object.hasOwn(review.answers, i.id) ? review.answers[i.id] : undefined);
    return state === 'done' || state === 'deferred';
  }).length;
  return (
    `Review \`${review.id}\` paused at round ${round.n} (${answered}/${items.length} items answered). ` +
    `The user has not finished reviewing — wait for them. Resume with: plan-review --review ${review.id}`
  );
}
