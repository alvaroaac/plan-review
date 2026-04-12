import { describe, it, expect } from 'vitest';
import { renderSection, renderToc } from '../src/renderer.js';
import type { Section, PlanDocument } from '../src/types.js';

describe('renderSection', () => {
  it('renders plain markdown section', () => {
    const section: Section = {
      id: 'section-1',
      heading: 'Overview',
      level: 2,
      body: 'This is **bold** and `code`.',
    };

    const output = renderSection(section);
    expect(output).toContain('bold');
    expect(output).toContain('code');
  });

  it('renders plan metadata header for task sections', () => {
    const section: Section = {
      id: '1.2',
      heading: 'Add framework-agnostic logger',
      level: 3,
      parent: 'milestone-1',
      dependencies: { dependsOn: [], blocks: ['4.8a'] },
      relatedFiles: ['src/core/ports/logger.ts', 'src/config/create-logger.ts'],
      verification: 'npx tsc --noEmit',
    };

    const output = renderSection(section);
    expect(output).toContain('Task 1.2');
    expect(output).toContain('Blocks');
    expect(output).toContain('4.8a');
    expect(output).toContain('logger.ts');
  });

  it('does not render metadata header for generic sections', () => {
    const section: Section = {
      id: 'section-1',
      heading: 'Overview',
      level: 2,
      body: 'Content here.',
    };

    const output = renderSection(section);
    expect(output).not.toContain('Depends on');
    expect(output).not.toContain('Blocks');
  });
});

describe('renderToc', () => {
  it('renders hierarchical TOC for plan mode', () => {
    const doc: PlanDocument = {
      title: 'Test Plan',
      metadata: {},
      mode: 'plan',
      sections: [
        { id: 'milestone-1', heading: 'Foundation', level: 2, body: '' },
        { id: '1.1', heading: 'Create schema', level: 3, body: '', parent: 'milestone-1' },
        { id: '1.2', heading: 'Run migration', level: 3, body: '', parent: 'milestone-1' },
      ],
      comments: [{ sectionId: '1.1', text: 'Looks good', timestamp: new Date() }],
    };

    const output = renderToc(doc);
    expect(output).toContain('Foundation');
    expect(output).toContain('1.1');
    expect(output).toContain('Create schema');
    expect(output).toContain('1 section commented');
  });

  it('renders flat TOC for generic mode', () => {
    const doc: PlanDocument = {
      title: 'Generic Doc',
      metadata: {},
      mode: 'generic',
      sections: [
        { id: 'section-1', heading: 'Overview', level: 2, body: '' },
        { id: 'section-2', heading: 'Details', level: 2, body: '' },
      ],
      comments: [],
    };

    const output = renderToc(doc);
    expect(output).toContain('1');
    expect(output).toContain('Overview');
    expect(output).toContain('2');
    expect(output).toContain('Details');
  });
});
