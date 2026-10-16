import { validateAnswer } from '@plan-review/core';
import type { Answer, LineAnchor, ProgressUpdate, ReviewItem, SubmitRequest, Thread, ThreadComment } from '@plan-review/core';

export type WebviewRequestMethod = 'loadDocument' | 'saveProgress' | 'submitReview';

export interface WebviewRequest {
  id: string;
  kind: 'req';
  method: WebviewRequestMethod;
  params?: unknown;
}

export interface WebviewResponseOk {
  id: string;
  kind: 'res';
  result: unknown;
}

export interface WebviewResponseErr {
  id: string;
  kind: 'err';
  error: string;
}

export type WebviewResponse = WebviewResponseOk | WebviewResponseErr;

// Extension → webview push (no response expected)
export type HostEvent = { kind: 'event'; type: 'planChanged' };

export function isRequest(msg: unknown): msg is WebviewRequest {
  const m = msg as Record<string, unknown>;
  return typeof msg === 'object' && msg !== null
    && m.kind === 'req'
    && typeof m.id === 'string'
    && typeof m.method === 'string';
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function isAnswer(x: unknown): x is Answer {
  return (
    isRecord(x) &&
    typeof x.choice === 'string' &&
    typeof x.note === 'string' &&
    typeof x.itemHash === 'string' &&
    typeof x.round === 'number' &&
    typeof x.updatedAt === 'string'
  );
}

function isLineAnchor(x: unknown): x is LineAnchor {
  return (
    isRecord(x) &&
    x.type === 'lines' &&
    typeof x.startLine === 'number' &&
    typeof x.endLine === 'number' &&
    Array.isArray(x.lineTexts) &&
    x.lineTexts.every((t) => typeof t === 'string')
  );
}

function isThreadComment(x: unknown): x is ThreadComment {
  return (
    isRecord(x) &&
    typeof x.id === 'string' &&
    (x.author === 'reviewer' || x.author === 'agent') &&
    typeof x.body === 'string' &&
    typeof x.createdAt === 'string'
  );
}

function isThread(x: unknown): x is Thread {
  return (
    isRecord(x) &&
    typeof x.id === 'string' &&
    typeof x.sectionId === 'string' &&
    (x.anchor === null || isLineAnchor(x.anchor)) &&
    typeof x.resolved === 'boolean' &&
    typeof x.outdated === 'boolean' &&
    typeof x.createdRound === 'number' &&
    Array.isArray(x.comments) &&
    x.comments.every(isThreadComment)
  );
}

export function isProgressUpdate(x: unknown, items: readonly ReviewItem[] = []): x is ProgressUpdate {
  return (
    isRecord(x) &&
    isRecord(x.answers) &&
    Object.values(x.answers).every(isAnswer) &&
    items.every((item) => !Object.hasOwn(x.answers as object, item.id)
      || validateAnswer(item, (x.answers as Record<string, Answer>)[item.id]) === null) &&
    Array.isArray(x.threads) &&
    x.threads.every(isThread) &&
    (x.merge === undefined || typeof x.merge === 'boolean')
  );
}

export function isSubmitRequest(x: unknown): x is SubmitRequest {
  return isRecord(x) && (x.verdict === 'changes_requested' || x.verdict === 'approved') && typeof x.summary === 'string';
}
