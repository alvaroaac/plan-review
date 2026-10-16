import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import * as core from '../src/index.js';
import { extractItems } from '../src/items.js';
import { renderToLineBlocks } from '../src/lineBlocks.js';
import { parse } from '../src/parser.js';
import { contentHash, itemState } from '../src/reviewModel.js';
import type { ReviewStore } from '../src/reviewStore.js';
import {
  carryForward, openReview, ReviewApprovedError, ReviewNotFoundError, saveProgress, submitRound,
} from '../src/rounds.js';
import type { OpenedReview, OpenReviewInput } from '../src/rounds.js';
import type { Answer, Review, Round, SplitStrategy, Thread } from '../src/types.js';

const BEFORE = '2026-10-15T10:00:00.000Z';
const NOW = new Date('2026-10-15T12:00:00.000Z');
const PLAN = '# Test Plan\n\n## Original\n\nKeep these words.\nSecond line.';
const PATH = '/tmp/plan.md';

function fence(info: string, body: string): string {
  return `\`\`\`${info}\n${body}\n\`\`\``;
}

function decision(id = 'retry', question = 'Which retry?'): string {
  return fence(`decision id=${id}`, `question: ${question}\n- A: Fixed\n- B: Exponential`);
}

function makeRound(plan = PLAN, overrides: Partial<Round> = {}): Round {
  return { n: 1, plan, contentHash: contentHash(plan), startedAt: BEFORE, ...overrides };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    version: 2, id: 'rv_abc12345', title: 'Test Plan', planPath: PATH,
    status: 'open', createdAt: BEFORE, updatedAt: BEFORE,
    answers: {}, threads: [], rounds: [makeRound()], ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 't_abc123', sectionId: 'section-1',
    anchor: { type: 'lines', startLine: 0, endLine: 0, lineTexts: ['Keep these words. Second line.'] },
    resolved: false, outdated: false, createdRound: 1,
    comments: [{ id: 'c_abc12345', author: 'reviewer', body: 'Please check.', createdAt: BEFORE }],
    ...overrides,
  };
}

function makeAnswer(overrides: Partial<Answer> = {}): Answer {
  return { choice: 'A', note: '', itemHash: 'old-hash', round: 1, updatedAt: BEFORE, ...overrides };
}

function makeStore(...reviews: Review[]) {
  const data = new Map(reviews.map((review) => [review.id, structuredClone(review)]));
  const store = {
    get: vi.fn(async (id: string) => structuredClone(data.get(id) ?? null)),
    save: vi.fn(async (review: Review) => { data.set(review.id, structuredClone(review)); }),
    list: vi.fn(async (filter?: { status?: Review['status'] }) =>
      structuredClone([...data.values()].filter((review) => !filter?.status || review.status === filter.status)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))),
    findOpenByPlanPath: vi.fn(async (path: string) => structuredClone(
      [...data.values()].filter((review) => review.planPath === path && review.status === 'open')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null)),
  } satisfies ReviewStore;
  return store;
}

function extract(markdown: string, splitBy?: SplitStrategy) {
  return extractItems(parse(markdown, splitBy));
}

function freezeDeep(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
}

describe('openReview resolution', () => {
  for (const state of ['missing', 'approved', 'open'] as const) {
    for (const planPath of [undefined, PATH]) {
      for (const fresh of [false, true]) {
        it(`resolves explicit ${state} id with path=${planPath ?? 'stdin'}, fresh=${fresh}`, async () => {
          const existing = makeReview({ status: state === 'approved' ? 'approved' : 'open' });
          const store = makeStore(...(state === 'missing' ? [] : [existing]));
          const input: OpenReviewInput = { markdown: PLAN, reviewId: existing.id, planPath, fresh, now: NOW };
          if (state === 'missing') {
            await expect(openReview(store, input)).rejects.toThrow(new ReviewNotFoundError(existing.id));
            expect(store.save).not.toHaveBeenCalled();
          } else if (state === 'approved') {
            await expect(openReview(store, input)).rejects.toThrow(new ReviewApprovedError(existing.id));
            expect(store.save).not.toHaveBeenCalled();
          } else {
            const opened: OpenedReview = await openReview(store, input);
            expect(opened.review.id).toBe(existing.id);
            expect(opened.review.planPath).toBe(PATH);
          }
          expect(store.get).toHaveBeenCalledExactlyOnceWith(existing.id);
          expect(store.findOpenByPlanPath).not.toHaveBeenCalled();
        });
      }
    }
  }

  for (const state of ['missing', 'approved', 'open'] as const) {
    for (const planPath of [undefined, PATH]) {
      for (const fresh of [false, true]) {
        it(`resolves without id for ${state} review, path=${planPath ?? 'stdin'}, fresh=${fresh}`, async () => {
          const existing = makeReview({ status: state === 'approved' ? 'approved' : 'open' });
          const store = makeStore(...(state === 'missing' ? [] : [existing]));
          const { review } = await openReview(store, { markdown: PLAN, planPath, fresh, now: NOW });
          const resumes = state === 'open' && planPath !== undefined && !fresh;
          if (resumes) expect(review.id).toBe(existing.id);
          else {
            expect(review.id).toMatch(/^rv_[0-9a-z]{8}$/);
            expect(review.id).not.toBe(existing.id);
            expect(review).toMatchObject({
              version: 2, title: 'Test Plan', status: 'open',
              createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), answers: {}, threads: [],
            });
            expect(review.planPath).toBe(planPath);
            expect(review.rounds).toEqual([makeRound(PLAN, { startedAt: NOW.toISOString() })]);
          }
          if (resumes) expect(store.get).toHaveBeenCalledExactlyOnceWith(existing.id);
          else expect(store.get).not.toHaveBeenCalled();
          if (planPath && !fresh) expect(store.findOpenByPlanPath).toHaveBeenCalledExactlyOnceWith(planPath);
          else expect(store.findOpenByPlanPath).not.toHaveBeenCalled();
          expect(store.save).toHaveBeenCalledExactlyOnceWith(review);
        });
      }
    }
  }

  it('uses the most recently updated open review for the path', async () => {
    const older = makeReview();
    const newer = makeReview({ id: 'rv_new12345', updatedAt: '2026-10-15T11:00:00.000Z' });
    const unrelated = makeReview({ id: 'rv_else1234', planPath: '/tmp/else.md', updatedAt: NOW.toISOString() });
    const { review } = await openReview(makeStore(older, newer, unrelated), { markdown: PLAN, planPath: PATH, now: NOW });
    expect(review.id).toBe(newer.id);
  });

  it('provides the exact error messages', () => {
    expect(new ReviewNotFoundError('rv_missing').message).toBe('Review rv_missing not found');
    expect(new ReviewApprovedError('rv_done').message)
      .toBe('Review rv_done is approved; run without --review to start a new review');
  });
});

describe('openReview rounds and loaded view', () => {
  it('resumes an unchanged unsubmitted round without a banner or round changes', async () => {
    const existing = makeReview({ rounds: [makeRound(PLAN, { n: 3 })], threads: [makeThread()] });
    const store = makeStore(existing);
    const { review, loaded } = await openReview(store, { markdown: PLAN, reviewId: existing.id, now: NOW });
    expect(review).toEqual({ ...existing, updatedAt: NOW.toISOString() });
    expect(loaded.review).not.toHaveProperty('banner');
    expect(loaded.review.round).toBe(3);
    expect(loaded.review.updatedAt).toBe(NOW.toISOString());
    expect(store.save).toHaveBeenCalledExactlyOnceWith(review);
    expect(await store.get(review.id)).toEqual(review);
  });

  it('replaces a changed paused snapshot after re-anchoring against its old heading', async () => {
    const markdown = '# Test Plan\n\n## Inserted\n\nKeep these words. Second line.\n\n## Original\n\nMoved down.\n\nKeep these words. Second line.';
    const existing = makeReview({ threads: [makeThread()], rounds: [makeRound(PLAN, { n: 3 })] });
    const store = makeStore(existing);
    const { review, loaded } = await openReview(store, { markdown, reviewId: existing.id, now: NOW });
    expect(review.rounds).toEqual([makeRound(markdown, { n: 3 })]);
    expect(review.threads[0]).toEqual({
      ...existing.threads[0], sectionId: 'section-2', anchor: { ...existing.threads[0].anchor!, startLine: 1, endLine: 1 },
    });
    expect(loaded.review.banner).toBe('planChangedWhilePaused');
    expect(loaded.review.round).toBe(3);
    expect(review.updatedAt).toBe(NOW.toISOString());
    expect(store.save).toHaveBeenCalledExactlyOnceWith(review);
  });

  for (const unchanged of [false, true]) {
    it(`appends after a submitted round with unchanged=${unchanged}`, async () => {
      const previous = makeRound(PLAN, { n: 3, submittedAt: BEFORE, verdict: 'changes_requested', summary: 'Revise.' });
      const existing = makeReview({ rounds: [previous], threads: [makeThread({ outdated: true })] });
      const markdown = unchanged ? PLAN : '# Test Plan\n\n## Inserted\n\nKeep these words. Second line.\n\n## Original\n\nKeep these words. Second line.';
      const store = makeStore(existing);
      const { review, loaded } = await openReview(store, { markdown, reviewId: existing.id, now: NOW });
      expect(review.rounds).toEqual([previous, makeRound(markdown, { n: 4, startedAt: NOW.toISOString() })]);
      expect(review.threads[0]).toEqual({ ...existing.threads[0], sectionId: unchanged ? 'section-1' : 'section-2', outdated: false });
      if (unchanged) expect(loaded.review.banner).toBe('planUnchanged');
      else expect(loaded.review).not.toHaveProperty('banner');
      expect(loaded.review.round).toBe(4);
      expect(review.updatedAt).toBe(NOW.toISOString());
      expect(store.save).toHaveBeenCalledExactlyOnceWith(review);
    });
  }

  it('opens round one when there are no rounds', async () => {
    const existing = makeReview({ rounds: [] });
    const { review, loaded } = await openReview(makeStore(existing), { markdown: PLAN, reviewId: existing.id, now: NOW });
    expect(review.rounds).toEqual([makeRound(PLAN, { startedAt: NOW.toISOString() })]);
    expect(loaded.review.round).toBe(1);
    expect(loaded.review).not.toHaveProperty('banner');
  });

  it('loads the reply-stripped document, current items, visible answers and extraction/unknown reply warnings', async () => {
    const markdown = `${PLAN}\n\n${decision()}\n\n${fence('reply thread=t_abc123', ' Revised. ')}\n\n${fence('reply thread=t_unknown', 'Ignore.')}\n\n${fence('decision', 'question: Missing id')}`;
    const current = extract(markdown);
    const answers = { retry: makeAnswer(), hidden: makeAnswer() };
    const existing = makeReview({ answers, threads: [makeThread()] });
    const store = makeStore(existing);
    const { review, loaded } = await openReview(store, { markdown, reviewId: existing.id, now: NOW });
    expect(loaded.document).toEqual(current.doc);
    expect(loaded.document.sections[0].body).not.toContain('```reply');
    expect(loaded.items).toEqual(current.items);
    expect(loaded.review).toMatchObject({ id: existing.id, status: 'open', answers: { retry: answers.retry }, threads: review.threads });
    expect(loaded.warnings).toEqual([...current.warnings, 'Reply to unknown thread t_unknown ignored']);
    expect(review.answers).toEqual(answers);
    expect((await store.get(review.id))?.answers).toEqual(answers);
    expect(review.rounds[0].plan).toBe(markdown);
    expect(review.threads[0].comments[1]).toMatchObject({ author: 'agent', body: 'Revised.', createdAt: NOW.toISOString() });
  });

  it('passes splitBy to both current parsing and previous-snapshot parsing', async () => {
    const old = '# Test Plan\n\nIntroductory text.\n\n---\n\n## Original\n\nKeep these words.';
    const markdown = '# Test Plan\n\nIntroductory text.\n\n---\n\n## Inserted\n\nKeep these words.\n\n---\n\n## Original\n\nKeep these words.';
    const existing = makeReview({ rounds: [makeRound(old)], threads: [makeThread({
      sectionId: 'section-2', anchor: { type: 'lines', startLine: 1, endLine: 1, lineTexts: ['Keep these words.'] },
    })] });
    const { review, loaded } = await openReview(makeStore(existing), {
      markdown, reviewId: existing.id, splitBy: 'separator', now: NOW,
    });
    expect(loaded.document.sections).toHaveLength(3);
    expect(review.threads[0].sectionId).toBe('section-3');
  });
});

describe('carryForward', () => {
  it('preserves a stored anchor on the second repeated paragraph', () => {
    const plan = '# Plan\n\n## Tests\n\nSame.\n\nBetween.\n\nSame.';
    const thread = makeThread({ anchor: { type: 'lines', startLine: 2, endLine: 2, lineTexts: ['Same.'] } });
    const review = makeReview({ rounds: [makeRound(plan)], threads: [thread] });
    expect(carryForward(review, extract(plan), NOW).threads[0]).toEqual(thread);
  });

  it('keeps all stored answers untouched, including changed and absent items', () => {
    const current = extract(`${PLAN}\n\n${decision('kept')}\n\n${decision('changed', 'New question?')}`);
    const answers = {
      kept: makeAnswer({ itemHash: current.items[0].hash }),
      changed: makeAnswer({ choice: 'deferred' }), absent: makeAnswer(),
    };
    const review = makeReview({ answers });
    const carried = carryForward(review, current, NOW);
    expect(carried.answers).toEqual(answers);
    expect(itemState(current.items[0], carried.answers.kept)).toBe('done');
    expect(itemState(current.items[1], carried.answers.changed)).toBe('changed');
  });

  it('prefers the old heading over an earlier match and moves the anchor to the matched blocks', () => {
    const thread = makeThread({ outdated: true });
    const current = extract('# Test Plan\n\n## Earlier\n\nKeep these words. Second line.\n\n## Original\n\nNew intro.\n\nKeep **these** words.\nSecond line.');
    const carried = carryForward(makeReview({ threads: [thread] }), current, NOW);
    expect(carried.threads[0]).toEqual({
      ...thread, sectionId: 'section-2', outdated: false, anchor: { ...thread.anchor!, startLine: 1, endLine: 1 },
    });
  });

  it('matches a multi-block anchor ignoring only whitespace and stores the current block texts', () => {
    const thread = makeThread({ anchor: {
      type: 'lines', startLine: 0, endLine: 1, lineTexts: ['Keep these words.', 'const a  =  1;\nconst b = 2;'],
    } });
    const current = extract('# Test Plan\n\n## Original\n\nIntro.\n\nKeep these words.\n\n```ts\nconst a = 1;\n  const b = 2;\n```');
    expect(carryForward(makeReview({ threads: [thread] }), current, NOW).threads[0].anchor).toEqual({
      type: 'lines', startLine: 1, endLine: 2, lineTexts: ['Keep these words.', 'const a = 1;\n  const b = 2;'],
    });
  });

  it.each([
    ['punctuation', 'Use a-b.', 'Use a+b.'],
    ['letter case', 'Keep these words.', 'KEEP these words.'],
    ['non-ASCII text', '設計を確認する。', '別の文章です。'],
  ])('treats a %s change as a different line', (_, anchored, current) => {
    const thread = makeThread({ anchor: { type: 'lines', startLine: 0, endLine: 0, lineTexts: [anchored] } });
    const carried = carryForward(makeReview({ threads: [thread] }), extract(`# Test Plan\n\n## Original\n\n${current}`), NOW);
    expect(carried.threads[0]).toEqual({ ...thread, outdated: true });
  });

  it('matches non-ASCII anchors by their text', () => {
    const thread = makeThread({ anchor: { type: 'lines', startLine: 0, endLine: 0, lineTexts: ['設計を確認する。'] } });
    const current = extract('# Test Plan\n\n## Original\n\n別の文章です。\n\n設計を確認する。');
    expect(carryForward(makeReview({ threads: [thread] }), current, NOW).threads[0])
      .toEqual({ ...thread, anchor: { ...thread.anchor!, startLine: 1, endLine: 1 } });
  });

  it('counts item fences as single blocks when locating an anchor', () => {
    const current = extract(`# Test Plan\n\n## Original\n\n${decision()}\n\nKeep these words. Second line.`);
    expect(carryForward(makeReview({ threads: [makeThread()] }), current, NOW).threads[0].anchor)
      .toMatchObject({ startLine: 1, endLine: 1 });
  });

  it('moves an anchor to the first matching section in document order', () => {
    const thread = makeThread();
    const current = extract('# Test Plan\n\n## Original\n\nReplaced.\n\n## First match\n\nKeep these words. Second line.\n\n## Later match\n\nKeep these words. Second line.');
    expect(carryForward(makeReview({ threads: [thread] }), current, NOW).threads[0])
      .toEqual({ ...thread, sectionId: 'section-2', outdated: false });
  });

  it('finds an anchor elsewhere when its old heading disappeared', () => {
    const thread = makeThread();
    expect(carryForward(makeReview({ threads: [thread] }), extract('# Plan\n\n## Renamed\n\nKeep these words. Second line.'), NOW).threads[0])
      .toEqual(thread);
  });

  it('marks an unmatched anchor outdated without altering its location or texts', () => {
    const thread = makeThread();
    expect(carryForward(makeReview({ threads: [thread] }), extract('# Plan\n\n## Original\n\nDifferent words.'), NOW).threads[0])
      .toEqual({ ...thread, outdated: true });
  });

  it('updates a section-level thread by its old heading despite changed section ids', () => {
    const thread = makeThread({ anchor: null });
    const current = extract('# Plan\n\n## Inserted\n\nNew content.\n\n## Original\n\nDifferent words.');
    expect(carryForward(makeReview({ threads: [thread] }), current, NOW).threads[0])
      .toEqual({ ...thread, sectionId: 'section-2' });
  });

  it('marks a section-level thread outdated if its old heading disappeared', () => {
    const thread = makeThread({ anchor: null });
    expect(carryForward(makeReview({ threads: [thread] }), extract('# Plan\n\n## Renamed\n\nKeep these words.'), NOW).threads[0])
      .toEqual({ ...thread, outdated: true });
  });

  it('re-anchors resolved threads too', () => {
    const thread = makeThread({ resolved: true });
    expect(carryForward(makeReview({ threads: [thread] }), extract('# Entirely changed'), NOW).threads[0])
      .toEqual({ ...thread, outdated: true });
    const moved = extract('# Test Plan\n\n## Inserted\n\nNew.\n\n## Original\n\nKeep these words. Second line.');
    expect(carryForward(makeReview({ threads: [thread] }), moved, NOW).threads[0])
      .toEqual({ ...thread, sectionId: 'section-2' });
  });

  it('appends agent replies with generated ids and injected timestamps in order', () => {
    const thread = makeThread();
    const current = extract(`${PLAN}\n\n${fence('reply thread=t_abc123', ' First. ')}\n\n${fence('reply thread=t_abc123', 'Second.\nMore detail.')}`);
    const comments = carryForward(makeReview({ threads: [thread] }), current, NOW).threads[0].comments;
    expect(comments).toEqual([thread.comments[0],
      { id: expect.stringMatching(/^c_[0-9a-z]{8}$/), author: 'agent', body: 'First.', createdAt: NOW.toISOString() },
      { id: expect.stringMatching(/^c_[0-9a-z]{8}$/), author: 'agent', body: 'Second.\nMore detail.', createdAt: NOW.toISOString() },
    ]);
  });

  it('deduplicates trimmed agent bodies across old comments and replies in the same extraction', () => {
    const thread = makeThread({ comments: [{ id: 'c_old', author: 'agent', body: '  Already done.\n ', createdAt: BEFORE }] });
    const current = extract(`${PLAN}\n\n${fence('reply thread=t_abc123', 'Already done.')}\n\n${fence('reply thread=t_abc123', 'New.')}\n\n${fence('reply thread=t_abc123', ' New. ')}`);
    const carried = carryForward(makeReview({ threads: [thread] }), current, NOW);
    expect(carried.threads[0].comments.map((comment) => comment.body)).toEqual(['  Already done.\n ', 'New.']);
    expect(carryForward(carried, current, NOW).threads[0].comments).toEqual(carried.threads[0].comments);
  });

  it('does not deduplicate against reviewer comments', () => {
    const thread = makeThread();
    const current = extract(`${PLAN}\n\n${fence('reply thread=t_abc123', thread.comments[0].body)}`);
    expect(carryForward(makeReview({ threads: [thread] }), current, NOW).threads[0].comments).toHaveLength(2);
  });

  for (const duplicate of [false, true]) {
    it(`only reopens a resolved thread on a new reply, duplicate=${duplicate}`, () => {
      const thread = makeThread({ resolved: true, ...(duplicate ? {
        comments: [{ id: 'c_old', author: 'agent', body: 'Fixed.', createdAt: BEFORE }],
      } : {}) });
      const current = extract(`${PLAN}\n\n${fence('reply thread=t_abc123', 'Fixed.')}`);
      const carried = carryForward(makeReview({ threads: [thread] }), current, NOW);
      expect(carried.threads[0].resolved).toBe(duplicate);
      if (duplicate) expect(carried.threads[0]).toEqual(thread);
      expect(carried.threads[0].comments).toHaveLength(duplicate ? 1 : 2);
    });
  }

  it('ignores unknown replies without mutating either input and returns only updated threads', () => {
    const review = makeReview({ threads: [makeThread()], answers: { kept: makeAnswer() } });
    const current = extract(`${PLAN}\n\n${fence('reply thread=t_abc123', 'Fixed.')}\n\n${fence('reply thread=t_missing', 'Unknown.')}`);
    const beforeReview = structuredClone(review);
    const beforeExtract = structuredClone(current);
    freezeDeep(review);
    freezeDeep(current);
    const carried = carryForward(review, current, NOW);
    expect(review).toEqual(beforeReview);
    expect(current).toEqual(beforeExtract);
    expect(carried).toEqual({ ...beforeReview, threads: [{
      ...beforeReview.threads[0], comments: [...beforeReview.threads[0].comments,
        { id: expect.stringMatching(/^c_[0-9a-z]{8}$/), author: 'agent', body: 'Fixed.', createdAt: NOW.toISOString() }],
    }] });
  });
});

describe('saveProgress', () => {
  it('replaces current answers and threads and persists with the injected timestamp', async () => {
    const existing = makeReview({ answers: { removed: makeAnswer() }, threads: [makeThread()] });
    const store = makeStore(existing);
    const update = { answers: { replacement: makeAnswer() }, threads: [makeThread({ id: 't_new123' })] };
    const review = await saveProgress(store, existing.id, update, NOW, new Set(['removed', 'replacement']));
    expect(review).toEqual({ ...existing, ...update, updatedAt: NOW.toISOString() });
    expect(store.save).toHaveBeenCalledExactlyOnceWith(review);
    expect(await store.get(existing.id)).toEqual(review);
  });

  it('allows replacing all progress with empty collections', async () => {
    const existing = makeReview({ answers: { removed: makeAnswer() }, threads: [makeThread()] });
    const review = await saveProgress(makeStore(existing), existing.id, { answers: {}, threads: [] }, NOW, new Set(['removed']));
    expect(review.answers).toEqual({});
    expect(review.threads).toEqual([]);
  });

  it('rejects missing reviews without saving', async () => {
    const store = makeStore();
    await expect(saveProgress(store, 'rv_missing', { answers: {}, threads: [] }, NOW, new Set(['removed'])))
      .rejects.toThrow(new ReviewNotFoundError('rv_missing'));
    expect(store.save).not.toHaveBeenCalled();
  });

  it('rejects approved reviews without saving', async () => {
    const existing = makeReview({ status: 'approved' });
    const store = makeStore(existing);
    await expect(saveProgress(store, existing.id, { answers: {}, threads: [] }, NOW, new Set(['removed'])))
      .rejects.toThrow(new ReviewApprovedError(existing.id));
    expect(store.save).not.toHaveBeenCalled();
  });
});

describe('submitRound', () => {
  for (const verdict of ['changes_requested', 'approved'] as const) {
    it(`submits the active round as ${verdict} and saves it`, async () => {
      const previous = makeRound(PLAN, { submittedAt: BEFORE, verdict: 'changes_requested', summary: 'Earlier.' });
      const active = makeRound(PLAN, { n: 2 });
      const existing = makeReview({ rounds: [previous, active], answers: { kept: makeAnswer() }, threads: [makeThread()] });
      const store = makeStore(existing);
      const req = { verdict, summary: '' };
      const review = await submitRound(store, existing.id, req, NOW);
      expect(review).toEqual({
        ...existing, status: verdict === 'approved' ? 'approved' : 'open', updatedAt: NOW.toISOString(),
        rounds: [previous, { ...active, ...req, submittedAt: NOW.toISOString() }],
      });
      expect(store.save).toHaveBeenCalledExactlyOnceWith(review);
      expect(await store.get(review.id)).toEqual(review);
    });
  }

  it('persists the reviewer summary verbatim', async () => {
    const existing = makeReview();
    const summary = ' Revise the retry policy.\nKeep the rest. ';
    const review = await submitRound(makeStore(existing), existing.id, { verdict: 'changes_requested', summary }, NOW);
    expect(review.rounds[0].summary).toBe(summary);
  });

  for (const verdict of ['changes_requested', 'approved'] as const) {
    it(`rejects a second submission after ${verdict}`, async () => {
      const existing = makeReview({ status: verdict === 'approved' ? 'approved' : 'open',
        rounds: [makeRound(PLAN, { submittedAt: BEFORE, verdict })] });
      const store = makeStore(existing);
      await expect(submitRound(store, existing.id, { verdict: 'approved', summary: '' }, NOW))
        .rejects.toThrow('Round already submitted');
      expect(store.save).not.toHaveBeenCalled();
    });
  }

  it('rejects a missing review without saving', async () => {
    const store = makeStore();
    await expect(submitRound(store, 'rv_missing', { verdict: 'approved', summary: '' }, NOW))
      .rejects.toThrow(new ReviewNotFoundError('rv_missing'));
    expect(store.save).not.toHaveBeenCalled();
  });
});

describe('rounds public API', () => {
  it('exports all Task 4 functions and errors from the root entry', () => {
    expect(core.openReview).toBe(openReview);
    expect(core.carryForward).toBe(carryForward);
    expect(core.saveProgress).toBe(saveProgress);
    expect(core.submitRound).toBe(submitRound);
    expect(core.ReviewNotFoundError).toBe(ReviewNotFoundError);
    expect(core.ReviewApprovedError).toBe(ReviewApprovedError);
  });

  it('keeps rounds browser-safe, with a type-only ReviewStore import', () => {
    const source = readFileSync(new URL('../src/rounds.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/node:/);
    expect(source).toMatch(/import type \{ ReviewStore \} from '\.\/reviewStore\.js'/);
  });
});


describe('round regressions', () => {
  it('leaves threads and answers exactly stored on unchanged resume while warning on unknown replies', async () => {
    const markdown = `${PLAN}\n\n${fence('reply thread=t_abc123', 'New reply.')}\n\n${fence('reply thread=t_unknown', 'Unknown.')}`;
    const existing = makeReview({ rounds: [makeRound(markdown)], answers: { hidden: makeAnswer() },
      threads: [makeThread({ resolved: true }), makeThread({ id: 't_outdated', outdated: true })] });
    const store = makeStore(existing);
    const { review, loaded } = await openReview(store, { markdown, reviewId: existing.id, now: NOW });
    expect(review.threads).toEqual(existing.threads);
    expect(review.answers).toEqual(existing.answers);
    expect(review.updatedAt).toBe(NOW.toISOString());
    expect(loaded.warnings).toEqual(['Reply to unknown thread t_unknown ignored']);
    expect(await store.get(existing.id)).toEqual(review);
  });

  it.each(['[docs](https://example.com/x)', '![docs](https://example.com/x)', '[docs][ref]', '![docs][ref]'])(
    're-anchors a line containing markdown %s by its rendered text on changed-plan open', async (link) => {
      const line = `See ${link} now.`;
      const existing = makeReview({ threads: [makeThread({
        anchor: { type: 'lines', startLine: 0, endLine: 0, lineTexts: [renderToLineBlocks(line)[0].text] },
      })] });
      const { review } = await openReview(makeStore(existing), {
        markdown: `# Test Plan\n\n## Original\n\n${line}`, reviewId: existing.id, now: NOW,
      });
      expect(review.threads[0]).toEqual(existing.threads[0]);
    },
  );

  it('re-anchors a resolved thread after a new reply reopens it', async () => {
    const existing = makeReview({ threads: [makeThread({ resolved: true })] });
    const markdown = `# Test Plan\n\n## Inserted\n\nDifferent content.\n\n## Original\n\nKeep these words. Second line.\n\n${fence('reply thread=t_abc123', 'Fixed.')}`;
    const { review } = await openReview(makeStore(existing), { markdown, reviewId: existing.id, now: NOW });
    expect(review.threads[0]).toMatchObject({ sectionId: 'section-2', resolved: false, outdated: false });
    expect(review.threads[0].comments).toHaveLength(2);
  });

  for (const anchored of [false, true]) {
    it(`preserves both duplicate headings when an Introduction shifts positional ids, anchored=${anchored}`, () => {
      const old = '# Plan\n\n### Tests\n\nShared anchor.\n\n### Tests\n\nShared anchor.';
      const plan = old.replace('# Plan\n\n', '# Plan\n\n### Introduction\n\nWelcome.\n\n');
      const threads = ['section-1', 'section-2'].map((sectionId, index) => makeThread({
        id: `t_test0${index}`, sectionId,
        anchor: anchored ? { type: 'lines', startLine: 0, endLine: 0, lineTexts: ['Shared anchor.'] } : null,
      }));
      const review = makeReview({ rounds: [makeRound(old)], threads });
      expect(carryForward(review, extract(plan), NOW).threads).toEqual(
        threads.map((thread, index) => ({ ...thread, sectionId: `section-${index + 2}` })),
      );
    });

    it(`keeps a resolved thread on its section across rounds until a reply reopens it, anchored=${anchored}`, async () => {
      const existing = makeReview({ threads: [makeThread({ resolved: true, ...(anchored ? {} : { anchor: null }) })] });
      const store = makeStore(existing);
      const inserted = '# Test Plan\n\n## Inserted\n\nKeep these words. Second line.\n\n## Original\n\nKeep these words. Second line.';
      const submit = () => submitRound(store, existing.id, { verdict: 'changes_requested', summary: '' }, NOW);
      await submit();
      const second = await openReview(store, { markdown: inserted, reviewId: existing.id, now: NOW });
      expect(second.review.threads[0]).toMatchObject({ sectionId: 'section-2', resolved: true });
      await submit();
      const third = await openReview(store, {
        markdown: `${inserted}\n\n${fence('reply thread=t_abc123', 'Fixed.')}`, reviewId: existing.id, now: NOW,
      });
      expect(third.review.threads[0]).toMatchObject({ sectionId: 'section-2', resolved: false, outdated: false });
    });

    it(`keeps the second duplicate heading on identical-plan carry-forward, anchored=${anchored}`, () => {
      const plan = '# Plan\n\n### Tests\n\nShared anchor.\n\n### Tests\n\nShared anchor.';
      const thread = makeThread({ sectionId: 'section-2', anchor: anchored
        ? { type: 'lines', startLine: 0, endLine: 0, lineTexts: ['Shared anchor.'] } : null });
      const review = makeReview({ rounds: [makeRound(plan)], threads: [thread] });
      expect(carryForward(review, extract(plan), NOW).threads[0]).toEqual(thread);
    });

    it(`uses duplicate-heading ordinal when ids shift, anchored=${anchored}`, () => {
      const old = '# Plan\n\n### Tests\n\nShared anchor.\n\n### Other\n\nOther content.\n\n### Tests\n\nShared anchor.';
      const plan = `# Plan\n\n### Inserted\n\nNew content.\n\n${old.slice('# Plan\n\n'.length)}`;
      const thread = makeThread({ sectionId: 'section-3', anchor: anchored
        ? { type: 'lines', startLine: 0, endLine: 0, lineTexts: ['Shared anchor.'] } : null });
      const review = makeReview({ rounds: [makeRound(old)], threads: [thread] });
      expect(carryForward(review, extract(plan), NOW).threads[0]).toEqual({ ...thread, sectionId: 'section-4' });
    });
  }

  it('keeps an unanchored outdated thread outdated across subsequent opens', async () => {
    const existing = makeReview({ threads: [makeThread({ anchor: null })] });
    const store = makeStore(existing);
    const markdown = '# Plan\n\n## Replacement\n\nDifferent content.';
    const first = await openReview(store, { markdown, reviewId: existing.id, now: NOW });
    expect(first.review.threads[0].outdated).toBe(true);
    const second = await openReview(store, { markdown: `${markdown}\nMore content.`, reviewId: existing.id, now: NOW });
    expect(second.review.threads[0]).toEqual(first.review.threads[0]);
  });

  it('keeps hidden answers while removing cleared current answers', async () => {
    const hidden = makeAnswer();
    const existing = makeReview({ answers: { hidden, cleared: makeAnswer(), replaced: makeAnswer() } });
    const replacement = makeAnswer({ choice: 'B' });
    const store = makeStore(existing);
    const review = await saveProgress(store, existing.id, { answers: { replaced: replacement }, threads: [] },
      NOW, new Set(['cleared', 'replaced']));
    expect(review.answers).toEqual({ hidden, replaced: replacement });
    expect((await store.get(existing.id))?.answers).toEqual(review.answers);
  });

  it('rejects progress after a changes-requested round is submitted', async () => {
    const existing = makeReview({ rounds: [makeRound(PLAN, { submittedAt: BEFORE, verdict: 'changes_requested' })] });
    const store = makeStore(existing);
    await expect(saveProgress(store, existing.id, { answers: {}, threads: [] }, NOW, new Set()))
      .rejects.toThrow('Round already submitted');
    expect(store.save).not.toHaveBeenCalled();
  });

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  function delayedStore(existing: Review) {
    const store = makeStore(existing);
    const get = store.get.getMockImplementation()!;
    const save = store.save.getMockImplementation()!;
    store.get.mockImplementation(async (id) => { await tick(); return get(id); });
    store.save.mockImplementation(async (review) => {
      await tick();
      if (review.status === 'open') await tick();
      await save(review);
    });
    return store;
  }

  for (const submitFirst of [false, true]) {
    it(`serializes concurrent progress and submission, submitFirst=${submitFirst}`, async () => {
      const existing = makeReview();
      const store = delayedStore(existing);
      const save = () => saveProgress(store, existing.id, { answers: { current: makeAnswer() }, threads: [] }, NOW, new Set(['current']));
      const submit = () => submitRound(store, existing.id, { verdict: 'approved', summary: 'Done.' }, NOW);
      const operations = submitFirst ? [submit(), save()] : [save(), submit()];
      const results = await Promise.allSettled(operations);
      expect(results[submitFirst ? 0 : 1].status).toBe('fulfilled');
      const saved = (await store.get(existing.id))!;
      expect(saved.status).toBe('approved');
      expect(saved.rounds[0].submittedAt).toBe(NOW.toISOString());
      if (submitFirst) expect(results[1].status).toBe('rejected');
      else expect(saved.answers).toEqual({ current: makeAnswer() });
    });
  }

  for (const byPath of [false, true]) {
    it(`serializes open with submission after resolution, byPath=${byPath}`, async () => {
      const existing = makeReview();
      const store = delayedStore(existing);
      const results = await Promise.allSettled([
        submitRound(store, existing.id, { verdict: 'approved', summary: '' }, NOW),
        openReview(store, { markdown: `${PLAN}\nChanged.`, ...(byPath ? { planPath: PATH } : { reviewId: existing.id }), now: NOW }),
      ]);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      const saved = (await store.get(existing.id))!;
      expect(saved.status).toBe('approved');
      expect(saved.rounds[0].submittedAt).toBe(NOW.toISOString());
    });
  }

  it('adopts a supplied planPath when resuming a stdin review by id', async () => {
    const existing = makeReview();
    delete existing.planPath;
    const store = makeStore(existing);
    const { review } = await openReview(store, { markdown: PLAN, reviewId: existing.id, planPath: PATH, now: NOW });
    expect(review.planPath).toBe(PATH);
    expect((await store.get(existing.id))?.planPath).toBe(PATH);
  });

  it('adopts a new planPath when resuming a review by id after the plan moved', async () => {
    const existing = makeReview();
    const store = makeStore(existing);
    const moved = '/tmp/moved/plan.md';
    const { review } = await openReview(store, { markdown: PLAN, reviewId: existing.id, planPath: moved, now: NOW });
    expect(review.planPath).toBe(moved);
    expect((await store.findOpenByPlanPath(moved))?.id).toBe(existing.id);
  });
});
