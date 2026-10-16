import { extractItems } from './items.js';
import type { ExtractResult } from './items.js';
import { findLineRun, renderToLineBlocks } from './lineBlocks.js';
import type { LineBlock } from './lineBlocks.js';
import { parse } from './parser.js';
import { contentHash, newCommentId, newReviewId } from './reviewModel.js';
import type { ReviewStore } from './reviewStore.js';
import type {
  Banner, LoadedReview, ProgressUpdate, Review, Section, SplitStrategy, SubmitRequest,
} from './types.js';

export interface OpenReviewInput {
  markdown: string;
  planPath?: string;
  reviewId?: string;
  fresh?: boolean;
  splitBy?: SplitStrategy;
  now: Date;
}

export interface OpenedReview {
  review: Review;
  loaded: LoadedReview;
}

export class ReviewNotFoundError extends Error {
  constructor(id: string) {
    super(`Review ${id} not found`);
    this.name = 'ReviewNotFoundError';
  }
}

export class ReviewApprovedError extends Error {
  constructor(id: string) {
    super(`Review ${id} is approved; run without --review to start a new review`);
    this.name = 'ReviewApprovedError';
  }
}

async function getReview(store: ReviewStore, id: string): Promise<Review> {
  const review = await store.get(id);
  if (!review) throw new ReviewNotFoundError(id);
  return review;
}

const reviewOperations = new Map<string, Promise<void>>();

function serializeReview<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const result = (reviewOperations.get(id) ?? Promise.resolve()).then(operation);
  const pending = result.then(() => {}, () => {});
  reviewOperations.set(id, pending);
  void pending.then(() => {
    if (reviewOperations.get(id) === pending) reviewOperations.delete(id);
  });
  return result;
}

export async function openReview(store: ReviewStore, input: OpenReviewInput): Promise<OpenedReview> {
  if (input.reviewId !== undefined) {
    const id = input.reviewId;
    return serializeReview(id, async () => openResolvedReview(store, input, await getReview(store, id)));
  }
  if (input.planPath !== undefined && !input.fresh) {
    const review = await store.findOpenByPlanPath(input.planPath);
    if (review) {
      return serializeReview(review.id, async () => openResolvedReview(store, input, await getReview(store, review.id)));
    }
  }
  return openResolvedReview(store, input, null);
}

async function openResolvedReview(
  store: ReviewStore, input: OpenReviewInput, review: Review | null,
): Promise<OpenedReview> {
  if (review?.status === 'approved') throw new ReviewApprovedError(review.id);
  const extract = extractItems(parse(input.markdown, input.splitBy));
  const timestamp = input.now.toISOString();
  if (!review) {
    review = {
      version: 2,
      id: newReviewId(),
      title: extract.doc.title,
      ...(input.planPath === undefined ? {} : { planPath: input.planPath }),
      status: 'open',
      createdAt: timestamp,
      updatedAt: timestamp,
      answers: {},
      threads: [],
      rounds: [],
    };
  }

  if (input.planPath !== undefined && review.planPath !== input.planPath) {
    review = { ...review, planPath: input.planPath };
  }

  const lastRound = review.rounds.at(-1);
  const hash = contentHash(input.markdown);
  // Carry-forward reads the old snapshot; replace/append rounds only afterwards.
  if (!lastRound || lastRound.submittedAt || lastRound.contentHash !== hash) {
    review = carryForward(review, extract, input.now, input.splitBy);
  }
  let banner: Banner | undefined;
  if (lastRound && !lastRound.submittedAt) {
    if (lastRound.contentHash !== hash) {
      review = {
        ...review,
        rounds: [...review.rounds.slice(0, -1), { ...lastRound, plan: input.markdown, contentHash: hash }],
      };
      banner = 'planChangedWhilePaused';
    }
  } else {
    review = {
      ...review,
      rounds: [...review.rounds, {
        n: (lastRound?.n ?? 0) + 1,
        plan: input.markdown,
        contentHash: hash,
        startedAt: timestamp,
      }],
    };
    if (lastRound?.contentHash === hash) banner = 'planUnchanged';
  }

  review = { ...review, updatedAt: timestamp };
  await store.save(review);

  const currentIds = new Set(extract.items.map((item) => item.id));
  const threadIds = new Set(review.threads.map((thread) => thread.id));
  const warnings = [...extract.warnings];
  for (const reply of extract.replies) {
    if (!threadIds.has(reply.threadId)) warnings.push(`Reply to unknown thread ${reply.threadId} ignored`);
  }
  return {
    review,
    loaded: {
      document: extract.doc,
      items: extract.items,
      warnings,
      review: {
        id: review.id,
        round: review.rounds[review.rounds.length - 1].n,
        status: review.status,
        updatedAt: review.updatedAt,
        answers: Object.fromEntries(Object.entries(review.answers).filter(([id]) => currentIds.has(id))),
        threads: review.threads,
        ...(banner === undefined ? {} : { banner }),
      },
    },
  };
}

export function carryForward(review: Review, extract: ExtractResult, now: Date, splitBy?: SplitStrategy): Review {
  const previousPlan = review.rounds.at(-1)?.plan;
  const previousSections = previousPlan === undefined ? [] : parse(previousPlan, splitBy).sections;
  const sections = extract.doc.sections;
  const threads = [...review.threads];

  for (const reply of extract.replies) {
    const index = threads.findIndex((thread) => thread.id === reply.threadId);
    if (index === -1) continue;
    const thread = threads[index];
    const body = reply.body.trim();
    const duplicate = thread.comments.some((comment) => comment.author === 'agent' && comment.body.trim() === body);
    if (duplicate) continue;
    threads[index] = {
      ...thread,
      resolved: false,
      comments: [...thread.comments, {
        id: newCommentId(), author: 'agent', body, createdAt: now.toISOString(),
      }],
    };
  }
  // Blocks as the browser renders them, so anchor line numbers stay in its coordinates.
  const blocksBySection = new Map<string, LineBlock[]>();
  const blocksOf = (section: Section): LineBlock[] => {
    let blocks = blocksBySection.get(section.id);
    if (!blocks) {
      const itemIds = extract.items.filter((item) => item.sectionId === section.id).map((item) => item.id);
      blocks = renderToLineBlocks(section.body, new Set(itemIds));
      blocksBySection.set(section.id, blocks);
    }
    return blocks;
  };

  const reanchored = threads.map((thread) => {
    const heading = previousSections.find((section) => section.id === thread.sectionId)?.heading;
    const candidates = sections.filter((section) => section.heading === heading);
    const ordinal = previousSections.filter((section) => section.heading === heading)
      .findIndex((section) => section.id === thread.sectionId);
    const sameHeading = candidates[ordinal]
      ?? candidates.find((section) => section.id === thread.sectionId) ?? candidates[0];
    if (!thread.anchor) {
      if (thread.outdated) return thread;
      return { ...thread, sectionId: sameHeading?.id ?? thread.sectionId, outdated: !sameHeading };
    }

    const { anchor } = thread;
    const locate = (section: Section) => {
      const range = findLineRun(blocksOf(section), anchor.lineTexts, anchor);
      return range && { section, range };
    };
    const match = (sameHeading && locate(sameHeading))
      ?? sections.reduce<ReturnType<typeof locate>>((found, section) => found ?? locate(section), null);
    if (!match) return { ...thread, outdated: true };
    const { section, range } = match;
    return {
      ...thread,
      sectionId: section.id,
      outdated: false,
      anchor: {
        ...anchor,
        startLine: range.start,
        endLine: range.end,
        lineTexts: blocksOf(section).slice(range.start, range.end + 1).map((block) => block.text),
      },
    };
  });

  return { ...review, threads: reanchored };
}

export async function saveProgress(
  store: ReviewStore, reviewId: string, update: ProgressUpdate, now: Date, currentItemIds: ReadonlySet<string>,
): Promise<Review> {
  return serializeReview(reviewId, async () => {
    const review = await getReview(store, reviewId);
    if (review.status === 'approved') throw new ReviewApprovedError(review.id);
    if (review.rounds.at(-1)?.submittedAt) throw new Error('Round already submitted');
    const answers = Object.fromEntries([
      ...Object.entries(review.answers).filter(([id]) => !currentItemIds.has(id)),
      ...Object.entries(update.answers).filter(([id]) => currentItemIds.has(id)),
    ]);
    const updated = { ...review, answers, threads: update.threads, updatedAt: now.toISOString() };
    await store.save(updated);
    return updated;
  });
}

export async function submitRound(
  store: ReviewStore, reviewId: string, req: SubmitRequest, now: Date,
): Promise<Review> {
  return serializeReview(reviewId, async () => {
    const review = await getReview(store, reviewId);
    const round = review.rounds[review.rounds.length - 1];
    if (round.submittedAt) throw new Error('Round already submitted');
    const timestamp = now.toISOString();
    const updated: Review = {
      ...review,
      status: req.verdict === 'approved' ? 'approved' : review.status,
      updatedAt: timestamp,
      rounds: [...review.rounds.slice(0, -1), {
        ...round, submittedAt: timestamp, verdict: req.verdict, summary: req.summary,
      }],
    };
    await store.save(updated);
    return updated;
  });
}
