import { describe, it, expect } from 'vitest';
import {
  contentHash, hashItem, itemCounts, itemState, newCommentId, newReviewId, newThreadId,
} from '../src/reviewModel.js';
import type { Answer, ReviewItem } from '../src/types.js';

const base = {
  kind: 'decision' as const,
  question: 'Which backoff?',
  options: [
    { key: 'A', text: 'Fixed', detail: 'simple', pick: true },
    { key: 'B', text: 'Exponential', pick: false },
  ],
};

function makeItem(over: Partial<ReviewItem> & { id: string }): ReviewItem {
  const item = { kind: 'decision' as const, label: 'L', question: 'Q', sectionId: 's1', hash: '', ...over };
  return { ...item, hash: over.hash ?? hashItem(item) };
}

function answer(item: ReviewItem, choice: string, over: Partial<Answer> = {}): Answer {
  return { choice, note: '', itemHash: item.hash, round: 1, updatedAt: '2026-10-15T00:00:00.000Z', ...over };
}

describe('hashItem', () => {
  it('is 8-char lowercase hex', () => {
    expect(hashItem(base)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('ignores pick, label, context and quote', () => {
    const flipped = { ...base, options: base.options.map((o) => ({ ...o, pick: !o.pick })) };
    const noisy = { ...base, label: 'x', context: 'c', quote: 'q' };
    expect(hashItem(flipped)).toBe(hashItem(base));
    expect(hashItem(noisy)).toBe(hashItem(base));
  });

  it('changes when question text changes', () => {
    expect(hashItem({ ...base, question: 'Other?' })).not.toBe(hashItem(base));
  });

  it('changes when an option is added or removed', () => {
    const added = { ...base, options: [...base.options, { key: 'C', text: 'Jitter', pick: false }] };
    const removed = { ...base, options: base.options.slice(0, 1) };
    expect(hashItem(added)).not.toBe(hashItem(base));
    expect(hashItem(removed)).not.toBe(hashItem(base));
  });

  it('changes when an option text or detail changes', () => {
    const text = { ...base, options: [{ ...base.options[0], text: 'Fixed!' }, base.options[1]] };
    const detail = { ...base, options: [{ ...base.options[0], detail: 'other' }, base.options[1]] };
    expect(hashItem(text)).not.toBe(hashItem(base));
    expect(hashItem(detail)).not.toBe(hashItem(base));
  });
});

describe('contentHash', () => {
  it('is stable and sensitive to content', () => {
    expect(contentHash('a')).toBe(contentHash('a'));
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });
});

describe('itemState', () => {
  const item = makeItem({ id: 'i1', ...base });

  it('is open without an answer', () => {
    expect(itemState(item, undefined)).toBe('open');
  });

  it('is changed when the answer hash is stale, even if deferred', () => {
    expect(itemState(item, answer(item, 'A', { itemHash: 'stale000' }))).toBe('changed');
    expect(itemState(item, answer(item, 'deferred', { itemHash: 'stale000' }))).toBe('changed');
  });

  it('is deferred for a current deferred answer', () => {
    expect(itemState(item, answer(item, 'deferred'))).toBe('deferred');
  });

  it('is done for any other current answer', () => {
    expect(itemState(item, answer(item, 'A'))).toBe('done');
  });
});

describe('itemCounts', () => {
  const d1 = makeItem({ id: 'd1', ...base });
  const d2 = makeItem({ id: 'd2', ...base });
  const d3 = makeItem({ id: 'd3', ...base });
  const d4 = makeItem({ id: 'd4', ...base });
  const a1 = makeItem({ id: 'a1', kind: 'assumption' });
  const a2 = makeItem({ id: 'a2', kind: 'assumption' });
  const a3 = makeItem({ id: 'a3', kind: 'assumption' });
  const a4 = makeItem({ id: 'a4', kind: 'assumption' });
  const a5 = makeItem({ id: 'a5', kind: 'assumption' });
  const items = [d1, d2, d3, d4, a1, a2, a3, a4, a5];

  it('tallies by kind and state, counting changed as open', () => {
    const answers = {
      d1: answer(d1, 'A'),
      d2: answer(d2, 'deferred'),
      d3: answer(d3, 'A', { itemHash: 'stale000' }),
      a1: answer(a1, 'holds'),
      a2: answer(a2, 'unsure'),
      a3: answer(a3, 'no', { note: 'because' }),
      a4: answer(a4, 'deferred'),
    };
    expect(itemCounts(items, answers)).toEqual({
      decisions: { answered: 1, deferred: 1, open: 2 },
      assumptions: { holds: 1, unsure: 1, no: 1, deferred: 1, open: 1 },
    });
  });

  it('ignores answers for unknown item ids', () => {
    const stray = answer(d1, 'A');
    expect(itemCounts([d1], { ghost: stray }).decisions).toEqual({ answered: 0, deferred: 0, open: 1 });
  });
});

describe('id generators', () => {
  it('match their documented formats', () => {
    expect(newReviewId()).toMatch(/^rv_[0-9a-z]{8}$/);
    expect(newThreadId()).toMatch(/^t_[0-9a-z]{6}$/);
    expect(newCommentId()).toMatch(/^c_[0-9a-z]{8}$/);
  });

  it('are not constant', () => {
    expect(new Set(Array.from({ length: 20 }, newReviewId)).size).toBeGreaterThan(1);
  });
});


describe('own-property answer lookups', () => {
  it('counts constructor and inherited answers as open', () => {
    const item = makeItem({ id: 'constructor', kind: 'assumption' });
    const answers: Record<string, Answer> = Object.create({ constructor: answer(item, 'holds') });
    expect(itemCounts([item], answers).assumptions).toEqual({ holds: 0, unsure: 0, no: 0, deferred: 0, open: 1 });
    expect(itemCounts([item], {}).assumptions.open).toBe(1);
  });
});
