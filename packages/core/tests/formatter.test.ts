import { describe, it, expect } from 'vitest';
import { formatPausedNotice, formatReview, formatReviewOutput } from '../src/formatter.js';
import { hashItem } from '../src/reviewModel.js';
import type { Answer, PlanDocument, Review, ReviewItem, Thread } from '../src/types.js';

function makeDoc(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return {
    title: 'Test Plan',
    metadata: {},
    mode: 'plan',
    sections: [
      {
        id: '1.1',
        heading: 'Create schema',
        level: 3,
        body: 'Add tables for feature X.',
        parent: 'milestone-1',
        dependencies: { dependsOn: [], blocks: ['1.2'] },
      },
      {
        id: '1.2',
        heading: 'Run migration',
        level: 3,
        body: 'Apply the migration.',
        parent: 'milestone-1',
        dependencies: { dependsOn: ['1.1'], blocks: [] },
      },
    ],
    comments: [],
    ...overrides,
  };
}

describe('formatReview', () => {
  it('includes review summary header', () => {
    const doc = makeDoc({
      comments: [{ sectionId: '1.1', text: 'Add index', timestamp: new Date() }],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });

    expect(output).toContain('# Plan Review: Test Plan');
    expect(output).toContain('**Comments:** 1');
  });

  it('includes only commented sections', () => {
    const doc = makeDoc({
      comments: [{ sectionId: '1.1', text: 'Add index', timestamp: new Date() }],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });

    expect(output).toContain('Section 1.1');
    expect(output).toContain('Create schema');
    expect(output).not.toContain('Section 1.2');
  });

  it('does not include ### Original Content header', () => {
    const doc = makeDoc({
      comments: [{ sectionId: '1.1', text: 'Looks good', timestamp: new Date() }],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });
    expect(output).not.toContain('### Original Content');
  });

  it('labels section-level comments with (entire section)', () => {
    const doc = makeDoc({
      comments: [{ sectionId: '1.1', text: 'Section comment', timestamp: new Date() }],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });
    expect(output).toContain('### Reviewer Comment (entire section)');
    expect(output).not.toContain('### Reviewer Comment\n');
  });

  it('blockquotes lineTexts for line-anchored comments', () => {
    const doc = makeDoc({
      comments: [{
        sectionId: '1.1',
        text: 'Check this line',
        timestamp: new Date(),
        anchor: {
          type: 'lines',
          startLine: 0,
          endLine: 1,
          lineTexts: ['First selected line.', 'Second selected line.'],
        },
      }],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });
    expect(output).toContain('> First selected line.');
    expect(output).toContain('> Second selected line.');
    expect(output).toContain('Check this line');
    expect(output).not.toContain('### Reviewer Comment (entire section)');
  });

  it('outputs anchored comments before section-level within the same section', () => {
    const doc = makeDoc({
      comments: [
        { sectionId: '1.1', text: 'Section-level comment', timestamp: new Date() },
        {
          sectionId: '1.1',
          text: 'Line comment',
          timestamp: new Date(),
          anchor: { type: 'lines', startLine: 0, endLine: 0, lineTexts: ['A line.'] },
        },
      ],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });
    const anchoredPos = output.indexOf('Line comment');
    const sectionPos = output.indexOf('Section-level comment');
    expect(anchoredPos).toBeLessThan(sectionPos);
  });

  it('includes reviewer comment text', () => {
    const doc = makeDoc({
      comments: [
        { sectionId: '1.1', text: 'Need an index on this table', timestamp: new Date() },
      ],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });

    expect(output).toContain('Need an index on this table');
  });

  it('includes dependency info in plan mode', () => {
    const doc = makeDoc({
      comments: [{ sectionId: '1.1', text: 'Comment', timestamp: new Date() }],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });

    expect(output).toContain('Blocks: 1.2');
  });

  it('handles multiple comments on different sections', () => {
    const doc = makeDoc({
      comments: [
        { sectionId: '1.1', text: 'First comment', timestamp: new Date() },
        { sectionId: '1.2', text: 'Second comment', timestamp: new Date() },
      ],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });

    expect(output).toContain('Section 1.1');
    expect(output).toContain('Section 1.2');
    expect(output).toContain('**Comments:** 2');
  });

  it('returns empty review when no comments', () => {
    const doc = makeDoc();
    const output = formatReview(doc, { verdict: null, summary: '' });

    expect(output).toContain('**Comments:** 0');
  });

  it('includes dependsOn when it has items (plan mode)', () => {
    const doc = makeDoc({
      comments: [{ sectionId: '1.2', text: 'Note on migration', timestamp: new Date() }],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });

    // section 1.2 has dependsOn: ['1.1']
    expect(output).toContain('Depends on: 1.1');
  });

  it('escapes markdown characters in comment text', () => {
    const doc = makeDoc({
      comments: [{
        sectionId: '1.1',
        text: 'This has **bold** and [link](url) and `code`',
        timestamp: new Date(),
      }],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });
    expect(output).not.toContain('**bold**');
    expect(output).toContain('\\*\\*bold\\*\\*');
    expect(output).toContain('\\[link\\]');
    expect(output).toContain('\\`code\\`');
  });

  it('escapes markdown in line-anchored comment text too', () => {
    const doc = makeDoc({
      comments: [{
        sectionId: '1.1',
        text: 'Check this #heading and > quote',
        timestamp: new Date(),
        anchor: { type: 'lines', startLine: 0, endLine: 0, lineTexts: ['A line.'] },
      }],
    });
    const output = formatReview(doc, { verdict: null, summary: '' });
    expect(output).toContain('\\#heading');
    expect(output).toContain('\\> quote');
  });

  it('handles generic mode (uses level >= 2 filter)', () => {
    const genericDoc: PlanDocument = {
      title: 'Generic Doc',
      metadata: {},
      mode: 'generic',
      sections: [
        { id: 'section-1', heading: 'Overview', level: 2, body: 'Intro content' },
        { id: 'section-2', heading: 'Details', level: 2, body: 'Detail content' },
      ],
      comments: [{ sectionId: 'section-1', text: 'Looks good', timestamp: new Date() }],
    };
    const output = formatReview(genericDoc, { verdict: null, summary: '' });

    expect(output).toContain('# Plan Review: Generic Doc');
    expect(output).toContain('Section section-1');
    expect(output).toContain('Looks good');
    // Generic mode sections have no plan-mode metadata
    expect(output).not.toContain('Depends on');
  });

  it('renders verdict "Approved" when opts.verdict is "approved"', () => {
    const doc = makeDoc({ comments: [] });
    const out = formatReview(doc, { verdict: 'approved', summary: '' });
    expect(out).toContain('**Verdict:** Approved');
  });

  it('renders verdict "Comment" when opts.verdict is null', () => {
    const doc = makeDoc({
      comments: [{ sectionId: '1.1', text: 'X', timestamp: new Date() }],
    });
    const out = formatReview(doc, { verdict: null, summary: '' });
    expect(out).toContain('**Verdict:** Comment');
  });

  it('renders ## Overall Comments when summary is non-empty', () => {
    const doc = makeDoc({ comments: [] });
    const out = formatReview(doc, {
      verdict: 'approved',
      summary: 'Looks great overall.',
    });
    expect(out).toContain('## Overall Comments');
    expect(out).toContain('Looks great overall.');
  });

  it('omits ## Overall Comments when summary is empty or whitespace', () => {
    const doc = makeDoc({ comments: [] });
    const out = formatReview(doc, { verdict: 'approved', summary: '   ' });
    expect(out).not.toContain('## Overall Comments');
  });

  it('renders full template with no sections when approved + zero comments', () => {
    const doc = makeDoc({ comments: [] });
    const out = formatReview(doc, { verdict: 'approved', summary: '' });
    expect(out).toContain('# Plan Review: Test Plan');
    expect(out).toContain('**Verdict:** Approved');
    expect(out).toContain('**Comments:** 0');
    expect(out).not.toContain('## Section');
  });
});

describe('formatReviewOutput (v2)', () => {
  function makeItem(
    partial: Pick<ReviewItem, 'id' | 'kind' | 'label' | 'question'> & Partial<ReviewItem>,
  ): ReviewItem {
    const item = { sectionId: '1.1', ...partial } as ReviewItem;
    return { ...item, hash: hashItem(item) };
  }

  function answer(item: ReviewItem, choice: string, note = '', itemHash = item.hash): Answer {
    return { choice, note, itemHash, round: 2, updatedAt: '2026-10-15T00:00:00.000Z' };
  }

  function makeThread(partial: Partial<Thread> & Pick<Thread, 'id'>): Thread {
    return {
      sectionId: '1.1',
      anchor: null,
      resolved: false,
      outdated: false,
      createdRound: 2,
      comments: [],
      ...partial,
    };
  }

  function makeReview(overrides: Partial<Review> = {}): Review {
    return {
      version: 2,
      id: 'rv_8f3a',
      title: 'Test Plan',
      status: 'open',
      createdAt: '2026-10-15T00:00:00.000Z',
      updatedAt: '2026-10-15T00:00:00.000Z',
      answers: {},
      threads: [],
      rounds: [
        {
          n: 2,
          plan: '',
          contentHash: 'x',
          startedAt: '2026-10-15T00:00:00.000Z',
          submittedAt: '2026-10-15T01:00:00.000Z',
          verdict: 'changes_requested',
        },
      ],
      ...overrides,
    };
  }

  const NEXT_FOOTER = [
    '---',
    '**Next:** revise the plan and re-run with `--review rv_8f3a`. Keep item ids stable.',
    'Re-emit deferred items unchanged unless you resolve them. Answer threads with',
    '```reply thread=<id>``` blocks.',
  ];

  const retry = makeItem({
    id: 'retry-backoff',
    kind: 'decision',
    label: 'Retry backoff',
    question: 'Which backoff?',
    options: [
      { key: 'A', text: 'Exponential', pick: true },
      { key: 'B', text: 'Circuit breaker after 90 s', pick: false },
    ],
  });
  const legacy = makeItem({
    id: 'legacy-window',
    kind: 'decision',
    label: 'Legacy callback window',
    question: 'How long?',
    options: [{ key: 'A', text: '30 days', pick: false }],
  });
  const cookie = makeItem({
    id: 'cookie-scope',
    kind: 'decision',
    label: 'Refresh cookie scope',
    question: 'Scope?',
    options: [{ key: 'A', text: 'Host only', pick: false }],
  });
  const latency = makeItem({
    id: 'auth-latency',
    kind: 'assumption',
    label: 'Auth server latency',
    question: 'p99 under 200 ms',
  });

  it('formats a changes-requested review with every item state', () => {
    const doc = makeDoc();
    doc.sections[0]!.heading = '04 Token exchange';
    const review = makeReview({
      answers: {
        'retry-backoff': answer(retry, 'B', 'rationale note\nsecond line'),
        'legacy-window': answer(legacy, 'deferred', 'Needs mobile-team input'),
        'auth-latency': answer(latency, 'no', 'p99 spikes to 900 ms during deploys'),
      },
      threads: [
        makeThread({
          id: 't_4k2',
          anchor: { type: 'lines', startLine: 0, endLine: 0, lineTexts: ['never leaves the client'] },
          comments: [
            { id: 'c_1', author: 'reviewer', body: 'It does leave the client…', createdAt: '' },
            { id: 'c_2', author: 'agent', body: 'Reworded…', createdAt: '' },
          ],
        }),
        makeThread({ id: 't_old', createdRound: 1, resolved: true }),
      ],
    });
    review.rounds[0]!.summary = 'Mostly good.';

    expect(formatReviewOutput(review, [retry, legacy, cookie, latency], doc)).toBe(
      [
        '# Plan Review: Test Plan',
        'Review `rv_8f3a` · Round 2 · **Changes requested**',
        '',
        '## Summary',
        'Mostly good.',
        "- Decisions: 1 answered, 1 deferred, 1 unanswered · Assumptions: 1 doesn't hold",
        '- Threads: 1 open (1 new this round), 1 resolved',
        '',
        '## Decisions',
        '### `retry-backoff` · Retry backoff — **B**: Circuit breaker after 90 s (your pick was A)',
        '> rationale note',
        '> second line',
        '### `legacy-window` · Legacy callback window — **Deferred**',
        '> Needs mobile-team input',
        '### `cookie-scope` · Refresh cookie scope — *Unanswered*',
        '',
        '## Assumptions',
        "### `auth-latency` · Auth server latency — **Doesn't hold**",
        '> p99 spikes to 900 ms during deploys',
        '',
        '## Open threads',
        '### `t_4k2` · § 04 Token exchange',
        '> never leaves the client',
        '- **Reviewer:** It does leave the client…',
        '- **Agent:** Reworded…',
        '',
        ...NEXT_FOOTER,
      ].join('\n'),
    );
  });

  it('renders other, matching pick, changed and outdated cases', () => {
    const review = makeReview({
      answers: {
        'retry-backoff': answer(retry, 'other', 'Use jitter'),
        'legacy-window': answer(legacy, 'A'),
        'cookie-scope': answer(cookie, 'A', 'old', 'stale-hash'),
        'auth-latency': answer(latency, 'unsure'),
      },
      threads: [
        makeThread({
          id: 't_out',
          outdated: true,
          anchor: { type: 'lines', startLine: 0, endLine: 1, lineTexts: ['a', 'b'] },
        }),
      ],
    });
    const out = formatReviewOutput(review, [retry, legacy, cookie, latency], makeDoc());
    expect(out).toContain('`retry-backoff` · Retry backoff — **Other**\n> Use jitter');
    expect(out).toContain('Legacy callback window — **A**: 30 days\n');
    expect(out).toContain('Refresh cookie scope — *Unanswered* (plan changed since your answer)\n');
    expect(out).not.toContain('> old');
    expect(out).toContain('Auth server latency — **Not sure**');
    expect(out).toContain('## Outdated threads\n### `t_out` · § Create schema\n> a b');
    expect(out).not.toContain('## Open threads');
  });

  it('formats an approved review with deferred items', () => {
    const review = makeReview({
      status: 'approved',
      answers: { 'legacy-window': answer(legacy, 'deferred'), 'auth-latency': answer(latency, 'holds') },
    });
    review.rounds[0]!.verdict = 'approved';
    expect(formatReviewOutput(review, [legacy, latency], makeDoc())).toBe(
      [
        '# Plan Review: Test Plan',
        'Review `rv_8f3a` · Round 2 · **Approved**',
        '',
        '## Summary',
        '- Decisions: 1 deferred · Assumptions: 1 holds',
        '',
        '## Decisions',
        '### `legacy-window` · Legacy callback window — **Deferred**',
        '',
        '## Assumptions',
        '### `auth-latency` · Auth server latency — **Holds**',
        '',
        '---',
        'Approved. 1 deferred item remains open — track them during implementation.',
      ].join('\n'),
    );
  });

  it('says plain Approved when nothing is deferred', () => {
    const review = makeReview({ status: 'approved' });
    review.rounds[0]!.verdict = 'approved';
    expect(formatReviewOutput(review, [], makeDoc()).endsWith('---\nApproved.')).toBe(true);
  });

  it('prints only header and footer when there are no items or threads', () => {
    expect(formatReviewOutput(makeReview(), [], makeDoc())).toBe(
      [
        '# Plan Review: Test Plan',
        'Review `rv_8f3a` · Round 2 · **Changes requested**',
        '',
        ...NEXT_FOOTER,
      ].join('\n'),
    );
  });

  it('formats the paused notice counting done and deferred as answered', () => {
    const review = makeReview({
      answers: {
        'retry-backoff': answer(retry, 'A'),
        'legacy-window': answer(legacy, 'deferred'),
        'cookie-scope': answer(cookie, 'A', '', 'stale'),
      },
    });
    expect(formatPausedNotice(review, [retry, legacy, cookie, latency])).toBe(
      'Review `rv_8f3a` paused at round 2 (2/4 items answered). The user has not finished reviewing — wait for them. Resume with: plan-review --review rv_8f3a (pipe the plan on stdin)',
    );
  });

  it('includes the plan path in the resume command when the review has one', () => {
    expect(formatPausedNotice(makeReview({ planPath: '/w/plan.md' }), [])).toContain(
      'Resume with: plan-review /w/plan.md --review rv_8f3a',
    );
    expect(formatPausedNotice(makeReview({ planPath: '/w/my plan.md' }), [])).toContain(
      "Resume with: plan-review '/w/my plan.md' --review rv_8f3a",
    );
  });

  it('formats an unanswered constructor item without reading inherited answers', () => {
    const item = makeItem({ id: 'constructor', kind: 'decision', label: 'Constructor', question: 'Which?' });
    const review = makeReview();
    expect(formatReviewOutput(review, [item], makeDoc())).toContain('Constructor — *Unanswered*');
    expect(formatReviewOutput(review, [item], makeDoc())).not.toContain('plan changed since your answer');
    expect(formatPausedNotice(review, [item])).toContain('(0/1 items answered)');
    review.rounds[0]!.verdict = 'approved';
    expect(formatReviewOutput(review, [item], makeDoc()).endsWith('Approved.')).toBe(true);
  });

  it('keeps the plural wording for multiple deferred items', () => {
    const review = makeReview({ answers: { [legacy.id]: answer(legacy, 'deferred'), [latency.id]: answer(latency, 'deferred') } });
    review.rounds[0]!.verdict = 'approved';
    expect(formatReviewOutput(review, [legacy, latency], makeDoc()))
      .toContain('Approved. 2 deferred items remain open — track them during implementation.');
  });

  it('indents continuation lines in multiline reviewer and agent comments', () => {
    const review = makeReview({ threads: [makeThread({ id: 't_multi', comments: [
      { id: 'c_review', author: 'reviewer', body: 'First.\nSecond.\n\nLast.', createdAt: '2026-10-15T00:00:00.000Z' },
      { id: 'c_agent', author: 'agent', body: 'Reply.\nMore.', createdAt: '2026-10-15T00:00:00.000Z' },
    ] })] });
    expect(formatReviewOutput(review, [], makeDoc()))
      .toContain('- **Reviewer:** First.\n  Second.\n  \n  Last.\n- **Agent:** Reply.\n  More.');
  });

});
