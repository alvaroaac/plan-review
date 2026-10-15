import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as core from '../src/index.js';
// @ts-expect-error SessionLoadResult is intentionally not part of the public API.
import type { SessionLoadResult } from '../src/index.js';

type _RemovedSessionLoadResultGuard = SessionLoadResult;

describe('@plan-review/core public API', () => {
  it('exports session store and autosave APIs', () => {
    expect(core.computeContentHash).toEqual(expect.any(Function));
    expect(core.DEFAULT_SESSION_DIR).toEqual(expect.any(String));
    expect(core.FileSessionStore).toEqual(expect.any(Function));
    expect(core.createAutosave).toEqual(expect.any(Function));
  });

  it('does not export removed module-level session helpers', () => {
    expect('saveSession' in core).toBe(false);
    expect('loadSession' in core).toBe(false);
    expect('clearSession' in core).toBe(false);
    expect('listSessions' in core).toBe(false);
    expect('getSessionDir' in core).toBe(false);
  });

  it('exports the v2 review model helpers and client', () => {
    expect(core.hashItem).toEqual(expect.any(Function));
    expect(core.itemState).toEqual(expect.any(Function));
    expect(core.itemCounts).toEqual(expect.any(Function));
    expect(core.FakeReviewClient).toEqual(expect.any(Function));
  });

  it('keeps reviewModel browser-safe', () => {
    const source = readFileSync(new URL('../src/reviewModel.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/node:/);
  });
});
