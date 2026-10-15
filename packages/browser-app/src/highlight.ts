// Wraps text inside a block's rendered HTML in highlight spans. Works on the
// DOM so a quote can span inline formatting (`<strong>`, `<code>`, links):
// each text node the match touches gets its own span.

export interface Mark {
  id: string;                    // element id on the first span (scroll target)
  className: string;
  data: Record<string, string>;  // data-* attributes on every span (click targets)
  badge?: string;                // trailing <sup class="q-badge"> on the last span
}

// Rendered later by KaTeX / mermaid, or our own badges: never split these.
const SKIP = '.math-inline, .math-display, pre.mermaid, .q-badge';

/** Wraps the first occurrence of `quote` (case-sensitive, whitespace-insensitive), or returns null. */
export function markQuote(html: string, quote: string, mark: Mark): string | null {
  const root = parse(html);
  const chars: { node: Text; offset: number }[] = [];
  let flat = '';
  for (const node of textNodes(root)) {
    for (let offset = 0; offset < node.data.length; offset++) {
      const space = /\s/.test(node.data[offset]);
      if (space && (flat === '' || flat.endsWith(' '))) continue;
      flat += space ? ' ' : node.data[offset];
      chars.push({ node, offset });
    }
  }
  const needle = quote.replace(/\s+/g, ' ').trim();
  const at = needle ? flat.indexOf(needle) : -1;
  if (at < 0) return null;

  const first = chars[at];
  const last = chars[at + needle.length - 1];
  const nodes = textNodes(root);
  const segments = nodes
    .slice(nodes.indexOf(first.node), nodes.indexOf(last.node) + 1)
    .map((node) => ({
      node,
      start: node === first.node ? first.offset : 0,
      end: node === last.node ? last.offset + 1 : node.data.length,
    }));
  wrap(segments, mark);
  return root.innerHTML;
}

/**
 * Wraps all text in the block. A block with no wrappable text (a diagram,
 * display math) is wrapped whole in a block-level highlight instead.
 */
export function markAll(html: string, mark: Mark): string {
  const root = parse(html);
  const segments = textNodes(root)
    .filter((node) => node.data.trim() !== '')
    .map((node) => ({ node, start: 0, end: node.data.length }));
  if (segments.length > 0) {
    wrap(segments, mark);
    return root.innerHTML;
  }
  const block = decorate(document.createElement('div'), mark);
  block.id = mark.id;
  block.classList.add('hl-block');
  block.innerHTML = html;
  return block.outerHTML;
}

function parse(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest(SKIP)) nodes.push(node as Text);
  }
  return nodes;
}

function wrap(segments: { node: Text; start: number; end: number }[], mark: Mark): void {
  const spans = segments
    .filter(({ start, end }) => end > start)
    .map(({ node, start, end }) => {
      const target = start > 0 ? node.splitText(start) : node;
      if (end - start < target.data.length) target.splitText(end - start);
      const span = decorate(document.createElement('span'), mark);
      target.replaceWith(span);
      span.append(target);
      return span;
    });
  spans[0].id = mark.id;
  if (mark.badge !== undefined) {
    const badge = document.createElement('sup');
    badge.className = 'q-badge';
    badge.textContent = mark.badge;
    spans[spans.length - 1].append(badge);
  }
}

function decorate<T extends HTMLElement>(el: T, mark: Mark): T {
  el.className = mark.className;
  for (const [key, value] of Object.entries(mark.data)) el.dataset[key] = value;
  return el;
}
