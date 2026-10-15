import { useMemo } from 'preact/hooks';
import type { LineAnchor, ReviewItem, Section } from '@plan-review/core';
import { itemState } from '@plan-review/core/review';
import { useReview } from '../state/ReviewContext.js';
import type { FocusTarget } from '../state/reducer.js';
import { renderToLineBlocks, type LineBlock as Block } from '../lineRenderer.js';
import { markAll, markQuote } from '../highlight.js';
import { resolveAnchor } from '../anchors.js';
import { sectionElementId } from '../scroll.js';
import { LineBlock } from '../LineBlock.js';

type MarkState = 'open' | 'done' | 'deferred'; // a changed item reads as open again

// Quotes are looked up in prose only, never in code, tables or diagrams.
const PROSE = /^<(p|ul|ol)[\s>]/;

const BADGE: Record<MarkState, (item: ReviewItem) => string> = {
  open: (item) => (item.kind === 'decision' ? '?' : 'A'),
  done: () => '✓',
  deferred: () => '–',
};

export function SectionView({ section, num }: { section: Section; num: string }) {
  const { state, dispatch } = useReview();
  const { items, review, ui } = state;
  const sectionItems = useMemo(() => items.filter((i) => i.sectionId === section.id), [items, section.id]);
  const blocks = useMemo(
    () => renderToLineBlocks(section.body, new Set(sectionItems.map((i) => i.id))),
    [section.body, sectionItems],
  );

  const isFocused = (target: FocusTarget) => ui.focus?.kind === target.kind && ui.focus.id === target.id;
  const stateOf = (item: ReviewItem): MarkState => {
    const s = itemState(item, review.answers[item.id]);
    return s === 'changed' ? 'open' : s;
  };

  // Block HTML with quote and thread highlights applied; items whose quote is
  // not found are shown as a chip where their fence was.
  const html = blocks.map((b) => b.innerHtml);
  const chips = new Map<number, ReviewItem>();
  for (const item of sectionItems) {
    const s = stateOf(item);
    const mark = {
      id: `mk-${item.id}`,
      className: `q q-${item.kind} is-${s}${isFocused({ kind: 'item', id: item.id }) ? ' is-focus' : ''}`,
      data: { item: item.id },
      badge: BADGE[s](item),
    };
    const marker = blocks.findIndex((b) => b.itemId === item.id);
    if (!quoteNearest(html, blocks, marker < 0 ? blocks.length : marker, item.quote, mark) && marker >= 0) {
      chips.set(marker, item);
    }
  }
  for (const t of review.threads) {
    if (t.sectionId !== section.id || !t.anchor || t.resolved || t.outdated) continue;
    const range = resolveAnchor(blocks, t.anchor);
    if (!range) continue;
    const className = `hl${isFocused({ kind: 'thread', id: t.id }) ? ' is-focus' : ''}`;
    for (let i = range.start; i <= range.end; i++) {
      html[i] = markAll(html[i], { id: `hl-${t.id}`, className, data: { thread: t.id } });
    }
  }

  const composing = ui.composing?.sectionId === section.id ? ui.composing.anchor : null;
  const isPending = (i: number) => !!composing && i >= composing.startLine && i <= composing.endLine;

  const onAdd = (index: number, shiftKey: boolean) => {
    const from = shiftKey && composing ? Math.min(index, composing.startLine) : index;
    const to = shiftKey && composing ? Math.max(index, composing.endLine) : index;
    const anchor: LineAnchor = {
      type: 'lines',
      startLine: from,
      endLine: to,
      lineTexts: blocks.slice(from, to + 1).map((b) => b.text),
    };
    dispatch({ type: 'startCompose', sectionId: section.id, anchor });
  };

  // One listener for every highlight: they live inside injected HTML.
  const onClick = (e: MouseEvent) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-item], [data-thread]');
    if (!el) return;
    const target: FocusTarget = el.dataset.item
      ? { kind: 'item', id: el.dataset.item }
      : { kind: 'thread', id: el.dataset.thread! };
    dispatch({ type: 'focus', target });
  };

  const Heading = section.level <= 2 ? 'h2' : 'h3';
  return (
    <section onClick={onClick}>
      <Heading id={sectionElementId(section.id)}>
        <span class="h2-num">{num}</span>
        {section.heading}
      </Heading>
      {blocks.map((block) => {
        const chip = chips.get(block.index);
        if (chip) return <ItemChip key={block.index} item={chip} state={stateOf(chip)} focused={isFocused({ kind: 'item', id: chip.id })} />;
        if (block.itemId) return null;
        return <LineBlock key={block.index} index={block.index} html={html[block.index]} pending={isPending(block.index)} onAdd={onAdd} />;
      })}
    </section>
  );
}

/** Highlights `quote` in the nearest prose block before `before`; false when no block has it. */
function quoteNearest(
  html: string[], blocks: Block[], before: number, quote: string | undefined, mark: Parameters<typeof markQuote>[2],
): boolean {
  if (!quote) return false;
  for (let i = before - 1; i >= 0; i--) {
    if (!PROSE.test(blocks[i].innerHtml)) continue;
    const marked = markQuote(html[i], quote, mark);
    if (marked !== null) {
      html[i] = marked;
      return true;
    }
  }
  return false;
}

function ItemChip({ item, state, focused }: { item: ReviewItem; state: MarkState; focused: boolean }) {
  return (
    <div class="mk-row">
      <button
        type="button"
        id={`mk-${item.id}`}
        class={`q q-${item.kind} is-${state} mk-chip${focused ? ' is-focus' : ''}`}
        data-item={item.id}
      >
        {item.label}
        <sup class="q-badge">{BADGE[state](item)}</sup>
      </button>
    </div>
  );
}
