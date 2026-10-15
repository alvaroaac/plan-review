import type {
  Answer,
  LineAnchor,
  LoadedReview,
  PlanDocument,
  ReviewItem,
  ReviewView,
  Thread,
  ThreadComment,
} from '@plan-review/core';
import { newCommentId, newThreadId } from '@plan-review/core/review';
import type { Theme } from '../theme.js';

export type Tab = 'decisions' | 'comments';
export type ThreadFilter = 'open' | 'resolved' | 'all';
export type FocusTarget = { kind: 'item' | 'thread'; id: string };

export interface ReviewState {
  doc: PlanDocument;
  items: ReviewItem[];
  warnings: string[];
  review: ReviewView;
  ui: {
    tab: Tab;
    filter: ThreadFilter;
    focus: FocusTarget | null;
    composing: { sectionId: string; anchor: LineAnchor | null } | null;
    theme: Theme;
    submitOpen: boolean;
    submitted: { output: string } | null;
    submitError: string | null;
  };
}

export type ReviewAction =
  | { type: 'answer'; itemId: string; choice: string; note: string }
  | { type: 'defer'; itemId: string; note?: string }
  | { type: 'clearAnswer'; itemId: string }
  | { type: 'startCompose'; sectionId: string; anchor: LineAnchor | null }
  | { type: 'cancelCompose' }
  | { type: 'addThread'; sectionId: string; anchor: LineAnchor | null; body: string }
  | { type: 'reply'; threadId: string; body: string }
  | { type: 'resolve'; threadId: string }
  | { type: 'reopen'; threadId: string }
  | { type: 'focus'; target: FocusTarget | null }
  | { type: 'setTab'; tab: Tab }
  | { type: 'setFilter'; filter: ThreadFilter }
  | { type: 'toggleTheme' }
  | { type: 'openSubmit' }
  | { type: 'closeSubmit' }
  | { type: 'submitted'; output: string }
  | { type: 'submitFailed'; error: string }
  | { type: 'reload'; loaded: LoadedReview };

const PROGRESS_ACTIONS: ReadonlySet<ReviewAction['type']> = new Set([
  'answer', 'defer', 'clearAnswer', 'addThread', 'reply', 'resolve', 'reopen',
]);

/** True for actions that change `answers` or `threads` — the ones that must be autosaved. */
export function isProgressAction(action: ReviewAction): boolean {
  return PROGRESS_ACTIONS.has(action.type);
}

export function initReviewState(loaded: LoadedReview, theme: Theme): ReviewState {
  return {
    ...fromLoaded(loaded),
    ui: {
      tab: loaded.items.length > 0 ? 'decisions' : 'comments',
      filter: 'open',
      focus: null,
      composing: null,
      theme,
      submitOpen: false,
      submitted: null,
      submitError: null,
    },
  };
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'answer':
      return setAnswer(state, action.itemId, action.choice, action.note);
    case 'defer':
      return setAnswer(state, action.itemId, 'deferred', action.note ?? '');
    case 'clearAnswer': {
      const { [action.itemId]: _removed, ...answers } = state.review.answers;
      return withReview(state, { answers });
    }
    case 'startCompose':
      return withUi(state, {
        composing: { sectionId: action.sectionId, anchor: action.anchor },
        tab: 'comments',
      });
    case 'cancelCompose':
      return withUi(state, { composing: null });
    case 'addThread': {
      const thread: Thread = {
        id: newThreadId(),
        sectionId: action.sectionId,
        anchor: action.anchor,
        resolved: false,
        outdated: false,
        createdRound: state.review.round,
        comments: [reviewerComment(action.body)],
      };
      const next = withReview(state, { threads: [...state.review.threads, thread] });
      return withUi(next, { composing: null, focus: { kind: 'thread', id: thread.id } });
    }
    case 'reply':
      return updateThread(state, action.threadId, (t) => ({
        ...t,
        comments: [...t.comments, reviewerComment(action.body)],
      }));
    case 'resolve':
      return updateThread(state, action.threadId, (t) => ({ ...t, resolved: true }));
    case 'reopen':
      return updateThread(state, action.threadId, (t) => ({ ...t, resolved: false }));
    case 'focus':
      return focus(state, action.target);
    case 'setTab':
      if (action.tab === 'decisions' && state.items.length === 0) return state;
      return withUi(state, { tab: action.tab });
    case 'setFilter':
      return withUi(state, { filter: action.filter });
    case 'toggleTheme':
      return withUi(state, { theme: state.ui.theme === 'dark' ? 'light' : 'dark' });
    case 'openSubmit':
      return withUi(state, { submitOpen: true });
    case 'closeSubmit':
      return withUi(state, { submitOpen: false });
    case 'submitted':
      return withUi(state, { submitted: { output: action.output }, submitOpen: false });
    case 'submitFailed':
      return withUi(state, { submitError: action.error, submitOpen: false });
    case 'reload': {
      const next = { ...state, ...fromLoaded(action.loaded) };
      return next.items.length === 0 ? withUi(next, { tab: 'comments' }) : next;
    }
  }
}

function fromLoaded(loaded: LoadedReview): Omit<ReviewState, 'ui'> {
  return { doc: loaded.document, items: loaded.items, warnings: loaded.warnings, review: loaded.review };
}

function withReview(state: ReviewState, patch: Partial<ReviewView>): ReviewState {
  return { ...state, review: { ...state.review, ...patch } };
}

function withUi(state: ReviewState, patch: Partial<ReviewState['ui']>): ReviewState {
  return { ...state, ui: { ...state.ui, ...patch } };
}

function setAnswer(state: ReviewState, itemId: string, choice: string, note: string): ReviewState {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return state;
  const answer: Answer = {
    choice,
    note,
    itemHash: item.hash,
    round: state.review.round,
    updatedAt: new Date().toISOString(),
  };
  return withReview(state, { answers: { ...state.review.answers, [itemId]: answer } });
}

function reviewerComment(body: string): ThreadComment {
  return { id: newCommentId(), author: 'reviewer', body, createdAt: new Date().toISOString() };
}

function updateThread(state: ReviewState, threadId: string, update: (t: Thread) => Thread): ReviewState {
  if (!state.review.threads.some((t) => t.id === threadId)) return state;
  return withReview(state, {
    threads: state.review.threads.map((t) => (t.id === threadId ? update(t) : t)),
  });
}

// Focusing something in the doc reveals its card: switch to the tab that lists it,
// and widen the thread filter when a resolved thread would otherwise be hidden.
function focus(state: ReviewState, target: FocusTarget | null): ReviewState {
  if (!target) return withUi(state, { focus: null });
  if (target.kind === 'item') return withUi(state, { focus: target, tab: 'decisions' });
  const thread = state.review.threads.find((t) => t.id === target.id);
  const hidden = thread?.resolved && state.ui.filter === 'open';
  return withUi(state, { focus: target, tab: 'comments', filter: hidden ? 'all' : state.ui.filter });
}
