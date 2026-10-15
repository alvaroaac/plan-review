import type {
  Answer,
  LineAnchor,
  LoadedReview,
  PlanDocument,
  ReviewItem,
  ReviewView,
  SubmitRequest,
  Thread,
  ThreadComment,
} from '@plan-review/core';
import { newCommentId, newThreadId } from '@plan-review/core/review';
import type { Theme } from '../theme.js';
import { isListed } from '../threads.js';

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
    /** The open composer; its body is kept here so moving it to another block keeps the text. */
    composing: { sectionId: string; anchor: LineAnchor | null; body: string } | null;
    theme: Theme;
    submitOpen: boolean;
    submitted: { output: string } | null;
    /** A failed submit keeps its request so the failure view can format the review locally. */
    submitError: { message: string; request: SubmitRequest } | null;
    /** The summary the submit popover starts from: the failed request's, after Back to review. */
    summarySeed: string;
  };
}

export type ReviewAction =
  | { type: 'answer'; itemId: string; choice: string; note: string }
  | { type: 'defer'; itemId: string; note?: string }
  | { type: 'clearAnswer'; itemId: string }
  | { type: 'startCompose'; sectionId: string; anchor: LineAnchor | null }
  | { type: 'cancelCompose' }
  | { type: 'composeBody'; body: string }
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
  | { type: 'submitFailed'; error: string; request: SubmitRequest }
  | { type: 'dismissSubmitError' }
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
      summarySeed: '',
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
        composing: { sectionId: action.sectionId, anchor: action.anchor, body: state.ui.composing?.body ?? '' },
        tab: 'comments',
      });
    case 'cancelCompose':
      return withUi(state, { composing: null });
    case 'composeBody':
      if (!state.ui.composing) return state;
      return withUi(state, { composing: { ...state.ui.composing, body: action.body } });
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
      return withUi(state, { submitError: { message: action.error, request: action.request }, submitOpen: false });
    case 'dismissSubmitError':
      return withUi(state, {
        submitError: null,
        summarySeed: state.ui.submitError?.request.summary ?? state.ui.summarySeed,
      });
    case 'reload':
      return reload(state, action.loaded);
  }
}

// The new round may drop the focused item or thread, or the section being commented on.
function reload(state: ReviewState, loaded: LoadedReview): ReviewState {
  const next = { ...state, ...fromLoaded(loaded) };
  const { focus, composing } = state.ui;
  const focusExists = !focus || (focus.kind === 'item'
    ? next.items.some((i) => i.id === focus.id)
    : next.review.threads.some((t) => t.id === focus.id));
  const composingExists = !composing || next.doc.sections.some((s) => s.id === composing.sectionId);
  return withUi(next, {
    focus: focusExists ? focus : null,
    composing: composingExists ? composing : null,
    tab: next.items.length === 0 ? 'comments' : state.ui.tab,
  });
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
// and widen the thread filter when the current one would hide the thread.
function focus(state: ReviewState, target: FocusTarget | null): ReviewState {
  if (!target) return withUi(state, { focus: null });
  if (target.kind === 'item') return withUi(state, { focus: target, tab: 'decisions' });
  const thread = state.review.threads.find((t) => t.id === target.id);
  const hidden = thread && !isListed(state.ui.filter, thread);
  return withUi(state, { focus: target, tab: 'comments', filter: hidden ? 'all' : state.ui.filter });
}
