import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { Review } from '../src/types.js';
import { DEFAULT_REVIEW_DIR, FileReviewStore, isReview } from '../src/reviewStore.js';

let dir: string;

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    version: 2,
    id: 'rv_abc12345',
    title: 'Plan',
    planPath: '/tmp/plan.md',
    status: 'open',
    createdAt: '2026-10-15T10:00:00.000Z',
    updatedAt: '2026-10-15T10:00:00.000Z',
    answers: {
      d1: { choice: 'a', note: '', itemHash: 'h1', round: 1, updatedAt: '2026-10-15T10:00:00.000Z' },
    },
    threads: [
      {
        id: 't_1',
        sectionId: 's1',
        anchor: null,
        resolved: false,
        outdated: false,
        createdRound: 1,
        comments: [{ id: 'c_1', author: 'reviewer', body: 'hi', createdAt: '2026-10-15T10:00:00.000Z' }],
      },
    ],
    rounds: [{ n: 1, plan: '# Plan', contentHash: 'sha256:x', startedAt: '2026-10-15T10:00:00.000Z' }],
    ...overrides,
  };
}

describe('FileReviewStore', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plan-review-reviews-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('defaults to ~/.plan-review/reviews', () => {
    expect(DEFAULT_REVIEW_DIR).toBe(join(homedir(), '.plan-review', 'reviews'));
  });

  it('round-trips a review', async () => {
    const store = new FileReviewStore({ dir });
    const review = makeReview();
    await store.save(review);
    expect(await store.get(review.id)).toEqual(review);
  });

  it('writes pretty-printed <id>.json, creating dir recursively, leaving no tmp files', async () => {
    const nested = join(dir, 'a', 'b');
    const store = new FileReviewStore({ dir: nested });
    await store.save(makeReview());
    expect(await readdir(nested)).toEqual(['rv_abc12345.json']);
    const raw = await readFile(join(nested, 'rv_abc12345.json'), 'utf-8');
    expect(raw).toContain('\n  "version": 2');
  });

  it('returns null for missing ids', async () => {
    expect(await new FileReviewStore({ dir }).get('rv_missing1')).toBeNull();
  });

  it('returns null for corrupt or malformed files without deleting them', async () => {
    const store = new FileReviewStore({ dir });
    await writeFile(join(dir, 'rv_bad1.json'), '{not json', 'utf-8');
    await writeFile(join(dir, 'rv_bad2.json'), JSON.stringify({ version: 2 }), 'utf-8');
    expect(await store.get('rv_bad1')).toBeNull();
    expect(await store.get('rv_bad2')).toBeNull();
    expect(existsSync(join(dir, 'rv_bad1.json'))).toBe(true);
    expect(existsSync(join(dir, 'rv_bad2.json'))).toBe(true);
  });

  it('rejects ids that do not match the id pattern', async () => {
    const store = new FileReviewStore({ dir: join(dir, 'reviews') });
    await writeFile(join(dir, 'outside.json'), JSON.stringify(makeReview({ id: 'outside' })), 'utf-8');
    expect(await store.get('../outside')).toBeNull();
    expect(await store.get('RV_ABC')).toBeNull();
    expect(await store.get('')).toBeNull();
  });

  it('lists valid reviews by updatedAt desc, skipping corrupt and non-json files', async () => {
    const store = new FileReviewStore({ dir });
    await store.save(makeReview({ id: 'rv_old', updatedAt: '2026-10-15T09:00:00.000Z' }));
    await store.save(makeReview({ id: 'rv_new', updatedAt: '2026-10-15T11:00:00.000Z' }));
    await writeFile(join(dir, 'rv_bad.json'), 'garbage', 'utf-8');
    await writeFile(join(dir, 'rv_malformed.json'), JSON.stringify({ ...makeReview(), updatedAt: null }), 'utf-8');
    await writeFile(join(dir, 'notes.txt'), 'x', 'utf-8');
    expect((await store.list()).map((r) => r.id)).toEqual(['rv_new', 'rv_old']);
  });

  it('lists an empty array when the dir does not exist', async () => {
    expect(await new FileReviewStore({ dir: join(dir, 'nope') }).list()).toEqual([]);
  });

  it('filters list by status', async () => {
    const store = new FileReviewStore({ dir });
    await store.save(makeReview({ id: 'rv_open' }));
    await store.save(makeReview({ id: 'rv_done', status: 'approved' }));
    expect((await store.list({ status: 'open' })).map((r) => r.id)).toEqual(['rv_open']);
  });

  it('finds the most recently updated open review for a plan path', async () => {
    const store = new FileReviewStore({ dir });
    await store.save(makeReview({ id: 'rv_older', updatedAt: '2026-10-15T09:00:00.000Z' }));
    await store.save(makeReview({ id: 'rv_newer', updatedAt: '2026-10-15T10:00:00.000Z' }));
    await store.save(
      makeReview({ id: 'rv_appr', status: 'approved', updatedAt: '2026-10-15T12:00:00.000Z' }),
    );
    await store.save(makeReview({ id: 'rv_other', planPath: '/tmp/other.md' }));
    expect((await store.findOpenByPlanPath('/tmp/plan.md'))?.id).toBe('rv_newer');
    expect(await store.findOpenByPlanPath('/tmp/none.md')).toBeNull();
  });
});

describe('isReview', () => {
  it('accepts a valid review', () => {
    expect(isReview(makeReview())).toBe(true);
  });

  it.each([
    ['null', null],
    ['missing createdAt', { ...makeReview(), createdAt: undefined }],
    ['non-string createdAt', { ...makeReview(), createdAt: 1 }],
    ['missing updatedAt', { ...makeReview(), updatedAt: undefined }],
    ['non-string updatedAt', { ...makeReview(), updatedAt: 1 }],
    ['array answers', { ...makeReview(), answers: [] }],
    ['null thread', { ...makeReview(), threads: [null] }],
    ['array thread', { ...makeReview(), threads: [[]] }],
    ...['id', 'sectionId', 'resolved', 'comments'].flatMap<[string, unknown]>((field) => [
      [`thread missing ${field}`, { ...makeReview(), threads: [{ ...makeReview().threads[0], [field]: undefined }] }],
      [`thread invalid ${field}`, { ...makeReview(), threads: [{ ...makeReview().threads[0], [field]: 1 }] }],
    ]),
    ['round missing startedAt', { ...makeReview(), rounds: [{ ...makeReview().rounds[0], startedAt: undefined }] }],
    ['round invalid startedAt', { ...makeReview(), rounds: [{ ...makeReview().rounds[0], startedAt: 1 }] }],
    ['wrong version', { ...makeReview(), version: 1 }],
    ['non-string id', { ...makeReview(), id: 1 }],
    ['non-string title', { ...makeReview(), title: undefined }],
    ['bad status', { ...makeReview(), status: 'closed' }],
    ['answers not object', { ...makeReview(), answers: null }],
    ['threads not array', { ...makeReview(), threads: {} }],
    ['empty rounds', { ...makeReview(), rounds: [] }],
    ['round without numeric n', { ...makeReview(), rounds: [{ n: '1', plan: '', contentHash: '' }] }],
    ['round without plan', { ...makeReview(), rounds: [{ n: 1, contentHash: '' }] }],
    ['round without contentHash', { ...makeReview(), rounds: [{ n: 1, plan: '' }] }],
  ])('rejects %s', (_name, value) => {
    expect(isReview(value)).toBe(false);
  });
});
