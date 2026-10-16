import { describe, it, expect } from 'vitest';
import { isProgressUpdate, isSubmitRequest } from '../../src/protocol.js';
import { answer, thread } from './reviewFixtures.js';

import { invalidProgress, invalidSubmits } from './invalidPayloads.js';

describe('v2 payload validation', () => {
  it('accepts valid answers, threads, both comment authors and null anchors', () => {
    expect(isProgressUpdate({ answers: { storage: answer }, threads: [thread('s'), { ...thread('s'), anchor: null, comments: [{ ...thread('s').comments[0], author: 'agent' }] }] })).toBe(true);
  });
  it('accepts a merge update', () => {
    expect(isProgressUpdate({ answers: {}, threads: [thread('s')], merge: true })).toBe(true);
  });
  it.each(invalidProgress)('rejects %s', (_name, input) => { expect(isProgressUpdate(input)).toBe(false); });
  it.each(invalidSubmits.map((input) => [input]))('rejects invalid submit %j', (input) => { expect(isSubmitRequest(input)).toBe(false); });
  it.each(['approved', 'changes_requested'])('accepts %s submit', (verdict) => { expect(isSubmitRequest({ verdict, summary: '' })).toBe(true); });
});
