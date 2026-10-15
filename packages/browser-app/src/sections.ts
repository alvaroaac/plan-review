import type { Section } from '@plan-review/core';

/**
 * Display number per section id: plan tasks keep their own id ("1.2"); every
 * other section is numbered in order, zero-padded like the design ("01").
 */
export function sectionNumbers(sections: Section[]): Map<string, string> {
  const numbers = new Map<string, string>();
  let n = 0;
  for (const section of sections) {
    numbers.set(section.id, section.parent ? section.id : String(++n).padStart(2, '0'));
  }
  return numbers;
}
