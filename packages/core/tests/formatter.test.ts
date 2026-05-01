import { describe, it, expect } from 'vitest';
import { formatReview } from '../src/formatter.js';
import type { PlanDocument } from '../src/types.js';

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
