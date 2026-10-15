import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

// The document column is the only scroller that holds section and marker ids.
const DOC_SCROLLER = '.main > .scroll';

/** Element id of a section heading in the document. */
export const sectionElementId = (sectionId: string): string => `sec-${sectionId}`;

/** Smooth-scrolls the document so the element with `id` sits `offset` px below the top. */
export function scrollDocTo(id: string, offset: number): void {
  const el = document.getElementById(id);
  const container = el?.closest<HTMLElement>(DOC_SCROLLER);
  if (!el || !container) return;
  const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - offset;
  container.scrollTo({ top, behavior: 'smooth' });
}

/**
 * Scroll-spy: the active section is the last one whose heading is within 160 px
 * of the container top, or the last section once the container is scrolled to the end.
 */
export function useScrollSpy(ref: RefObject<HTMLElement>, sectionIds: string[]): string | null {
  const [active, setActive] = useState<string | null>(sectionIds[0] ?? null);
  const key = sectionIds.join('\n');

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const onScroll = () => {
      const top = container.getBoundingClientRect().top;
      let current = sectionIds[0] ?? null;
      for (const id of sectionIds) {
        const el = document.getElementById(sectionElementId(id));
        if (el && el.getBoundingClientRect().top - top < 160) current = id;
      }
      const scrollable = container.scrollHeight > container.clientHeight;
      if (scrollable && container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
        current = sectionIds[sectionIds.length - 1];
      }
      setActive(current);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [ref, key]); // `key` stands in for `sectionIds`, a new array on every render

  return active;
}
