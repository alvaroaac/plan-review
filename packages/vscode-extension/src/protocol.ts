import type { ReviewComment, ReviewVerdict } from '@plan-review/core';

export type WebviewRequestMethod = 'loadDocument' | 'saveSession' | 'submitReview';

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
export type HostEvent = { kind: 'event'; type: 'planChanged'; newContentHash: string };

export interface SaveSessionParams {
  comments: ReviewComment[];
  activeSection: string | null;
  contentHash?: string;
}

export interface SubmitReviewParams {
  comments: ReviewComment[];
  verdict: ReviewVerdict;
  summary: string;
}

export function isRequest(msg: unknown): msg is WebviewRequest {
  const m = msg as Record<string, unknown>;
  return typeof msg === 'object' && msg !== null
    && m.kind === 'req'
    && typeof m.id === 'string'
    && typeof m.method === 'string';
}

export function isSaveSessionParams(p: unknown): p is SaveSessionParams {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  return Array.isArray(o.comments)
    && (o.activeSection === null || typeof o.activeSection === 'string')
    && (o.contentHash === undefined || typeof o.contentHash === 'string');
}

export function isSubmitReviewParams(p: unknown): p is SubmitReviewParams {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  return Array.isArray(o.comments)
    && (o.verdict === 'approved' || o.verdict === null)
    && typeof o.summary === 'string';
}
