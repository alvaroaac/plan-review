import { useEffect, useRef, useState } from 'preact/hooks';
import type { LineAnchor } from '@plan-review/core';
import { useReview } from '../state/ReviewContext.js';
import { anchorQuote } from './ThreadCard.js';

export function Composer({ sectionId, anchor, loc }: { sectionId: string; anchor: LineAnchor | null; loc: string }) {
  const { dispatch } = useReview();
  const [body, setBody] = useState('');
  const quote = anchorQuote(anchor);

  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
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
        onInput={(e) => setBody(e.currentTarget.value)}
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
