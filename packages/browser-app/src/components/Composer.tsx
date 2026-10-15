import { useEffect, useRef } from 'preact/hooks';
import type { LineAnchor } from '@plan-review/core';
import { useReview } from '../state/ReviewContext.js';
import { anchorQuote } from './ThreadCard.js';

interface ComposerProps {
  sectionId: string;
  anchor: LineAnchor | null;
  body: string; // kept in review state so switching the target block keeps the text
  loc: string;
}

export function Composer({ sectionId, anchor, body, loc }: ComposerProps) {
  const { dispatch } = useReview();
  const quote = anchorQuote(anchor);

  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.closest('.composer')?.scrollIntoView({ block: 'nearest' });
  }, [sectionId]);

  const cancel = () => dispatch({ type: 'cancelCompose' });
  const post = () => dispatch({ type: 'addThread', sectionId, anchor, body: body.trim() });

  return (
    <div class="card composer">
      <div class="lbl">New comment · {loc}</div>
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
        <button type="button" class="btn sm primary" disabled={!body.trim()} onClick={post}>Comment</button>
      </div>
    </div>
  );
}
