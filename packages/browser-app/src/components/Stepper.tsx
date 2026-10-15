import { itemState } from '@plan-review/core/review';
import { useReview } from '../state/ReviewContext.js';
import { scrollDocTo } from '../scroll.js';
import { CheckIcon, RightIcon } from './icons.js';

export function Stepper() {
  const { state, dispatch } = useReview();
  const { items, review, ui } = state;
  const states = items.map((item) => itemState(item, review.answers[item.id]));
  const answered = states.filter((s) => s === 'done').length;
  const deferred = states.filter((s) => s === 'deferred').length;
  const focused = ui.focus?.kind === 'item' ? items.findIndex((i) => i.id === ui.focus!.id) : -1;

  // The next open or changed item after the focused one, wrapping to the start.
  const pending = (k: number) => states[k] === 'open' || states[k] === 'changed';
  const next = items.findIndex((_, k) => k > focused && pending(k));
  const nextId = items[next >= 0 ? next : states.findIndex((_, k) => pending(k))]?.id;

  const jump = (id: string) => {
    dispatch({ type: 'focus', target: { kind: 'item', id } });
    scrollDocTo(`mk-${id}`, 180);
  };

  return (
    <div class="stepper">
      <span class="st-lab">
        <b>{answered} of {items.length}</b> answered
        {deferred > 0 && <span class="def-ct"> · {deferred} deferred</span>}
      </span>
      <div class="segs">
        {items.map((item, k) => (
          <button
            key={item.id}
            type="button"
            class={['seg', `k-${item.kind}`, states[k], k === focused && 'on'].filter(Boolean).join(' ')}
            title={item.label}
            aria-label={item.label}
            onClick={() => jump(item.id)}
          />
        ))}
      </div>
      {nextId ? (
        <button type="button" class="btn sm ghost" onClick={() => jump(nextId)}>
          Next open<RightIcon />
        </button>
      ) : (
        <span class="idx-all"><CheckIcon />All answered</span>
      )}
    </div>
  );
}
