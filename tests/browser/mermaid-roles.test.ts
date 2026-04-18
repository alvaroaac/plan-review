// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { detectRoles, parseBranchLabels } from '../../src/browser/mermaid.js';

describe('detectRoles', () => {
  it('maps {label} nodes to decision', () => {
    const r = detectRoles('flowchart TD\n  A{Valid?}');
    expect(r.A).toBe('decision');
  });

  it('maps {{label}} nodes to decision', () => {
    const r = detectRoles('flowchart TD\n  A{{Valid?}}');
    expect(r.A).toBe('decision');
  });

  it('maps ([start]) stadium to start role', () => {
    const r = detectRoles('flowchart TD\n  Begin([Start here])');
    expect(r.Begin).toBe('start');
  });

  it('maps ((init)) circle to start role', () => {
    const r = detectRoles('flowchart TD\n  X((begin))');
    expect(r.X).toBe('start');
  });

  it('maps ([end]) stadium to end role', () => {
    const r = detectRoles('flowchart TD\n  Done([End of flow])');
    expect(r.Done).toBe('end');
  });

  it('maps [label with "error"] to error role', () => {
    const r = detectRoles('flowchart TD\n  F[Auth error log]');
    expect(r.F).toBe('error');
  });

  it('maps [label with "fail"] to error role', () => {
    const r = detectRoles('flowchart TD\n  F[Fail fast]');
    expect(r.F).toBe('error');
  });

  it('maps [/label/] parallelogram to io role', () => {
    const r = detectRoles('flowchart TD\n  I[/User input/]');
    expect(r.I).toBe('io');
  });

  it('leaves normal [label] nodes unset (caller defaults to process)', () => {
    const r = detectRoles('flowchart TD\n  P[Serve resource]');
    expect(r.P).toBeUndefined();
  });

  it('returns empty object for empty source', () => {
    expect(detectRoles('')).toEqual({});
  });

  it('first match wins — decision before error', () => {
    const r = detectRoles('flowchart TD\n  X{error occurred?}');
    expect(r.X).toBe('decision');
  });

  it('does not cross-match across lines', () => {
    const r = detectRoles('flowchart TD\n  A[Process one]\n  B{Decide}\n  C[Fail]');
    expect(r.A).toBeUndefined();
    expect(r.B).toBe('decision');
    expect(r.C).toBe('error');
  });
});

describe('parseBranchLabels', () => {
  it('maps "Yes" label to yes branch', () => {
    const r = parseBranchLabels('flowchart TD\n  A -->|Yes| B');
    expect(r).toEqual([{ from: 'A', to: 'B', branch: 'yes', label: 'Yes' }]);
  });

  it('maps "No" label to no branch', () => {
    const r = parseBranchLabels('flowchart TD\n  A -->|No| B');
    expect(r).toEqual([{ from: 'A', to: 'B', branch: 'no', label: 'No' }]);
  });

  it('accepts yes synonyms (true/ok/success/pass/1)', () => {
    for (const syn of ['true', 'ok', 'success', 'pass', '1']) {
      const r = parseBranchLabels(`flowchart TD\n  A -->|${syn}| B`);
      expect(r[0].branch).toBe('yes');
    }
  });

  it('accepts no synonyms (false/fail/error/reject/0)', () => {
    for (const syn of ['false', 'fail', 'error', 'reject', '0']) {
      const r = parseBranchLabels(`flowchart TD\n  A -->|${syn}| B`);
      expect(r[0].branch).toBe('no');
    }
  });

  it('leaves unknown labels with null branch', () => {
    const r = parseBranchLabels('flowchart TD\n  A -->|maybe| B');
    expect(r[0].branch).toBeNull();
  });

  it('ignores unlabeled edges', () => {
    const r = parseBranchLabels('flowchart TD\n  A --> B');
    expect(r).toEqual([]);
  });

  it('handles multiple edges across the source', () => {
    const r = parseBranchLabels(`flowchart TD
  A -->|Yes| B
  A -->|No| C
  C --> D`);
    expect(r).toHaveLength(2);
    expect(r.map(e => e.branch)).toEqual(['yes', 'no']);
  });

  it('handles mixed arrow styles', () => {
    const r = parseBranchLabels(`flowchart TD
  A -->|yes| B
  B ==>|no| C
  C -.->|pass| D`);
    expect(r).toHaveLength(3);
    expect(r.map(e => e.branch)).toEqual(['yes', 'no', 'yes']);
  });
});

import { applyRoles } from '../../src/browser/mermaid.js';

function buildSvg(inner: string): SVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.innerHTML = inner;
  return svg as SVGElement;
}

describe('applyRoles', () => {
  it('sets data-role on a <g class="node"> whose id matches a detected key', () => {
    const svg = buildSvg('<g class="node" id="flowchart-A-0"><rect/></g>');
    applyRoles(svg, { A: 'decision' });
    expect(svg.querySelector('g.node')!.getAttribute('data-role')).toBe('decision');
  });

  it('matches id with dash or underscore separators', () => {
    const svg = buildSvg(`
      <g class="node" id="flowchart-X-0"><rect/></g>
      <g class="node" id="graph_Y_1"><rect/></g>
    `);
    applyRoles(svg, { X: 'start', Y: 'end' });
    const nodes = svg.querySelectorAll('g.node');
    expect(nodes[0].getAttribute('data-role')).toBe('start');
    expect(nodes[1].getAttribute('data-role')).toBe('end');
  });

  it('falls back to "decision" for a polygon node with no regex match', () => {
    const svg = buildSvg('<g class="node" id="flowchart-Z-0"><polygon/></g>');
    applyRoles(svg, {}); // Z not in roles
    expect(svg.querySelector('g.node')!.getAttribute('data-role')).toBe('decision');
  });

  it('falls back to "process" for a non-polygon node with no regex match', () => {
    const svg = buildSvg('<g class="node" id="flowchart-W-0"><rect/></g>');
    applyRoles(svg, {});
    expect(svg.querySelector('g.node')!.getAttribute('data-role')).toBe('process');
  });

  it('leaves no node untagged', () => {
    const svg = buildSvg(`
      <g class="node" id="flowchart-A-0"><rect/></g>
      <g class="node" id="flowchart-B-0"><polygon/></g>
      <g class="node" id="flowchart-C-0"><rect/></g>
    `);
    applyRoles(svg, { A: 'start' });
    for (const g of svg.querySelectorAll('g.node')) {
      expect(g.getAttribute('data-role')).toBeTruthy();
    }
  });
});
