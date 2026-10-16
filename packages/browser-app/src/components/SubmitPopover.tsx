import { useEffect, useRef, useState } from 'preact/hooks';
import type { ItemState, ReviewItem, SubmitVerdict } from '@plan-review/core';
import { itemState } from '@plan-review/core/review';
import { useReview } from '../state/ReviewContext.js';
import { scrollDocTo } from '../scroll.js';
import { RightIcon } from './icons.js';

function gateSummary(item: ReviewItem, status: ItemState): string {
  if (status === 'deferred') return 'Deferred';
  if (status === 'changed') return 'changed since you answered';
  return item.kind === 'decision' ? 'Decision needed' : 'Confirm assumption';
}

/** The Submit review button and its popover: summary, soft-gate list of unfinished items, verdicts. */
export function SubmitPopover() {
  const { state, dispatch } = useReview();
  const open = state.ui.submitOpen;
  const [busy, setBusy] = useState(false);
  // Held here, not in the panel, so the summary survives closing, gate jumps and a failed submit.
  const [summary, setSummary] = useState(() => state.ui.summarySeed);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || busy) return;
    const close = () => dispatch({ type: 'closeSubmit' });
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onMouseDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open, busy, dispatch]);

  // On close, hand focus back to the trigger unless the user has already moved it elsewhere.
  const wasOpen = useRef(open);
  useEffect(() => {
    const active = document.activeElement;
    if (wasOpen.current && !open && (active === document.body || wrapRef.current?.contains(active))) {
      triggerRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <div class="submit-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        class="btn primary"
        aria-expanded={open}
        disabled={busy}
        onClick={() => dispatch({ type: open ? 'closeSubmit' : 'openSubmit' })}
      >
        Submit review
      </button>
      {open && <SubmitPanel busy={busy} setBusy={setBusy} summary={summary} setSummary={setSummary} />}
    </div>
  );
}

interface SubmitPanelProps {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  summary: string;
  setSummary: (summary: string) => void;
}

function SubmitPanel({ busy, setBusy, summary, setSummary }: SubmitPanelProps) {
  const { state, dispatch, client, flushAutosave } = useReview();
  const { items, review } = state;
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { summaryRef.current?.focus(); }, []);

  const gate = items
    .map((item, index) => ({ item, index, status: itemState(item, review.answers[item.id]) }))
    .filter((g) => g.status !== 'done');
  const unanswered = gate.filter((g) => g.status !== 'deferred').length;
  const deferred = gate.length - unanswered;
  const gateHeader = gate.length === 0
    ? 'All answered'
    : [unanswered > 0 && `${unanswered} unanswered`, deferred > 0 && `${deferred} deferred`].filter(Boolean).join(' · ');

  const jumpTo = (id: string) => {
    dispatch({ type: 'focus', target: { kind: 'item', id } });
    dispatch({ type: 'closeSubmit' });
    scrollDocTo(`mk-${id}`, 180);
  };

  const submit = async (verdict: SubmitVerdict) => {
    const request = { verdict, summary: summary.trim() };
    setBusy(true);
    try {
      await flushAutosave();
      const { output } = await client.submitReview(request);
      dispatch({ type: 'submitted', output });
    } catch (err) {
      dispatch({ type: 'submitFailed', error: err instanceof Error ? err.message : String(err), request });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="submit-pop" role="dialog" aria-label="Submit review" onKeyDown={trapTab}>
      <textarea
        ref={summaryRef}
        class="field"
        value={summary}
        onInput={(e) => setSummary(e.currentTarget.value)}
        placeholder="Summary for the agent (optional)"
      />
      {items.length > 0 && <div class="pop-h gate-h">{gateHeader}</div>}
      {gate.length > 0 && (
        <div class="gate-list">
          {gate.map(({ item, index, status }) => (
            <button
              key={item.id}
              type="button"
              class={`srow k-${item.kind} ${status}`}
              onClick={() => jumpTo(item.id)}
            >
              <span class="n">{status === 'deferred' ? '–' : index + 1}</span>
              <span class="srow-body">
                <div class="t">{item.label}</div>
                <div class="s">{gateSummary(item, status)}</div>
              </span>
              <span class="chev"><RightIcon /></span>
            </button>
          ))}
        </div>
      )}
      <div class="pop-actions">
        <button type="button" class="btn" disabled={busy} onClick={() => submit('changes_requested')}>
          Request changes
        </button>
        <button type="button" class="btn primary" disabled={busy} onClick={() => submit('approved')}>
          Approve
        </button>
      </div>
    </div>
  );
}

// Keeps Tab and Shift+Tab cycling inside the dialog.
function trapTab(e: KeyboardEvent) {
  if (e.key !== 'Tab') return;
  const focusable = Array.from((e.currentTarget as HTMLElement)
    .querySelectorAll<HTMLElement>('textarea, button:not([disabled])'));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const edge = e.shiftKey ? first : last;
  if (document.activeElement !== edge) return;
  e.preventDefault();
  (e.shiftKey ? last : first).focus();
}
