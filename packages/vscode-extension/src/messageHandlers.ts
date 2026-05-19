import { readFile } from 'node:fs/promises';
import {
  parse,
  computeContentHash,
  DEFAULT_SESSION_DIR,
  FileSessionStore,
  type PlanDocument,
  type ReviewComment,
  type ReviewVerdict,
  type SessionData,
  type SessionStore,
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
  sessionStore?: SessionStore;
  submit?: (args: {
    planFsPath: string;
    document: PlanDocument;
    comments: ReviewComment[];
    verdict: ReviewVerdict;
    summary: string;
  }) => Promise<{ submitted: boolean }>;
}): MessageHandlers {
  const sessionStore = deps?.sessionStore ?? new FileSessionStore({ dir: DEFAULT_SESSION_DIR });

  return {
    async loadDocument({ planFsPath }) {
      const content = await readFile(planFsPath, 'utf-8');
      const document = parse(content);
      const contentHash = computeContentHash(content);
      const data = await sessionStore.load(planFsPath);
      const restoredSession = data
        ? {
            comments: data.comments,
            activeSection: data.activeSection,
            stale: data.contentHash !== contentHash,
          }
        : undefined;
      return { document, contentHash, restoredSession };
    },
    async saveSession({ planFsPath, contentHash, comments, activeSection }) {
      const data: SessionData = {
        version: 1,
        planPath: planFsPath,
        contentHash,
        comments,
        activeSection,
        lastModified: new Date().toISOString(),
      };

      await sessionStore.save(planFsPath, data);
    },
    async submitReview({ planFsPath, document, comments, verdict, summary }) {
      const result = await deps?.submit?.({ planFsPath, document, comments, verdict, summary });
      return { ok: true as const, submitted: result?.submitted ?? true };
    },
  };
}
