import {
  FileReviewStore,
  formatReviewOutput,
  openReview,
  saveProgress,
  submitRound,
  type LoadedReview,
  type ProgressUpdate,
  type ReviewStore,
  type SubmitRequest,
} from '@plan-review/core';

export interface MessageHandlers {
  loadDocument(params: { planFsPath: string; markdown: string }): Promise<LoadedReview>;
  saveProgress(update: ProgressUpdate): Promise<void>;
  submitReview(req: SubmitRequest): Promise<{ ok: true; output: string }>;
}

/** One handler set per panel: the review id stays fixed after the first load. */
export function createMessageHandlers(deps?: {
  reviewStore?: ReviewStore;
  now?: () => Date;
  submit?: (args: { planFsPath: string; output: string }) => Promise<void>;
}): MessageHandlers {
  const store = deps?.reviewStore ?? new FileReviewStore();
  const now = deps?.now ?? (() => new Date());
  let loaded: LoadedReview | undefined;
  let planFsPath: string;

  function current(): LoadedReview {
    if (!loaded) throw new Error('document not loaded');
    return loaded;
  }

  return {
    async loadDocument(params) {
      const opened = await openReview(store, {
        markdown: params.markdown,
        planPath: params.planFsPath,
        reviewId: loaded?.review.id,
        now: now(),
      });
      loaded = opened.loaded;
      planFsPath = params.planFsPath;
      return loaded;
    },
    async saveProgress(update) {
      const currentLoaded = current();
      await saveProgress(store, currentLoaded.review.id, update, now(), new Set(currentLoaded.items.map((item) => item.id)));
    },
    async submitReview(req) {
      const currentLoaded = current();
      const review = await submitRound(store, currentLoaded.review.id, req, now());
      const output = formatReviewOutput(review, currentLoaded.items, currentLoaded.document);
      await deps?.submit?.({ planFsPath, output });
      return { ok: true, output };
    },
  };
}
