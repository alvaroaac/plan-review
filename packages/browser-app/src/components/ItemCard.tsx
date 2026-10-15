import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Answer, AssumptionVerdict, ItemState, ReviewItem } from '@plan-review/core';
import { itemState } from '@plan-review/core/review';
import { useReview } from '../state/ReviewContext.js';
import { scrollDocTo } from '../scroll.js';
import { CheckIcon, ClockIcon } from './icons.js';

const VERDICTS: Record<AssumptionVerdict, string> = { holds: 'Holds', unsure: 'Not sure', no: "Doesn't hold" };

interface Draft {
  choice: string | null;
  note: string;
  deferNote: string;
}

// The editor starts from the stored answer when there is a valid one to change.
function draftFrom(state: ItemState, saved: Answer | undefined): Draft {
  if (state === 'done') return { choice: saved!.choice, note: saved!.note, deferNote: '' };
  if (state === 'deferred') return { choice: null, note: '', deferNote: saved!.note };
  return { choice: null, note: '', deferNote: '' };
}

export function ItemCard({ item, loc }: { item: ReviewItem; loc: string }) {
  const { state, dispatch } = useReview();
  const saved = state.review.answers[item.id];
  const status = itemState(item, saved);
  const focused = state.ui.focus?.kind === 'item' && state.ui.focus.id === item.id;
  const isDecision = item.kind === 'decision';

  const [editing, setEditing] = useState(false);
  const [deferring, setDeferring] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(status, saved));
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focused]);

  const deferNoteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (deferring) deferNoteRef.current?.focus({ preventScroll: true });
  }, [deferring]);

  const showEditor = status === 'open' || status === 'changed' || editing;
  const needsNote = draft.choice === 'other' || draft.choice === 'no';
  const canSave = draft.choice !== null && (!needsNote || draft.note.trim() !== '');

  const focus = () => dispatch({ type: 'focus', target: { kind: 'item', id: item.id } });
  const jumpToDoc = () => {
    focus();
    scrollDocTo(`mk-${item.id}`, 180);
  };
  const save = () => {
    dispatch({ type: 'answer', itemId: item.id, choice: draft.choice!, note: draft.note.trim() });
    setEditing(false);
  };
  const defer = () => {
    dispatch({ type: 'defer', itemId: item.id, note: draft.deferNote.trim() });
    setDraft({ choice: null, note: '', deferNote: draft.deferNote.trim() });
    setDeferring(false);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(draftFrom(status, saved));
    setEditing(false);
  };

  return (
    <div
      ref={ref}
      id={`card-${item.id}`}
      class={`card item-card k-${item.kind}${focused ? ' is-focus' : ''}`}
      onClick={focus}
    >
      <div class="ic-head">
        <span class={`kind kind-${item.kind}`}>{isDecision ? 'Decision' : 'Assumption'}</span>
        <span class="ic-label">{item.label}</span>
        <button type="button" class="loc" title="Show in document" onClick={jumpToDoc}>{loc}</button>
      </div>
      {status === 'changed' && <div class="ic-changed">changed since you answered</div>}
      <p class="ic-q">{item.question}</p>
      {showEditor && item.context && <p class="ic-ctx">{item.context}</p>}

      {status === 'changed' && <AnswerSummary item={item} answer={saved!} prior />}

      {!showEditor && (
        <AnswerSummary item={item} answer={saved!}>
          <button type="button" class="btn sm" onClick={() => setEditing(true)}>
            {status === 'deferred' ? 'Answer now' : 'Change'}
          </button>
        </AnswerSummary>
      )}

      {showEditor && deferring && (
        <div class="defer-panel">
          <div class="defer-h"><ClockIcon />Defer this {isDecision ? 'decision' : 'assumption'}</div>
          <textarea
            class="field"
            ref={deferNoteRef}
            value={draft.deferNote}
            onInput={(e) => update({ deferNote: e.currentTarget.value })}
            placeholder="What's needed first, or who should decide? (optional)"
          />
          <div class="ic-actions">
            <button type="button" class="btn sm ghost" onClick={() => setDeferring(false)}>Back</button>
            <button type="button" class="btn sm defer-go" onClick={defer}>Defer</button>
          </div>
        </div>
      )}

      {showEditor && !deferring && (
        <>
          {isDecision ? (
            <DecisionOptions item={item} choice={draft.choice} onChoose={(choice) => update({ choice })} />
          ) : (
            <div class="verdicts">
              {Object.entries(VERDICTS).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  class={`verdict v-${key}${draft.choice === key ? ' on' : ''}`}
                  onClick={() => update({ choice: key })}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {draft.choice && (
            <textarea
              class="field"
              value={draft.note}
              onInput={(e) => update({ note: e.currentTarget.value })}
              placeholder={
                draft.choice === 'other' ? 'Describe your option'
                  : draft.choice === 'no' ? "What's actually true?"
                    : 'Rationale (optional)'
              }
            />
          )}
          <div class="ic-actions">
            {status !== 'deferred' && (
              <button type="button" class="btn sm ghost" onClick={() => setDeferring(true)}><ClockIcon />Defer</button>
            )}
            <span class="sp" />
            {editing && <button type="button" class="btn sm ghost" onClick={cancel}>Cancel</button>}
            <button type="button" class="btn sm primary" disabled={!canSave} onClick={save}>
              {isDecision ? 'Save decision' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DecisionOptions({ item, choice, onChoose }: {
  item: ReviewItem;
  choice: string | null;
  onChoose: (choice: string) => void;
}) {
  const options = [
    ...(item.options ?? []).map((o) => ({ key: o.key, label: o.key, text: o.text, detail: o.detail, pick: o.pick })),
    { key: 'other', label: '…', text: 'Something else', detail: undefined, pick: false },
  ];
  return (
    <div class="opts">
      {options.map((o) => (
        <label key={o.key} class={`opt${choice === o.key ? ' on' : ''}`}>
          <input type="radio" name={item.id} checked={choice === o.key} onChange={() => onChoose(o.key)} />
          <span class="opt-key">{o.label}</span>
          <span class="opt-text">{o.text}{o.detail && <small>{o.detail}</small>}</span>
          {o.pick ? <span class="pick">Author's pick</span> : <span />}
        </label>
      ))}
    </div>
  );
}

function AnswerSummary({ item, answer, prior = false, children }: {
  item: ReviewItem;
  answer: Answer;
  prior?: boolean;
  children?: ComponentChildren;
}) {
  const deferred = answer.choice === 'deferred';
  const tone = prior ? 'is-prior' : deferred ? 'v-deferred' : item.kind === 'assumption' ? `v-${answer.choice}` : '';
  return (
    <div class={`answer ${tone}`.trim()}>
      {deferred ? <ClockIcon /> : <CheckIcon />}
      <div>
        <AnswerLabel item={item} answer={answer} />
        {answer.note && <span class="note">{answer.note}</span>}
      </div>
      {children}
    </div>
  );
}

function AnswerLabel({ item, answer }: { item: ReviewItem; answer: Answer }) {
  if (answer.choice === 'deferred') return <b>Deferred</b>;
  if (item.kind === 'assumption') return <b>{VERDICTS[answer.choice as AssumptionVerdict] ?? answer.choice}</b>;
  if (answer.choice === 'other') return <b>Other</b>;
  // A changed item may no longer offer the option that was picked.
  const option = item.options?.find((o) => o.key === answer.choice);
  return option ? <><b>{answer.choice}</b> · {option.text}</> : <b>{answer.choice}</b>;
}
