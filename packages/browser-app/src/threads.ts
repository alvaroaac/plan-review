import type { Thread } from '@plan-review/core';
import type { ThreadFilter } from './state/reducer.js';

/** An open thread: neither resolved nor outdated. Used wherever open threads are counted. */
export function isOpenThread(thread: Thread): boolean {
  return !thread.resolved && !thread.outdated;
}

/** Whether the Comments list shows `thread` under `filter`; outdated threads are always listed. */
export function isListed(filter: ThreadFilter, thread: Thread): boolean {
  if (thread.outdated || filter === 'all') return true;
  return filter === 'open' ? !thread.resolved : thread.resolved;
}
