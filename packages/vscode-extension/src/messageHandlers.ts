import { readFile } from 'node:fs/promises';
import {
  parse,
  computeContentHash,
  loadSession,
  saveSession as coreSaveSession,
  type PlanDocument,
  type ReviewComment,
  type ReviewVerdict,
} from '@plan-review/core';

export interface MessageHandlers {
  loadDocument(params: { planFsPath: string }): Promise<{
    document: PlanDocument;
    restoredSession?: { comments: ReviewComment[]; activeSection: string | null; stale: boolean };
    contentHash: string;
  }>;
  saveSession(params: {
    planFsPath: string;
    contentHash: string;
    comments: ReviewComment[];
    activeSection: string | null;
  }): Promise<void>;
  submitReview(params: {
    planFsPath: string;
    document: PlanDocument;
    comments: ReviewComment[];
    verdict: ReviewVerdict;
    summary: string;
  }): Promise<{ ok: true; submitted: boolean }>;
}

export function createMessageHandlers(deps?: {
  submit?: (args: {
    planFsPath: string;
    document: PlanDocument;
    comments: ReviewComment[];
    verdict: ReviewVerdict;
    summary: string;
  }) => Promise<{ submitted: boolean }>;
}): MessageHandlers {
  return {
    async loadDocument({ planFsPath }) {
      const content = await readFile(planFsPath, 'utf-8');
      const document = parse(content);
      const contentHash = computeContentHash(content);
      const restoredSession = loadSession(planFsPath, contentHash) ?? undefined;
      return { document, contentHash, restoredSession };
    },
    async saveSession({ planFsPath, contentHash, comments, activeSection }) {
      coreSaveSession(planFsPath, contentHash, comments, activeSection);
    },
    async submitReview({ planFsPath, document, comments, verdict, summary }) {
      const result = await deps?.submit?.({ planFsPath, document, comments, verdict, summary });
      return { ok: true as const, submitted: result?.submitted ?? true };
    },
  };
}
