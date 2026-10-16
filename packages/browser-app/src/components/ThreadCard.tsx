import { useEffect, useRef, useState } from 'preact/hooks';
import type { LineAnchor, Thread, ThreadComment } from '@plan-review/core';
import { useReview } from '../state/ReviewContext.js';
import { scrollDocTo, sectionElementId } from '../scroll.js';
import { CheckIcon } from './icons.js';

const PEOPLE: Record<ThreadComment['author'], { name: string; initials: string }> = {
  reviewer: { name: 'You', initials: 'Y' },
  agent: { name: 'Agent', initials: 'A' },
};

/** The anchored block text, as shown in thread and composer quotes. */
export const anchorQuote = (anchor: LineAnchor | null): string | null => anchor?.lineTexts.join(' ') || null;

export function ThreadCard({ thread, loc }: { thread: Thread; loc: string }) {
  const { state, dispatch } = useReview();
  const focused = state.ui.focus?.kind === 'thread' && state.ui.focus.id === thread.id;
  const quote = anchorQuote(thread.anchor);
  const [reply, setReply] = useState('');

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focused]);

  // Whole-section threads (and any thread whose highlight is not rendered) land on the section heading.
  const jumpToDoc = () => {
    dispatch({ type: 'focus', target: { kind: 'thread', id: thread.id } });
    const highlight = `hl-${thread.id}`;
    scrollDocTo(document.getElementById(highlight) ? highlight : sectionElementId(thread.sectionId), 180);
  };
  const toggleResolved = (e: MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: thread.resolved ? 'reopen' : 'resolve', threadId: thread.id });
  };
  const onReplyKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !reply.trim()) return;
    dispatch({ type: 'reply', threadId: thread.id, body: reply.trim() });
    setReply('');
  };

  const classes = ['card', 'thread', thread.resolved && 'is-resolved', thread.outdated && 'is-outdated', focused && 'is-focus'];
  return (
    <div ref={ref} id={`th-${thread.id}`} class={classes.filter(Boolean).join(' ')} onClick={jumpToDoc}>
      <div class="th-head">
        <span class="loc">{loc}</span>
        <button type="button" class="th-resolve" onClick={toggleResolved}>
          {thread.resolved ? 'Reopen' : <><CheckIcon />Resolve</>}
        </button>
      </div>
      {quote && <blockquote class="th-quote">{quote}</blockquote>}
      {thread.comments.map((c) => <Comment key={c.id} comment={c} />)}
      {!thread.resolved && (
        <div class="th-reply" onClick={(e) => e.stopPropagation()}>
          <input
            class="field"
            placeholder="Reply…"
            value={reply}
            onInput={(e) => setReply(e.currentTarget.value)}
            onKeyDown={onReplyKey}
          />
        </div>
      )}
    </div>
  );
}

function Comment({ comment }: { comment: ThreadComment }) {
  const who = PEOPLE[comment.author];
  return (
    <div class={`cmt${comment.author === 'agent' ? ' is-agent' : ''}`}>
      <span class={`ava ava-${comment.author}`} aria-hidden="true">{who.initials}</span>
      <div>
        <div class="cmt-meta"><b>{who.name}</b><span>{ago(comment.createdAt)}</span></div>
        <p>{comment.body}</p>
      </div>
    </div>
  );
}

/** Compact age like the design's "14m": now, minutes, hours, then days. */
function ago(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (!(minutes >= 1)) return 'now'; // also covers clock skew and unparsable dates
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (60 * 24))}d`;
}
