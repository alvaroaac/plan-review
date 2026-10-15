import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Review } from './types.js';

export interface ReviewStore {
  get(id: string): Promise<Review | null>;
  save(review: Review): Promise<void>;
  list(filter?: { status?: Review['status'] }): Promise<Review[]>;
  findOpenByPlanPath(planPath: string): Promise<Review | null>; // most recently updated
}

export const DEFAULT_REVIEW_DIR = join(homedir(), '.plan-review', 'reviews');

const REVIEW_ID_PATTERN = /^rv_[0-9a-z]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRound(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.n === 'number' &&
    typeof value.plan === 'string' &&
    typeof value.contentHash === 'string' &&
    typeof value.startedAt === 'string'
  );
}

function isLineAnchor(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === 'lines' &&
    typeof value.startLine === 'number' &&
    typeof value.endLine === 'number' &&
    Array.isArray(value.lineTexts) &&
    value.lineTexts.every((text) => typeof text === 'string')
  );
}

function isThreadComment(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.author === 'reviewer' || value.author === 'agent') &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'string'
  );
}

function isThread(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sectionId === 'string' &&
    (value.anchor === null || isLineAnchor(value.anchor)) &&
    typeof value.resolved === 'boolean' &&
    typeof value.outdated === 'boolean' &&
    typeof value.createdRound === 'number' &&
    Array.isArray(value.comments) &&
    value.comments.every(isThreadComment)
  );
}

export function isReview(value: unknown): value is Review {
  if (!isRecord(value)) return false;
  return (
    value.version === 2 &&
    typeof value.id === 'string' &&
    REVIEW_ID_PATTERN.test(value.id) &&
    typeof value.title === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    (value.status === 'open' || value.status === 'approved') &&
    isRecord(value.answers) &&
    Array.isArray(value.threads) &&
    value.threads.every(isThread) &&
    Array.isArray(value.rounds) &&
    value.rounds.length > 0 &&
    value.rounds.every(isRound)
  );
}

export class FileReviewStore implements ReviewStore {
  private readonly dir: string;

  constructor(options: { dir?: string } = {}) {
    this.dir = options.dir ?? DEFAULT_REVIEW_DIR;
  }

  async get(id: string): Promise<Review | null> {
    if (!REVIEW_ID_PATTERN.test(id)) return null;
    return this.readReview(id);
  }

  async save(review: Review): Promise<void> {
    if (!REVIEW_ID_PATTERN.test(review.id)) throw new Error('Invalid review id');
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, `${review.id}.json`);
    const tmpPath = `${path}.tmp-${randomBytes(4).toString('hex')}`;
    await writeFile(tmpPath, JSON.stringify(review, null, 2), 'utf-8');
    await rename(tmpPath, path);
  }

  async list(filter?: { status?: Review['status'] }): Promise<Review[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }

    const reviews: Review[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -5);
      if (!REVIEW_ID_PATTERN.test(id)) continue;
      const review = await this.readReview(id);
      if (review && (!filter?.status || review.status === filter.status)) {
        reviews.push(review);
      }
    }
    return reviews.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async findOpenByPlanPath(planPath: string): Promise<Review | null> {
    const open = await this.list({ status: 'open' });
    return open.find((review) => review.planPath === planPath) ?? null;
  }

  private async readReview(id: string): Promise<Review | null> {
    try {
      const data: unknown = JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf-8'));
      return isReview(data) && data.id === id ? data : null;
    } catch {
      return null;
    }
  }
}
