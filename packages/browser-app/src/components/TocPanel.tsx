import type { Section } from '@plan-review/core';
import { itemState } from '@plan-review/core/review';
import { useReview } from '../state/ReviewContext.js';
import { scrollDocTo, sectionElementId } from '../scroll.js';
import { sectionNumbers } from '../sections.js';
import { ChatIcon } from './icons.js';

export function TocPanel({ active }: { active: string | null }) {
  const { state } = useReview();
  const { sections } = state.doc;
  const numbers = sectionNumbers(sections);

  // Plan tasks nest under their milestone; generic sections stay flat.
  const top = sections.filter((s) => !s.parent);
  const tasksOf = (s: Section) => sections.filter((t) => t.parent === s.id);

  const row = (s: Section) => <TocRow section={s} num={numbers.get(s.id)!} active={active === s.id} />;

  return (
    <nav class="index" aria-label="Contents">
      <div class="idx-h">Contents</div>
      {top.map((s) => {
        const tasks = tasksOf(s);
        return (
          <div key={s.id} class="idx-sec">
            {row(s)}
            {tasks.length > 0 && (
              <div class="idx-tasks">
                {tasks.map((t) => <div key={t.id} class="idx-sec">{row(t)}</div>)}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function TocRow({ section, num, active }: { section: Section; num: string; active: boolean }) {
  const { state } = useReview();
  const { items, review } = state;
  const sectionItems = items.filter((i) => i.sectionId === section.id);
  const openThreads = review.threads.filter((t) => t.sectionId === section.id && !t.resolved).length;

  return (
    <button
      type="button"
      class={active ? 'idx-row on' : 'idx-row'}
      onClick={() => scrollDocTo(sectionElementId(section.id), 40)}
    >
      <span class="idx-num">{num}</span>
      <span class="idx-t">{section.heading}</span>
      <span class="idx-meta">
        {sectionItems.length > 0 && (
          <span class="idx-dots">
            {sectionItems.map((i) => (
              <i key={i.id} class={`idx-dot k-${i.kind} ${itemState(i, review.answers[i.id])}`} />
            ))}
          </span>
        )}
        {openThreads > 0 && <span class="idx-cmt"><ChatIcon />{openThreads}</span>}
      </span>
    </button>
  );
}
