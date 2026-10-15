// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { options } from 'preact';
import { fireEvent, screen } from '@testing-library/preact';
import type { Answer, ReviewItem, Section } from '@plan-review/core';
import { ItemCard } from '../src/components/ItemCard.js';
import { SectionView } from '../src/components/SectionView.js';
import { answer, assumptionItem, decisionItem, mockLoaded, mockPlanDoc, renderWithReview } from './test-utils.js';

const decision: ReviewItem = { ...decisionItem, context: 'Unbounded retries caused the Aug 14 incident.' };

function renderCard(item: ReviewItem, answers: Record<string, Answer> = {}) {
  const base = mockLoaded();
  const loaded = { ...base, items: [decision, assumptionItem], review: { ...base.review, answers } };
  return renderWithReview(<ItemCard item={item} loc="§ 1.1" />, loaded);
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const queryButton = (name: string | RegExp) => screen.queryByRole('button', { name });
const option = (container: Element, key: string) =>
  Array.from(container.querySelectorAll('.opt')).find((o) => o.querySelector('.opt-key')!.textContent === key)!;
const typeInto = (el: Element, value: string) => fireEvent.input(el, { target: { value } });

describe('ItemCard', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  describe('open decision', () => {
    it('shows kind tag, label, loc, question and context', () => {
      const { container } = renderCard(decision);
      expect(container.querySelector('.kind')!.textContent).toBe('Decision');
      expect(container.querySelector('.ic-label')!.textContent).toBe('Retry backoff');
      expect(container.querySelector('.loc')!.textContent).toBe('§ 1.1');
      expect(container.querySelector('.ic-q')!.textContent).toBe('How should retries back off?');
      expect(container.querySelector('.ic-ctx')!.textContent).toBe('Unbounded retries caused the Aug 14 incident.');
    });

    it('lists the options with their detail, the author\'s pick, and "Something else"', () => {
      const { container } = renderCard(decision);
      const opts = Array.from(container.querySelectorAll('.opt'));
      expect(opts.map((o) => o.querySelector('.opt-key')!.textContent)).toEqual(['A', 'B', '…']);
      expect(opts[1].querySelector('.opt-text')!.textContent).toBe('Circuit breakerafter 90 s');
      expect(opts[2].querySelector('.opt-text')!.textContent).toBe('Something else');
      expect(opts.map((o) => o.querySelector('.pick')?.textContent ?? null)).toEqual(["Author's pick", null, null]);
    });

    it('keeps Save disabled until an option is chosen, then saves the answer with a trimmed note', () => {
      const { container, review } = renderCard(decision);
      expect(button('Save decision')).toHaveProperty('disabled', true);
      expect(container.querySelector('textarea')).toBeNull();

      fireEvent.click(option(container, 'B').querySelector('input')!);
      expect(option(container, 'B').classList.contains('on')).toBe(true);
      typeInto(container.querySelector('textarea')!, '  breaker is safer  ');
      fireEvent.click(button('Save decision'));

      expect(review.current.state.review.answers['retry-backoff']).toMatchObject({ choice: 'B', note: 'breaker is safer' });
      expect(container.querySelector('.answer')!.textContent).toContain('B · Circuit breaker');
    });

    // A real browser runs microtasks between event listeners, so Preact re-renders
    // after the card's focus handler while the radio's click is still being
    // dispatched. Rendering synchronously (and dispatching outside act(), which
    // would defer renders) reproduces that ordering in jsdom. Chrome fires `change`
    // only if the radio is still checked once the click has finished dispatching;
    // jsdom fires it regardless, so that is asserted directly.
    describe('when renders run between event listeners, as in a real browser', () => {
      let debounce: typeof options.debounceRendering;
      beforeEach(() => {
        debounce = options.debounceRendering;
        options.debounceRendering = (cb) => cb();
      });
      afterEach(() => { options.debounceRendering = debounce; });

      it.each([
        ['label', (opt: Element) => opt],
        ['text', (opt: Element) => opt.querySelector('.opt-text')!],
      ])('clicking an option %s selects it and leaves its radio checked after the click', (_, target) => {
        const { container } = renderCard(decision);
        const radio = option(container, 'B').querySelector('input')!;
        let checkedAfterDispatch: boolean | null = null;
        const record = (e: Event) => { if (e.target === radio) checkedAfterDispatch = radio.checked; };
        window.addEventListener('click', record);
        try {
          target(option(container, 'B')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } finally {
          window.removeEventListener('click', record);
        }
        expect(checkedAfterDispatch).toBe(true);
        expect(option(container, 'B').classList.contains('on')).toBe(true);
        expect(button('Save decision')).toHaveProperty('disabled', false);
      });
    });

    it('options form a labelled radio group that also selects on change (arrow keys)', () => {
      const { container } = renderCard(decision);
      expect(screen.getByRole('radiogroup', { name: 'Retry backoff' })).toBeTruthy();
      const radios = screen.getAllByRole('radio');
      expect(radios).toHaveLength(3);
      fireEvent.change(radios[1]);
      expect(option(container, 'B').classList.contains('on')).toBe(true);
    });

    it('requires a note for "Something else"', () => {
      const { container } = renderCard(decision);
      fireEvent.click(option(container, '…').querySelector('input')!);
      const note = container.querySelector('textarea')!;
      expect(note.getAttribute('placeholder')).toBe('Describe your option');
      expect(button('Save decision')).toHaveProperty('disabled', true);
      typeInto(note, '   ');
      expect(button('Save decision')).toHaveProperty('disabled', true);
      typeInto(note, 'Use a token bucket');
      expect(button('Save decision')).toHaveProperty('disabled', false);
    });
  });

  describe('open assumption', () => {
    it('offers the verdicts Holds / Not sure / Doesn\'t hold', () => {
      const { container } = renderCard(assumptionItem);
      expect(container.querySelector('.kind')!.textContent).toBe('Assumption');
      expect(Array.from(container.querySelectorAll('.verdict'), (v) => v.textContent)).toEqual(['Holds', 'Not sure', "Doesn't hold"]);
      expect(container.querySelector('.opts')).toBeNull();
    });

    it('saves a verdict with an optional rationale', () => {
      const { container, review } = renderCard(assumptionItem);
      expect(button('Save')).toHaveProperty('disabled', true);
      fireEvent.click(button('Not sure'));
      expect(container.querySelector('textarea')!.getAttribute('placeholder')).toBe('Rationale (optional)');
      fireEvent.click(button('Save'));
      expect(review.current.state.review.answers['auth-latency']).toMatchObject({ choice: 'unsure', note: '' });
      expect(container.querySelector('.answer.v-unsure')!.textContent).toContain('Not sure');
    });

    it('requires a note for "Doesn\'t hold"', () => {
      const { container } = renderCard(assumptionItem);
      fireEvent.click(button("Doesn't hold"));
      const note = container.querySelector('textarea')!;
      expect(note.getAttribute('placeholder')).toBe("What's actually true?");
      expect(button('Save')).toHaveProperty('disabled', true);
      typeInto(note, 'p99 is 450 ms');
      expect(button('Save')).toHaveProperty('disabled', false);
    });
  });

  describe('defer', () => {
    it('opens a panel with an optional note and defers on confirm', () => {
      const { container, review } = renderCard(decision);
      fireEvent.click(button('Defer'));
      expect(container.querySelector('.defer-h')!.textContent).toBe('Defer this decision');
      expect(document.activeElement).toBe(container.querySelector('.defer-panel textarea'));
      typeInto(container.querySelector('.defer-panel textarea')!, ' Ask the SRE team ');
      fireEvent.click(container.querySelector('.defer-go')!);
      expect(review.current.state.review.answers['retry-backoff']).toMatchObject({ choice: 'deferred', note: 'Ask the SRE team' });
      expect(container.querySelector('.answer.v-deferred')!.textContent).toContain('Deferred');
    });

    it('Back closes the panel without deferring', () => {
      const { container, review } = renderCard(assumptionItem);
      fireEvent.click(button('Defer'));
      expect(container.querySelector('.defer-h')!.textContent).toBe('Defer this assumption');
      fireEvent.click(button('Back'));
      expect(container.querySelector('.defer-panel')).toBeNull();
      expect(container.querySelector('.verdicts')).toBeTruthy();
      expect(review.current.state.review.answers).toEqual({});
    });
  });

  describe('done', () => {
    const done = { 'retry-backoff': { ...answer(decision, 'A'), note: 'Keep it simple' } };

    it('shows the answer summary with its note and a Change button', () => {
      const { container } = renderCard(decision, done);
      expect(container.querySelector('.answer b')!.textContent).toBe('A');
      expect(container.querySelector('.answer')!.textContent).toContain('A · Exponential');
      expect(container.querySelector('.answer .note')!.textContent).toBe('Keep it simple');
      expect(container.querySelector('.opts')).toBeNull();
      expect(button('Change')).toBeTruthy();
    });

    it('Change reopens the editor prefilled with the answer', () => {
      const { container } = renderCard(decision, done);
      fireEvent.click(button('Change'));
      expect(option(container, 'A').classList.contains('on')).toBe(true);
      expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Keep it simple');
    });

    it('Cancel restores the summary without changing the answer', () => {
      const { container, review } = renderCard(decision, done);
      fireEvent.click(button('Change'));
      fireEvent.click(option(container, 'B').querySelector('input')!);
      fireEvent.click(button('Cancel'));
      expect(container.querySelector('.answer')!.textContent).toContain('A · Exponential');
      expect(review.current.state.review.answers['retry-backoff'].choice).toBe('A');

      fireEvent.click(button('Change'));
      expect(option(container, 'A').classList.contains('on')).toBe(true);
    });
  });

  describe('deferred', () => {
    const deferred = { 'auth-latency': { ...answer(assumptionItem, 'deferred'), note: 'Load test first' } };

    it('shows Deferred with its note and an Answer now button', () => {
      const { container } = renderCard(assumptionItem, deferred);
      expect(container.querySelector('.answer.v-deferred b')!.textContent).toBe('Deferred');
      expect(container.querySelector('.answer .note')!.textContent).toBe('Load test first');
      expect(button('Answer now')).toBeTruthy();
    });

    it('Answer now opens an empty editor without a Defer button; Cancel goes back', () => {
      const { container } = renderCard(assumptionItem, deferred);
      fireEvent.click(button('Answer now'));
      expect(container.querySelector('.verdict.on')).toBeNull();
      expect(queryButton('Defer')).toBeNull();
      fireEvent.click(button('Cancel'));
      expect(container.querySelector('.answer.v-deferred')).toBeTruthy();
    });
  });

  describe('changed', () => {
    it('shows the changed tag, the prior answer and the editor open', () => {
      const answers = { 'retry-backoff': { ...answer(decision, 'B', 'old-hash'), note: 'Was safer' } };
      const { container } = renderCard(decision, answers);
      expect(container.querySelector('.ic-changed')!.textContent).toBe('changed since you answered');
      const prior = container.querySelector('.answer.is-prior')!;
      expect(prior.textContent).toContain('B · Circuit breaker');
      expect(prior.textContent).toContain('Was safer');
      expect(prior.querySelector('button')).toBeNull();
      expect(container.querySelector('.opts')).toBeTruthy();
      expect(button('Save decision')).toHaveProperty('disabled', true);
      expect(queryButton('Cancel')).toBeNull();
      expect(button('Defer')).toBeTruthy();
    });
  });

  describe('focus', () => {
    it('clicking the card focuses it and shows the focus ring', () => {
      const { container, review } = renderCard(decision);
      const card = container.querySelector('.item-card')!;
      expect(card.classList.contains('is-focus')).toBe(false);
      fireEvent.click(card.querySelector('.ic-q')!);
      expect(review.current.state.ui.focus).toEqual({ kind: 'item', id: 'retry-backoff' });
      expect(card.classList.contains('is-focus')).toBe(true);
    });

    it('scrolls the focused card into view', () => {
      const { container, review } = renderCard(decision);
      review.current.dispatch({ type: 'focus', target: { kind: 'item', id: 'retry-backoff' } });
      const card = container.querySelector('#card-retry-backoff')!;
      return vi.waitFor(() => expect(card.scrollIntoView).toHaveBeenCalled());
    });

    it('the loc button focuses the item and scrolls the document to it', () => {
      const scrollTo = vi.fn();
      HTMLElement.prototype.scrollTo = scrollTo;
      const base = mockLoaded();
      const { review } = renderWithReview(
        <>
          <ItemCard item={decision} loc="§ 1.1" />
          <div class="main"><div class="scroll"><span id="mk-retry-backoff">quote</span></div></div>
        </>,
        { ...base, items: [decision] },
      );
      fireEvent.click(button('§ 1.1'));
      expect(review.current.state.ui.focus).toEqual({ kind: 'item', id: 'retry-backoff' });
      expect(scrollTo).toHaveBeenCalledWith({ top: -180, behavior: 'smooth' });
    });

    it('focusing the card highlights its quote in the document', () => {
      const section: Section = { ...mockPlanDoc.sections[1], body: 'Decide how retries back off.\n\n```decision id=retry-backoff\n```' };
      const item = { ...decision, quote: 'how retries back off' };
      const base = mockLoaded();
      const { container } = renderWithReview(
        <>
          <ItemCard item={item} loc="§ 1.1" />
          <SectionView section={section} num="1.1" />
        </>,
        { ...base, document: { ...mockPlanDoc, sections: [section] }, items: [item] },
      );
      const mark = () => container.querySelector('#mk-retry-backoff')!;
      expect(mark().classList.contains('is-focus')).toBe(false);
      fireEvent.click(container.querySelector('.item-card')!);
      expect(mark().classList.contains('is-focus')).toBe(true);
    });
  });
});
