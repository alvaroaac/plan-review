import type { Answer, ItemState, ReviewItem } from './types.js';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashItem(item: Pick<ReviewItem, 'kind' | 'question' | 'options'>): string {
  const options = item.options?.map((o) => [o.key, o.text, o.detail ?? '']);
  return fnv1a(JSON.stringify([item.kind, item.question, options]));
}

export function contentHash(markdown: string): string {
  return fnv1a(markdown);
}

export function itemState(item: ReviewItem, answer: Answer | undefined): ItemState {
  if (!answer) return 'open';
  if (answer.itemHash !== item.hash) return 'changed';
  return answer.choice === 'deferred' ? 'deferred' : 'done';
}

export interface ItemCounts {
  decisions: { answered: number; deferred: number; open: number };
  assumptions: { holds: number; unsure: number; no: number; deferred: number; open: number };
}

export function itemCounts(items: ReviewItem[], answers: Record<string, Answer>): ItemCounts {
  const counts: ItemCounts = {
    decisions: { answered: 0, deferred: 0, open: 0 },
    assumptions: { holds: 0, unsure: 0, no: 0, deferred: 0, open: 0 },
  };
  for (const item of items) {
    const answer = answers[item.id];
    const state = itemState(item, answer);
    if (item.kind === 'decision') {
      if (state === 'done') counts.decisions.answered++;
      else if (state === 'deferred') counts.decisions.deferred++;
      else counts.decisions.open++;
    } else if (state === 'deferred') {
      counts.assumptions.deferred++;
    } else if (state === 'done' && isVerdict(answer!.choice)) {
      counts.assumptions[answer!.choice]++;
    } else {
      counts.assumptions.open++;
    }
  }
  return counts;
}

function isVerdict(choice: string): choice is 'holds' | 'unsure' | 'no' {
  return choice === 'holds' || choice === 'unsure' || choice === 'no';
}

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomId(prefix: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return prefix + Array.from(bytes, (b) => BASE36[b % BASE36.length]).join('');
}

export const newReviewId = (): string => randomId('rv_', 8);
export const newThreadId = (): string => randomId('t_', 6);
export const newCommentId = (): string => randomId('c_', 8);
