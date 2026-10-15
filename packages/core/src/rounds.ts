import { extractItems } from './items.js';
import type { ExtractResult } from './items.js';
import { parse } from './parser.js';
import { contentHash, newCommentId, newReviewId } from './reviewModel.js';
import type { ReviewStore } from './reviewStore.js';
import type {
  Banner, LoadedReview, ProgressUpdate, Review, SplitStrategy, SubmitRequest,
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

export async function openReview(store: ReviewStore, input: OpenReviewInput): Promise<OpenedReview> {
  let review: Review | null = null;
  if (input.reviewId !== undefined) {
    review = await getReview(store, input.reviewId);
    if (review.status === 'approved') throw new ReviewApprovedError(review.id);
  } else if (input.planPath !== undefined && !input.fresh) {
    review = await store.findOpenByPlanPath(input.planPath);
  }

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

  const lastRound = review.rounds.at(-1);
  const hash = contentHash(input.markdown);
  // Carry-forward reads the old snapshot; replace/append rounds only afterwards.
  review = carryForward(review, extract, input.now, input.splitBy);
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
        answers: Object.fromEntries(Object.entries(review.answers).filter(([id]) => currentIds.has(id))),
        threads: review.threads,
        ...(banner === undefined ? {} : { banner }),
      },
    },
  };
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function carryForward(review: Review, extract: ExtractResult, now: Date, splitBy?: SplitStrategy): Review {
  const previousPlan = review.rounds.at(-1)?.plan;
  const previousSections = previousPlan === undefined ? [] : parse(previousPlan, splitBy).sections;
  const sections = extract.doc.sections;
  const threads = review.threads.map((thread) => {
    if (thread.resolved) return thread;
    const heading = previousSections.find((section) => section.id === thread.sectionId)?.heading;
    const sameHeading = sections.find((section) => section.heading === heading);
    if (!thread.anchor) {
      return { ...thread, sectionId: sameHeading?.id ?? thread.sectionId, outdated: !sameHeading };
    }

    const anchorText = thread.anchor.lineTexts.map(normalize).join('');
    const matches = (body: string): boolean => normalize(body).includes(anchorText);
    const match = sameHeading && matches(sameHeading.body)
      ? sameHeading : sections.find((section) => matches(section.body));
    return { ...thread, sectionId: match?.id ?? thread.sectionId, outdated: !match };
  });

  for (const reply of extract.replies) {
    const index = threads.findIndex((thread) => thread.id === reply.threadId);
    if (index === -1) continue;
    const thread = threads[index];
    const body = reply.body.trim();
    const duplicate = thread.comments.some((comment) => comment.author === 'agent' && comment.body.trim() === body);
    threads[index] = {
      ...thread,
      resolved: false,
      comments: duplicate ? thread.comments : [...thread.comments, {
        id: newCommentId(), author: 'agent', body, createdAt: now.toISOString(),
      }],
    };
  }
  return { ...review, threads };
}

export async function saveProgress(
  store: ReviewStore, reviewId: string, update: ProgressUpdate, now: Date,
): Promise<Review> {
  const review = await getReview(store, reviewId);
  if (review.status === 'approved') throw new ReviewApprovedError(review.id);
  const updated = { ...review, answers: update.answers, threads: update.threads, updatedAt: now.toISOString() };
  await store.save(updated);
  return updated;
}

export async function submitRound(
  store: ReviewStore, reviewId: string, req: SubmitRequest, now: Date,
): Promise<Review> {
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
}
