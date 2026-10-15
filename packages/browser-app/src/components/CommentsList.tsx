import type { Thread } from '@plan-review/core';
import { useReview } from '../state/ReviewContext.js';
import type { ThreadFilter } from '../state/reducer.js';
import { isListed } from '../threads.js';
import { sectionNumbers } from '../sections.js';
import { Composer } from './Composer.js';
import { ThreadCard } from './ThreadCard.js';

const FILTERS: [ThreadFilter, string][] = [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']];

export function CommentsList() {
  const { state, dispatch } = useReview();
  const { doc, review, ui } = state;
  const numbers = sectionNumbers(doc.sections);
  const headings = new Map(doc.sections.map((s) => [s.id, s.heading]));
  const locOf = (sectionId: string) =>
    headings.has(sectionId) ? `§ ${numbers.get(sectionId)} ${headings.get(sectionId)}` : '§';

  // Doc order: by section, then by anchored line; whole-section threads lead their section.
  const order = new Map(doc.sections.map((s, i) => [s.id, i]));
  const position = (t: Thread) => [order.get(t.sectionId) ?? Infinity, t.anchor?.startLine ?? -1];
  const sorted = [...review.threads].sort((a, b) => {
    const [sa, la] = position(a);
    const [sb, lb] = position(b);
    return sa - sb || la - lb;
  });
  const shown = sorted.filter((t) => !t.outdated && isListed(ui.filter, t));
  const outdated = sorted.filter((t) => t.outdated);
  const card = (t: Thread) => <ThreadCard key={t.id} thread={t} loc={locOf(t.sectionId)} />;

  return (
    <>
      <div class="chips">
        {FILTERS.map(([filter, label]) => (
          <button
            key={filter}
            type="button"
            class={`chip${ui.filter === filter ? ' on' : ''}`}
            aria-pressed={ui.filter === filter}
            onClick={() => dispatch({ type: 'setFilter', filter })}
          >
            {label}
          </button>
        ))}
      </div>
      <div class="rail-list">
        {ui.composing && (
          <Composer key={ui.composing.sectionId} {...ui.composing} loc={locOf(ui.composing.sectionId)} />
        )}
        {shown.map(card)}
        {!ui.composing && shown.length === 0 && <div class="empty">Nothing here.</div>}
        {outdated.length > 0 && <div class="group-h"><span>Outdated</span><span>{outdated.length}</span></div>}
        {outdated.map(card)}
      </div>
    </>
  );
}
