import { describe, it, expect } from 'vitest';
import { parse, isPlanDocument } from '../src/parser.js';
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

describe('parse - plan mode', () => {
  it('detects plan mode from fixture', () => {
    const md = readFileSync(join(fixturesDir, 'plan-document.md'), 'utf-8');
    const doc = parse(md);

    expect(doc.mode).toBe('plan');
  });

  it('extracts milestones as parent sections', () => {
    const md = readFileSync(join(fixturesDir, 'plan-document.md'), 'utf-8');
    const doc = parse(md);

    const milestones = doc.sections.filter((s) => s.level === 2);
    expect(milestones).toHaveLength(2);
    expect(milestones[0].heading).toContain('Foundation');
    expect(milestones[1].heading).toContain('Core Logic');
  });

  it('extracts tasks with hierarchical IDs', () => {
    const md = readFileSync(join(fixturesDir, 'plan-document.md'), 'utf-8');
    const doc = parse(md);

    const tasks = doc.sections.filter((s) => s.level === 3);
    expect(tasks).toHaveLength(4);
    expect(tasks[0].id).toBe('1.1');
    expect(tasks[1].id).toBe('1.2');
    expect(tasks[2].id).toBe('2.1');
    expect(tasks[3].id).toBe('2.2');
  });

  it('extracts dependencies', () => {
    const md = readFileSync(join(fixturesDir, 'plan-document.md'), 'utf-8');
    const doc = parse(md);

    const task11 = doc.sections.find((s) => s.id === '1.1');
    expect(task11?.dependencies?.blocks).toEqual(['1.2', '2.1']);
    expect(task11?.dependencies?.dependsOn).toEqual([]);

    const task21 = doc.sections.find((s) => s.id === '2.1');
    expect(task21?.dependencies?.dependsOn).toEqual(['1.1', '1.2']);
    expect(task21?.dependencies?.blocks).toEqual(['2.2']);
  });

  it('extracts related files', () => {
    const md = readFileSync(join(fixturesDir, 'plan-document.md'), 'utf-8');
    const doc = parse(md);

    const task21 = doc.sections.find((s) => s.id === '2.1');
    expect(task21?.relatedFiles).toEqual([
      'src/processor.ts (new)',
      'src/processor.test.ts (new)',
    ]);
  });

  it('extracts verification command', () => {
    const md = readFileSync(join(fixturesDir, 'plan-document.md'), 'utf-8');
    const doc = parse(md);

    const task11 = doc.sections.find((s) => s.id === '1.1');
    expect(task11?.verification).toBe('npx prisma validate');
  });

  it('sets parent reference on tasks', () => {
    const md = readFileSync(join(fixturesDir, 'plan-document.md'), 'utf-8');
    const doc = parse(md);

    const task11 = doc.sections.find((s) => s.id === '1.1');
    expect(task11?.parent).toBe('milestone-1');
  });

  it('extracts document metadata', () => {
    const md = readFileSync(join(fixturesDir, 'plan-document.md'), 'utf-8');
    const doc = parse(md);

    expect(doc.metadata['Created']).toBe('2026-04-01');
    expect(doc.metadata['Source']).toBe('spec.md');
  });
});

describe('isPlanDocument', () => {
  it('returns true for plan-style markdown', () => {
    const md = readFileSync(join(fixturesDir, 'plan-document.md'), 'utf-8');
    expect(isPlanDocument(md)).toBe(true);
  });

  it('returns false for generic markdown', () => {
    const md = readFileSync(join(fixturesDir, 'generic-document.md'), 'utf-8');
    expect(isPlanDocument(md)).toBe(false);
  });
});
