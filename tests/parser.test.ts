import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('parse - generic mode', () => {
  it('splits on ## headings', () => {
    const md = '# Title\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B';
    const doc = parse(md);

    expect(doc.mode).toBe('generic');
    expect(doc.title).toBe('Title');
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0].heading).toBe('Section A');
    expect(doc.sections[0].body).toContain('Content A');
    expect(doc.sections[1].heading).toBe('Section B');
  });

  it('splits on ### headings when no ## found', () => {
    const md = '# Title\n\n### Sub A\n\nContent A\n\n### Sub B\n\nContent B';
    const doc = parse(md);

    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0].heading).toBe('Sub A');
  });

  it('falls back to --- separators when no headings', () => {
    const md = 'Intro paragraph\n\n---\n\nSecond part\n\n---\n\nThird part';
    const doc = parse(md);

    expect(doc.sections.length).toBeGreaterThanOrEqual(2);
  });

  it('skips short fragments from decorative separators', () => {
    const md = '## Real Section\n\nLong content here that spans multiple lines.\nMore content.\nEven more.\n\n---\n\n---\n\n## Another Section\n\nMore content here.';
    const doc = parse(md);

    expect(doc.sections).toHaveLength(2);
  });

  it('treats entire file as single section if no splits found', () => {
    const md = 'Just a plain text document with no headings or separators at all.';
    const doc = parse(md);

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].body).toContain('Just a plain text');
  });

  it('assigns sequential IDs in generic mode', () => {
    const md = '## A\n\nContent\n\n## B\n\nContent\n\n## C\n\nContent';
    const doc = parse(md);

    expect(doc.sections[0].id).toBe('section-1');
    expect(doc.sections[1].id).toBe('section-2');
    expect(doc.sections[2].id).toBe('section-3');
  });

  it('parses the generic fixture file', () => {
    const md = readFileSync(join(fixturesDir, 'generic-document.md'), 'utf-8');
    const doc = parse(md);

    expect(doc.mode).toBe('generic');
    expect(doc.title).toBe('Design Document');
    expect(doc.sections.length).toBeGreaterThanOrEqual(3);
  });
});
