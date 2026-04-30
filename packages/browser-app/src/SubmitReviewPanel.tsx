import { useEffect, useRef, useState } from 'preact/hooks';
import type { ReviewVerdict } from '@plan-review/core';

export interface SubmitReviewPanelProps {
  commentCount: number;
  disabled?: boolean;
  onSubmit: (verdict: ReviewVerdict, summary: string) => Promise<void>;
}

export function SubmitReviewPanel({ commentCount, disabled, onSubmit }: SubmitReviewPanelProps) {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<ReviewVerdict>('approved');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (popoverRef.current && target && !popoverRef.current.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  const canSubmit = verdict === 'approved' || summary.trim() !== '' || commentCount > 0;

  const handleConfirm = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      await onSubmit(verdict, summary);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="submit-panel" ref={popoverRef}>
      <button
        type="button"
        class="submit-btn"
        disabled={disabled || busy}
        onClick={() => setOpen((value) => !value)}
      >
        Submit Review <span class="caret">▾</span>
      </button>
      {open && (
        <div class="submit-popover" role="dialog" aria-label="Submit review">
          <label class="submit-radio">
            <input
              type="radio"
              name="verdict"
              checked={verdict === 'approved'}
              onChange={() => setVerdict('approved')}
            />
            Approve
          </label>
          <label class="submit-radio">
            <input
              type="radio"
              name="verdict"
              checked={verdict === null}
              onChange={() => setVerdict(null)}
            />
            Comment
          </label>
          <textarea
            class="submit-summary"
            placeholder="Leave a summary..."
            value={summary}
            onInput={(event) => setSummary((event.currentTarget as HTMLTextAreaElement).value)}
          />
          <div class="submit-actions">
            <button type="button" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              class="submit-confirm"
              onClick={handleConfirm}
              disabled={!canSubmit || busy}
            >
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
