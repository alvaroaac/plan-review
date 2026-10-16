import { useMemo, useState } from 'preact/hooks';
import type { SubmitRequest } from '@plan-review/core';
import { formatReviewOutput } from '@plan-review/core/formatter';
import { itemState } from '@plan-review/core/review';
import { useReview } from '../state/ReviewContext.js';
import type { ReviewState } from '../state/reducer.js';
import { CheckIcon } from './icons.js';
import { Toast } from './Toast.js';

export function SubmittedView() {
  const { state } = useReview();
  const message = useMemo(() => reviewSentMessage(state), []); // the review is final once sent
  return (
    <div class="result">
      <div class="result-card">
        <span class="result-ico"><CheckIcon /></span>
        <h1>Review submitted</h1>
        <p>You can close this tab.</p>
      </div>
      <Toast message={message} />
    </div>
  );
}

/** Toast copy per design: what was sent, counting only what is there. */
function reviewSentMessage({ items, review }: ReviewState): string {
  const states = items.map((item) => ({ item, answer: review.answers[item.id], status: itemState(item, review.answers[item.id]) }));
  const answered = states.filter((s) => s.status === 'done').length;
  const deferred = states.filter((s) => s.status === 'deferred').length;
  const flagged = states.filter((s) => s.status === 'done' && s.item.kind === 'assumption' && s.answer!.choice !== 'holds').length;
  const comments = review.threads.filter((t) => t.comments.some((c) => c.author === 'reviewer')).length;

  const parts = [
    items.length > 0 && `${answered} answered`,
    deferred > 0 && `${deferred} deferred`,
    flagged > 0 && plural(flagged, 'assumption') + ' flagged',
    comments > 0 && plural(comments, 'comment'),
  ].filter(Boolean);
  return parts.length > 0 ? `Review sent · ${parts.join(', ')}` : 'Review sent';
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function SubmitFailureView({ message, request }: { message: string; request: SubmitRequest }) {
  const { state, dispatch } = useReview();
  const reviewText = useMemo(() => formatLocally(state, request), [state, request]);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reviewText);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };

  return (
    <div class="result">
      <div class="result-card failure">
        <h1>Submit failed</h1>
        <p class="result-err">{message}</p>
        <p>Copy the review and paste it into your agent session.</p>
        <div class="result-actions">
          <button type="button" class="btn primary" onClick={copy}>Copy review to clipboard</button>
          <button type="button" class="btn" onClick={() => dispatch({ type: 'dismissSubmitError' })}>Back to review</button>
          {copyStatus === 'copied' && <span class="copy-status ok">Copied</span>}
          {copyStatus === 'failed' && <span class="copy-status err">Could not copy. Select the review below.</span>}
        </div>
        <textarea class="field submit-failure-review" readOnly value={reviewText} />
      </div>
    </div>
  );
}

// The server never recorded this round, so the output is formatted here from what the
// browser holds, as a review whose only round is the one being submitted.
function formatLocally({ doc, items, review }: ReviewState, request: SubmitRequest): string {
  const now = new Date().toISOString();
  return formatReviewOutput(
    {
      version: 2,
      id: review.id,
      title: doc.title,
      status: request.verdict === 'approved' ? 'approved' : 'open',
      createdAt: now,
      updatedAt: now,
      answers: review.answers,
      threads: review.threads,
      rounds: [{
        n: review.round,
        plan: '',
        contentHash: '',
        startedAt: now,
        submittedAt: now,
        verdict: request.verdict,
        summary: request.summary,
      }],
    },
    items,
    doc,
  );
}
