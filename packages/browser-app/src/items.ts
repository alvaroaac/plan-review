import type { Answer, ItemState, ReviewItem } from '@plan-review/core';
import { itemState } from '@plan-review/core/review';

/** An item still waiting for the reviewer: never answered, or changed since. */
export const isPending = (state: ItemState): boolean => state === 'open' || state === 'changed';

/** The next pending item after `afterId` (or from the start), wrapping round to `afterId` itself. */
export function nextPendingItem(items: ReviewItem[], answers: Record<string, Answer>, afterId?: string): ReviewItem | undefined {
  const from = items.findIndex((item) => item.id === afterId) + 1;
  return [...items.slice(from), ...items.slice(0, from)].find((item) => isPending(itemState(item, answers[item.id])));
}
