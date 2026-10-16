import { describe, it, expect } from 'vitest';
import { renderSection } from '../src/renderer.js';
import { extractItems, parse } from '@plan-review/core';
import type { ReviewItem, Section } from '@plan-review/core';

describe('renderSection - item fences', () => {
  const decision: ReviewItem = {
    id: 'db-choice', kind: 'decision', label: 'Database', question: 'Which database?',
    context: 'Needs transactions', sectionId: 's',
    options: [
      { key: 'A', text: 'Postgres', detail: 'mature', pick: true },
      { key: 'B', text: 'SQLite', pick: false },
    ],
    hash: 'h1',
  };
  const assumption: ReviewItem = {
    id: 'single-writer', kind: 'assumption', label: 'Single writer', question: 'Only one writer exists',
    sectionId: 's', hash: 'h2',
  };
  const section = (body: string): Section => ({ id: 's', heading: 'Plan', level: 2, body });

  it('renders only the accepted duplicate fence as a decision and preserves the other content as code', () => {
    const first = '```decision id=storage\nquestion: First question?\n- A: Files\n- B: Database\n```';
    const second = '```decision id=storage\nquestion: Second question?\n- A: Redis\n- B: Disk\n```';
    const { doc, items } = extractItems(parse(`# Plan\n\n## Storage\n\n${first}\n\n${second}`));
    const output = doc.sections.map((section) => renderSection(section, items)).join('\n');
    expect(output.match(/◆ DECISION/g)).toHaveLength(1);
    expect(output).toContain('First question?');
    expect(output).toContain('question: Second question?');
    expect(output).toContain('- A: Redis');
  });

  it('matches the extractor occurrence when the accepted fence has extra info fields', () => {
    const first = '```decision extra id=storage\nquestion: Accepted question?\n- A: Files\n- B: Database\n```';
    const second = '```decision id=storage\nquestion: Duplicate question?\n- A: Redis\n- B: Disk\n```';
    const { doc, items } = extractItems(parse(`# Plan\n\n## Storage\n\n${first}\n\n${second}`));
    const output = doc.sections.map((section) => renderSection(section, items)).join('\n');
    expect(output.match(/◆ DECISION/g)).toHaveLength(1);
    expect(output).not.toContain('question: Accepted question?');
    expect(output).toContain('question: Duplicate question?');
  });

  it('renders a valid decision fence as text', () => {
    const body = '```decision id=db-choice\nquestion: Which database?\n```';
    const output = renderSection(section(body), [decision]);
    expect(output).toContain('◆ DECISION Database');
    expect(output).toContain('Which database?');
    expect(output).toContain("  A. Postgres — mature (author's pick)");
    expect(output).toContain('  B. SQLite');
    expect(output).toContain('Needs transactions');
    expect(output).not.toContain('```');
  });

  it('renders a valid assumption fence as text', () => {
    const body = '```assumption id=single-writer\nstatement: Only one writer exists\n```';
    const output = renderSection(section(body), [assumption]);
    expect(output).toContain('◇ ASSUMPTION Single writer');
    expect(output).toContain('Only one writer exists');
  });

  it('leaves surrounding markdown and malformed fences as code', () => {
    const body = 'Before\n\n```decision id=unknown-id\nquestion: Nope\n```\n\nAfter';
    const output = renderSection(section(body), [decision]);
    expect(output).toContain('Before');
    expect(output).toContain('After');
    expect(output).toContain('question: Nope');
    expect(output).not.toContain('◆ DECISION');
  });
});
