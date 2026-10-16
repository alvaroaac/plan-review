import { useEffect, useRef } from 'preact/hooks';
import type { LineAnchor } from '@plan-review/core';
import { useReview } from '../state/ReviewContext.js';
import { sectionElementId } from '../scroll.js';
import { anchorQuote } from './ThreadCard.js';

interface ComposerProps {
  sectionId: string;
  anchor: LineAnchor | null;
  body: string; // kept in review state so switching the target block keeps the text
  loc: string;
  detached?: boolean;
}

export function Composer({ sectionId, anchor, body, loc, detached = false }: ComposerProps) {
  const { dispatch } = useReview();
  const quote = anchorQuote(anchor);

  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.closest('.composer')?.scrollIntoView({ block: 'nearest' });
  }, [sectionId]);

  const cancel = () => dispatch({ type: 'cancelCompose' });
  const post = () => dispatch({ type: 'addThread', sectionId, anchor, body: body.trim() });
  // A script-moved focus only counts as visible when asked to, and the button shows on :focus-visible.
  const reattach = () => {
    const button = nearestCommentButton(sectionId, anchor?.startLine ?? 0);
    button?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    button?.focus({ preventScroll: true, focusVisible: true });
  };

  return (
    <div class="card composer">
      <div class="lbl">{detached ? 'New comment' : `New comment · ${loc}`}</div>
      {detached && (
        <div role="status">
          <p>The text this comment was on changed</p>
          <p>Choose a paragraph’s comment button to re-attach.</p>
          <button type="button" class="btn sm ghost" onClick={reattach}>Re-attach</button>
        </div>
      )}
      {quote && <blockquote class="th-quote">{quote}</blockquote>}
      <textarea
        ref={ref}
        class="field"
        value={body}
        onInput={(e) => dispatch({ type: 'composeBody', body: e.currentTarget.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
        placeholder="Add a comment…"
      />
      <div class="ic-actions">
        <button type="button" class="btn sm ghost" onClick={cancel}>Cancel</button>
        <button type="button" class="btn sm primary" disabled={detached || !body.trim()} onClick={post}>Comment</button>
      </div>
    </div>
  );
}

/** The comment button of the paragraph nearest `line` in the section, or the document's first one. */
function nearestCommentButton(sectionId: string, line: number): HTMLButtonElement | null {
  const section = document.getElementById(sectionElementId(sectionId))?.closest('section');
  const distance = (para: HTMLElement) => Math.abs(Number(para.dataset.line) - line);
  let nearest: HTMLElement | undefined;
  for (const para of section?.querySelectorAll<HTMLElement>('.para[data-line]') ?? []) {
    if (!nearest || distance(para) < distance(nearest)) nearest = para;
  }
  return nearest?.querySelector<HTMLButtonElement>('.para-add') ?? document.querySelector('.doc .para-add');
}
