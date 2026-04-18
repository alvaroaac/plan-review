// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { detectRoles } from '../../src/browser/mermaid.js';

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
