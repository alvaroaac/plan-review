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
import { findLineRun, renderToLineBlocks } from '@plan-review/core/items';
import type { Theme } from '../theme.js';
import { isListed } from '../threads.js';
import { nextPendingItem } from '../items.js';

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
    composing: { sectionId: string; anchor: LineAnchor | null; body: string; detached?: boolean } | null;
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
  // `itemHash` pins the item revision an answer was given for (see ReviewProvider's held edits).
  | { type: 'answer'; itemId: string; choice: string; note: string; itemHash?: string }
  | { type: 'defer'; itemId: string; note?: string; itemHash?: string }
  | { type: 'clearAnswer'; itemId: string }
  // `doc` pins the document a composer was opened on, when that start is held through a reload.
  | { type: 'startCompose'; sectionId: string; anchor: LineAnchor | null; doc?: PlanDocument }
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
      return focusNextPending(state, setAnswer(state, action.itemId, action.choice, action.note, action.itemHash), action.itemId);
    case 'defer':
      return focusNextPending(state, setAnswer(state, action.itemId, 'deferred', action.note ?? '', action.itemHash), action.itemId);
    case 'clearAnswer': {
      const { [action.itemId]: _removed, ...answers } = state.review.answers;
      return withReview(state, { answers });
    }
    case 'startCompose': {
      const composing = { sectionId: action.sectionId, anchor: action.anchor, body: state.ui.composing?.body ?? '' };
      // A start held through a reload targets the old document; re-anchor it like an open draft.
      const moved = action.doc && action.doc !== state.doc ? reanchorComposer(composing, action.doc, state) : composing;
      return withUi(state, { composing: moved, tab: 'comments' });
    }
    case 'cancelCompose':
      return withUi(state, { composing: null });
    case 'composeBody':
      if (!state.ui.composing) return state;
      return withUi(state, { composing: { ...state.ui.composing, body: action.body } });
    case 'addThread': {
      // The single guard against posting a detached draft (the Comment button is only UX).
      if (state.ui.composing?.detached) return state;
      // The open composer wins over the action's fields: a reload may have re-anchored it.
      const target = state.ui.composing ?? action;
      const thread: Thread = {
        id: newThreadId(),
        sectionId: target.sectionId,
        anchor: target.anchor,
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
  const { focus } = state.ui;
  const focusExists = !focus || (focus.kind === 'item'
    ? next.items.some((i) => i.id === focus.id)
    : next.review.threads.some((t) => t.id === focus.id));
  return withUi(next, {
    focus: focusExists ? focus : null,
    composing: state.ui.composing && reanchorComposer(state.ui.composing, state.doc, next),
    tab: next.items.length === 0 ? 'comments' : state.ui.tab,
  });
}

type Composing = NonNullable<ReviewState['ui']['composing']>;

function reanchorComposer(composing: Composing, previousDoc: PlanDocument, next: ReviewState): Composing {
  const oldSection = previousDoc.sections.find((section) => section.id === composing.sectionId);
  const ordinal = previousDoc.sections.filter((section) => section.heading === oldSection?.heading)
    .findIndex((section) => section.id === composing.sectionId);
  const preferred = next.doc.sections.filter((section) => section.heading === oldSection?.heading)[ordinal];
  if (!composing.anchor) {
    return preferred ? { ...composing, sectionId: preferred.id, detached: false } : { ...composing, detached: true };
  }
  const { anchor } = composing;
  const sections = preferred ? [preferred, ...next.doc.sections.filter((section) => section !== preferred)] : next.doc.sections;
  for (const section of sections) {
    const itemIds = new Set(next.items.filter((item) => item.sectionId === section.id).map((item) => item.id));
    const blocks = renderToLineBlocks(section.body, itemIds);
    const range = findLineRun(blocks, anchor.lineTexts, anchor);
    if (!range) continue;
    return {
      ...composing, sectionId: section.id, detached: false,
      anchor: {
        ...anchor, startLine: range.start, endLine: range.end,
        lineTexts: blocks.slice(range.start, range.end + 1).map((block) => block.text),
      },
    };
  }
  // Section ids are positional, so a detached draft keeps its heading-matched section.
  return { ...composing, sectionId: preferred?.id ?? composing.sectionId, detached: true };
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

function setAnswer(state: ReviewState, itemId: string, choice: string, note: string, itemHash?: string): ReviewState {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return state;
  const answer: Answer = {
    choice,
    note,
    itemHash: itemHash ?? item.hash,
    round: state.review.round,
    updatedAt: new Date().toISOString(),
  };
  return withReview(state, { answers: { ...state.review.answers, [itemId]: answer } });
}

// Answering the item in front of the reviewer moves them on to the next one still open,
// instead of following the answered card down the list.
function focusNextPending(previous: ReviewState, next: ReviewState, itemId: string): ReviewState {
  const { focus: current } = previous.ui;
  if (next === previous || (current && !(current.kind === 'item' && current.id === itemId))) return next;
  const pending = nextPendingItem(next.items, next.review.answers, itemId);
  return focus(next, pending ? { kind: 'item', id: pending.id } : null);
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
