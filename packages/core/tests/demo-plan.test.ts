import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { extractItems } from '../src/items.js';
import { parse } from '../src/parser.js';

const markdown = readFileSync(new URL('../../../examples/demo-plan.md', import.meta.url), 'utf8');

describe('examples/demo-plan.md', () => {
  const { doc, items, warnings } = extractItems(parse(markdown));
  const decisions = items.filter((item) => item.kind === 'decision');
  const assumptions = items.filter((item) => item.kind === 'assumption');
  // Prose only: an item's own `quote:` line must not count as a match.
  const sectionProse = (sectionId: string): string =>
    doc.sections.find((s) => s.id === sectionId)!.body.replace(/```[\s\S]*?```/g, '');
  const quoted = items.filter((item) => item.quote !== undefined);

  it('parses with zero warnings', () => {
    expect(warnings).toEqual([]);
  });

  it('has decisions with and without an author pick', () => {
    expect(decisions.length).toBeGreaterThanOrEqual(2);
    expect(decisions.some((d) => d.options!.some((o) => o.pick))).toBe(true);
    expect(decisions.some((d) => d.options!.every((o) => !o.pick))).toBe(true);
  });

  it('has at least two assumptions', () => {
    expect(assumptions.length).toBeGreaterThanOrEqual(2);
  });

  it('has one quote found in its section and one that is not', () => {
    expect(quoted.some((item) => sectionProse(item.sectionId).includes(item.quote!))).toBe(true);
    expect(quoted.some((item) => !sectionProse(item.sectionId).includes(item.quote!))).toBe(true);
  });
});
