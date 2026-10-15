import type { ItemState, ReviewItem } from '@plan-review/core';
import { itemState } from '@plan-review/core/review';
import { useReview } from '../state/ReviewContext.js';
import type { Tab } from '../state/reducer.js';
import { sectionNumbers } from '../sections.js';
import { isOpenThread } from '../threads.js';
import { CommentsList } from './CommentsList.js';
import { ItemCard } from './ItemCard.js';

export function Rail() {
  const { state, dispatch } = useReview();
  const { items, review, ui } = state;
  const pending = items.filter((i) => isPending(itemState(i, review.answers[i.id]))).length;
  const openThreads = review.threads.filter(isOpenThread).length;

  const tab = (id: Tab, label: string, count: number, hot: boolean) => (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={ui.tab === id}
      class={`tab${ui.tab === id ? ' on' : ''}`}
      onClick={() => dispatch({ type: 'setTab', tab: id })}
    >
      {label} <span class={`ct${hot ? ' hot' : ''}`}>{count}</span>
    </button>
  );

  return (
    <aside class="side">
      <div class="tabs" role="tablist">
        {items.length > 0 && tab('decisions', 'Decisions', pending, pending > 0)}
        {tab('comments', 'Comments', openThreads, false)}
      </div>
      <div class="scroll" role="tabpanel" aria-labelledby={`tab-${ui.tab}`}>
        {ui.tab === 'decisions' ? <DecisionsList /> : <CommentsList />}
      </div>
    </aside>
  );
}

const isPending = (s: ItemState) => s === 'open' || s === 'changed';

function DecisionsList() {
  const { state } = useReview();
  const { items, review, doc } = state;
  const numbers = sectionNumbers(doc.sections);
  const stateOf = (item: ReviewItem) => itemState(item, review.answers[item.id]);

  const groups: [string, ReviewItem[]][] = [
    ['Needs your answer', items.filter((i) => isPending(stateOf(i)))],
    ['Deferred', items.filter((i) => stateOf(i) === 'deferred')],
    ['Answered', items.filter((i) => stateOf(i) === 'done')],
  ];

  return (
    <div class="rail-list">
      {groups.filter(([, list]) => list.length > 0).map(([title, list]) => [
        <div key={title} class="group-h"><span>{title}</span><span>{list.length}</span></div>,
        // Keyed on state too, so a card whose answer goes stale starts with a fresh draft.
        ...list.map((item) => <ItemCard key={`${item.id}:${stateOf(item)}`} item={item} loc={`§ ${numbers.get(item.sectionId) ?? ''}`} />),
      ])}
    </div>
  );
}
