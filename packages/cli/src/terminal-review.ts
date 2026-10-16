import {
  formatReviewOutput,
  itemState,
  newCommentId,
  newThreadId,
  openReview,
  saveProgress,
  submitRound,
} from '@plan-review/core';
import type { ReviewComment, Thread } from '@plan-review/core';
import { createReviewStore, type BrowserReviewOptions } from './browser-review.js';
import { navigate } from './navigator.js';

export async function terminalReview(
  inputFromStdin: boolean,
  opts: BrowserReviewOptions,
): Promise<string> {
  const store = createReviewStore();
  const { loaded } = await openReview(store, { ...opts, now: new Date() });
  const round = loaded.review.round;

  const itemIds = new Set(loaded.items.map((item) => item.id));
  const commentThreads = new Map<string, Thread>();
  let pending = Promise.resolve();
  const persistComments = (): Promise<void> => {
    const threads = [...loaded.review.threads, ...loaded.document.comments.map((comment, index) => {
      const key = `${comment.sectionId}:${index}`;
      let thread = commentThreads.get(key);
      if (!thread) {
        thread = toThread(comment, round);
        commentThreads.set(key, thread);
      }
      return thread;
    })];
    pending = pending.then(async () => {
      await saveProgress(store, loaded.review.id, { answers: loaded.review.answers, threads }, new Date(), itemIds);
    });
    return pending;
  };

  let approved = false;
  await navigate(loaded.document, inputFromStdin, persistComments, {
    items: loaded.items,
    onApprove: () => { approved = true; },
  });
  await pending;
  await persistComments();

  const now = new Date();
  const review = await submitRound(
    store,
    loaded.review.id,
    { verdict: approved ? 'approved' : 'changes_requested', summary: '' },
    now,
  );

  const output = formatReviewOutput(review, loaded.items, loaded.document);
  const unanswered = loaded.items.filter((item) => {
    const answers = loaded.review.answers;
    const state = itemState(item, Object.hasOwn(answers, item.id) ? answers[item.id] : undefined);
    return state === 'open' || state === 'changed';
  }).length;
  return unanswered === 0 ? output : withUnansweredNotice(output, unanswered);
}

function toThread(comment: ReviewComment, round: number): Thread {
  return {
    id: newThreadId(),
    sectionId: comment.sectionId,
    anchor: comment.anchor ?? null,
    resolved: false,
    outdated: false,
    createdRound: round,
    comments: [{
      id: newCommentId(),
      author: 'reviewer',
      body: comment.text,
      createdAt: comment.timestamp.toISOString(),
    }],
  };
}

// The footer follows the last '---' rule in formatReviewOutput.
function withUnansweredNotice(output: string, count: number): string {
  const footerStart = output.lastIndexOf('\n---\n') + '\n---\n'.length;
  const notice = `${count} decisions/assumptions unanswered (answer them in browser mode)`;
  return `${output.slice(0, footerStart)}${notice}\n${output.slice(footerStart)}`;
}
