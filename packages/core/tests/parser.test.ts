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

describe('parse - explicit strategies', () => {
  it("forces 'separator' splitting strategy", () => {
    const md = '## Section A\n\nContent A\n\n---\n\n## Section B\n\nContent B';
    const doc = parse(md, 'separator');
    expect(doc.mode).toBe('generic');
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0].body).toContain('Section A');
    expect(doc.sections[1].body).toContain('Section B');
  });

  it("forces 'heading' splitting strategy", () => {
    const md = '# Title\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B';
    const doc = parse(md, 'heading');
    expect(doc.mode).toBe('generic');
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0].heading).toBe('Section A');
  });
});

describe('extractMetadata - edge cases', () => {
  it('returns empty object when no metadata found', () => {
    const md = '# Title\n\nJust plain content here with no metadata fields.';
    const doc = parse(md);
    expect(doc.metadata).toEqual({});
  });
});

describe('extractTitle - edge cases', () => {
  it("returns 'Untitled' when no H1 heading", () => {
    const md = '## Section A\n\nContent without H1';
    const doc = parse(md);
    expect(doc.title).toBe('Untitled');
  });
});

describe('parse - plan mode dependency edge cases', () => {
  it('handles task with no Depends On or Blocks fields (both null branches)', () => {
    const md = `# Test Plan

**Created:** 2026-01-01

## Milestone 1

### Task 1.1

Just a body with no dependency fields.

**Verification:** \`npm test\`

**Related Files:**
- \`src/foo.ts\`
`;
    const doc = parse(md);
    const task = doc.sections.find((s) => s.id === '1.1');
    expect(task?.dependencies?.dependsOn).toEqual([]);
    expect(task?.dependencies?.blocks).toEqual([]);
  });

  it('handles related files that end with a blank line (inRelatedFiles reset branch)', () => {
    const md = `# Test Plan

## Milestone 1

### Task 1.1

**Related Files:**
- \`src/a.ts\`

**Verification:** \`npm test\`
`;
    // The blank line after src/a.ts should stop collecting files
    const doc = parse(md);
    const task = doc.sections.find((s) => s.id === '1.1');
    expect(task?.relatedFiles).toContain('src/a.ts');
  });

  it('handles related files that end with a ** field header (inRelatedFiles reset branch)', () => {
    const md = `# Test Plan

## Milestone 1

### Task 1.1

**Related Files:**
- \`src/b.ts\`
**Verification:** \`npm run check\`
`;
    const doc = parse(md);
    const task = doc.sections.find((s) => s.id === '1.1');
    expect(task?.relatedFiles).toContain('src/b.ts');
    expect(task?.verification).toBe('npm run check');
  });

  it('returns undefined verification when no Verification field', () => {
    const md = `# Test Plan

## Milestone 1

### Task 1.1

No verification here.
`;
    const doc = parse(md);
    const task = doc.sections.find((s) => s.id === '1.1');
    expect(task?.verification).toBeUndefined();
  });

  it('handles Depends On and Blocks being (none)', () => {
    const md = `# Test Plan

## Milestone 1

### Task 1.1

**Depends On:** (none)
**Blocks:** (none)
`;
    const doc = parse(md);
    const task = doc.sections.find((s) => s.id === '1.1');
    expect(task?.dependencies?.dependsOn).toEqual([]);
    expect(task?.dependencies?.blocks).toEqual([]);
  });

  it('handles unrecognized line inside related files section', () => {
    // A non-file, non-empty, non-** line inside **Related Files:** block
    const md = `# Test Plan

## Milestone 1

### Task 1.1

**Related Files:**
- \`src/a.ts\`
Some unrecognized line here
- \`src/b.ts\`

**Verification:** \`npm test\`
`;
    const doc = parse(md);
    const task = doc.sections.find((s) => s.id === '1.1');
    // Only backtick-formatted file entries should be captured
    expect(task?.relatedFiles).toContain('src/a.ts');
    expect(task?.relatedFiles).toContain('src/b.ts');
    expect(task?.relatedFiles).not.toContain('Some unrecognized line here');
    expect(task?.relatedFiles).toHaveLength(2);
  });
});

describe('parseBySeparator - edge cases', () => {
  it('uses fallback heading when separator part has empty heading text', () => {
    // After stripping # prefix, firstLine is empty string → fallback to "Section N"
    const md = '#\n\nsome content\nmore lines\nthird line\n\n---\n\nsecond part here\nwith more content\nthird line';
    const doc = parse(md, 'separator');
    expect(doc.sections).toHaveLength(2);
    // First part starts with bare '#' which becomes '' after stripping → "Section 1"
    expect(doc.sections[0].heading).toBe('Section 1');
  });
});

describe('splitByHeadings - edge cases', () => {
  it('falls back to single section when ## headings have no text', () => {
    // '## ' alone — h2Count=1 so splitLevel=2
    // but headingRegex `^## (.+)` requires text after ##, never matches
    // splitByHeadings returns [] → parseBySeparator → single section fallback
    const md = '## \n\nsome content here';
    const doc = parse(md);
    expect(doc.sections).toHaveLength(1);
    expect(doc.mode).toBe('generic');
    expect(doc.sections[0].body).toContain('some content here');
  });
});

describe('fenced code block handling', () => {
  it('ignores ## headings inside fenced code blocks', () => {
    const md = '# Title\n\n## Real Section\n\nContent\n\n```markdown\n## Fake Section\n\nFake content\n```\n\n## Another Real\n\nMore content';
    const doc = parse(md);
    const headings = doc.sections.map(s => s.heading);
    expect(headings).toContain('Real Section');
    expect(headings).toContain('Another Real');
    expect(headings).not.toContain('Fake Section');
  });

  it('ignores ### task headings inside fenced code blocks in plan mode', () => {
    const md = `# Plan\n\n## Milestone 1\n\nSetup\n\n### Task 1.1: Real task\n\n**Summary:** Do the thing\n\n**Depends On:** (none)\n**Blocks:** (none)\n\n\`\`\`markdown\n### Task 1.2: Fake task\n\n**Depends On:** 1.1\n**Blocks:** (none)\n\`\`\``;
    const doc = parse(md);
    const tasks = doc.sections.filter(s => s.level === 3);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].heading).toContain('Real task');
  });

  it('does not detect plan mode from fields inside code fences', () => {
    const md = '# Doc\n\n## Section A\n\nContent\n\n```\n## Milestone\n### Task\n**Depends On:** 1.1\n**Blocks:** 2.1\n```';
    expect(isPlanDocument(md)).toBe(false);
  });
});

describe('parse - complex plan fixture (demo-plan)', () => {
  it('detects plan mode', () => {
    const md = readFileSync(join(fixturesDir, 'demo-plan.md'), 'utf-8');
    const doc = parse(md);
    expect(doc.mode).toBe('plan');
  });

  it('extracts title', () => {
    const md = readFileSync(join(fixturesDir, 'demo-plan.md'), 'utf-8');
    const doc = parse(md);
    expect(doc.title).toContain('Authentication');
  });

  it('extracts all 3 milestones', () => {
    const md = readFileSync(join(fixturesDir, 'demo-plan.md'), 'utf-8');
    const doc = parse(md);
    const milestones = doc.sections.filter((s) => s.level === 2);
    expect(milestones).toHaveLength(3);
    expect(milestones[0].heading).toContain('Database');
    expect(milestones[1].heading).toContain('Authentication');
    expect(milestones[2].heading).toContain('Session');
  });

  it('extracts all tasks with correct IDs', () => {
    const md = readFileSync(join(fixturesDir, 'demo-plan.md'), 'utf-8');
    const doc = parse(md);
    const tasks = doc.sections.filter((s) => s.level === 3);
    const ids = tasks.map((t) => t.id);
    expect(ids).toEqual(['1.1', '1.2', '2.1', '2.2', '2.3', '3.1', '3.2']);
  });

  it('extracts cross-milestone dependencies', () => {
    const md = readFileSync(join(fixturesDir, 'demo-plan.md'), 'utf-8');
    const doc = parse(md);
    const task21 = doc.sections.find((s) => s.id === '2.1');
    expect(task21?.dependencies?.dependsOn).toContain('1.1');
    const task32 = doc.sections.find((s) => s.id === '3.2');
    expect(task32?.dependencies?.dependsOn).toContain('1.2');
    expect(task32?.dependencies?.dependsOn).toContain('2.3');
  });

  it('preserves tables in task body', () => {
    const md = readFileSync(join(fixturesDir, 'demo-plan.md'), 'utf-8');
    const doc = parse(md);
    const task11 = doc.sections.find((s) => s.id === '1.1');
    expect(task11?.body).toContain('Column');
    expect(task11?.body).toContain('UUID');
  });

  it('preserves code blocks in task body', () => {
    const md = readFileSync(join(fixturesDir, 'demo-plan.md'), 'utf-8');
    const doc = parse(md);
    const task32 = doc.sections.find((s) => s.id === '3.2');
    expect(task32?.body).toContain('DELETE FROM sessions');
  });

  it('extracts verification commands', () => {
    const md = readFileSync(join(fixturesDir, 'demo-plan.md'), 'utf-8');
    const doc = parse(md);
    const task21 = doc.sections.find((s) => s.id === '2.1');
    expect(task21?.verification).toContain('register');
  });
});

describe('parse - rich markdown fixture (renderer-fixture)', () => {
  it('parses as generic mode (no plan structure)', () => {
    const md = readFileSync(join(fixturesDir, 'renderer-fixture.md'), 'utf-8');
    const doc = parse(md);
    expect(doc.mode).toBe('generic');
  });

  it('extracts title', () => {
    const md = readFileSync(join(fixturesDir, 'renderer-fixture.md'), 'utf-8');
    const doc = parse(md);
    expect(doc.title).toBe('Renderer Fixture');
  });

  it('extracts all sections from rich markdown', () => {
    const md = readFileSync(join(fixturesDir, 'renderer-fixture.md'), 'utf-8');
    const doc = parse(md);
    // Should have sections for: paragraphs, headings, lists, blockquotes, code blocks,
    // mermaid, other fenced, tables, images, links, footnotes, math, inline HTML,
    // admonitions, horizontal rules, emoji, hard edge cases
    expect(doc.sections.length).toBeGreaterThanOrEqual(15);
  });

  it('preserves mermaid code blocks in section body', () => {
    const md = readFileSync(join(fixturesDir, 'renderer-fixture.md'), 'utf-8');
    const doc = parse(md);
    const mermaidSection = doc.sections.find((s) => s.heading?.includes('Mermaid'));
    expect(mermaidSection).toBeDefined();
    expect(mermaidSection?.body).toContain('flowchart TD');
    expect(mermaidSection?.body).toContain('sequenceDiagram');
  });

  it('preserves math blocks in section body', () => {
    const md = readFileSync(join(fixturesDir, 'renderer-fixture.md'), 'utf-8');
    const doc = parse(md);
    const mathSection = doc.sections.find((s) => s.heading?.includes('Math'));
    expect(mathSection).toBeDefined();
    expect(mathSection?.body).toContain('E = mc^2');
    expect(mathSection?.body).toContain('\\int');
  });

  it('preserves inline HTML in section body', () => {
    const md = readFileSync(join(fixturesDir, 'renderer-fixture.md'), 'utf-8');
    const doc = parse(md);
    const htmlSection = doc.sections.find((s) => s.heading?.includes('Inline HTML'));
    expect(htmlSection).toBeDefined();
    expect(htmlSection?.body).toContain('<kbd>');
    expect(htmlSection?.body).toContain('<details>');
  });

  it('is not detected as a plan document', () => {
    const md = readFileSync(join(fixturesDir, 'renderer-fixture.md'), 'utf-8');
    expect(isPlanDocument(md)).toBe(false);
  });
});
