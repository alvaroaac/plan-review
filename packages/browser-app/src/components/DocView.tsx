import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { itemState } from '@plan-review/core/review';
import { useReview } from '../state/ReviewContext.js';
import type { ReviewState } from '../state/reducer.js';
import { renderMermaidBlocks } from '../mermaid.js';
import { renderMathBlocks } from '../katex.js';
import { sectionNumbers } from '../sections.js';
import { SectionView } from './SectionView.js';

export function DocView() {
  const { state } = useReview();
  const { doc, review } = state;
  const ref = useRef<HTMLElement>(null);
  const numbers = sectionNumbers(doc.sections);
  const updated = lastActivity(state);

  // Diagrams and math are rendered into the DOM after Preact has painted it;
  // both skip blocks they already processed, so this is cheap on every render.
  useEffect(() => {
    if (!ref.current) return;
    void renderMermaidBlocks(ref.current);
    void renderMathBlocks(ref.current);
  });

  return (
    <article class="doc" ref={ref}>
      <div class="kicker">{doc.mode === 'plan' ? 'Plan' : 'Document'} · Round {review.round}</div>
      <h1 class="doc-title">{doc.title}</h1>
      <div class="doc-meta">
        {updated && <><span>Updated {timeAgo(updated)}</span><span class="dot" /></>}
        <span>{review.id}</span>
      </div>
      <div class="legend">
        <span><i />Decision</span>
        <span><i class="a" />Assumption</span>
        <span><i class="c" />Comment</span>
        <span style={{ color: 'var(--ink-4)' }}>Hover a paragraph to comment</span>
      </div>
      <Banners />
      {doc.sections.map((s) => <SectionView key={s.id} section={s} num={numbers.get(s.id)!} />)}
    </article>
  );
}

function Banners() {
  const { state } = useReview();
  const { items, review, warnings } = state;
  const changed = items.filter((i) => itemState(i, review.answers[i.id]) === 'changed').length;

  return (
    <>
      {review.banner === 'planChangedWhilePaused' && (
        <Callout icon="i">The plan changed while this review was paused. Your answers and comments were carried over.</Callout>
      )}
      {review.banner === 'planUnchanged' && (
        <Callout icon="i">The plan hasn’t changed since the last round.</Callout>
      )}
      {changed > 0 && (
        <Callout icon="!">
          {changed === 1 ? '1 item changed since you answered it.' : `${changed} items changed since you answered them.`}
        </Callout>
      )}
      {warnings.length > 0 && (
        <Callout icon="!">
          <div>
            Some decision or assumption blocks couldn’t be read and are shown as code:
            <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        </Callout>
      )}
    </>
  );
}

function Callout({ icon, children }: { icon: string; children: ComponentChildren }) {
  return (
    <div class="callout">
      <span class="ico" aria-hidden="true">{icon}</span>
      {children}
    </div>
  );
}

/** Latest answer or comment time, or null before any activity. */
function lastActivity({ review }: ReviewState): string | null {
  const times = [
    ...Object.values(review.answers).map((a) => a.updatedAt),
    ...review.threads.flatMap((t) => t.comments.map((c) => c.createdAt)),
  ];
  return times.length > 0 ? times.reduce((a, b) => (a > b ? a : b)) : null;
}

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
