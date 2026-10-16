import { Marked } from 'marked';
import type { Tokens, TokenizerExtension, RendererExtension } from 'marked';
import markedFootnote from 'marked-footnote';
import { decodeHTML } from 'entities';

// Typed shapes for the custom marked extensions defined below. Each extends
// Tokens.Generic (which has a string index signature), so a plain `as`
// narrows from the generic `token` parameter without an `unknown` hop.
interface MathInlineToken extends Tokens.Generic {
  type: 'mathInline';
  text: string;
}
interface MathBlockToken extends Tokens.Generic {
  type: 'mathBlock';
  text: string;
}
interface DocusaurusAdmonitionToken extends Tokens.Generic {
  type: 'docusaurusAdmonition';
  kind: string;
  title: string;
  body: string;
}

function escapeForKatex(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Minimal emoji-shortcode table. Covers the handful a reviewer is likely to drop
// into a plan without pulling in a 50KB emoji dictionary. Unknown shortcodes are
// left intact so a reader can still read them.
const EMOJI_SHORTCODES: Record<string, string> = {
  tada: '🎉', rocket: '🚀', warning: '⚠️', fire: '🔥', sparkles: '✨',
  thinking: '🤔', eyes: '👀', bug: '🐛', wrench: '🔧', hammer: '🔨',
  check: '✅', heavy_check_mark: '✔️', x: '❌', question: '❓', exclamation: '❗',
  thumbsup: '👍', thumbsdown: '👎', clap: '👏', pray: '🙏', ok_hand: '👌',
  heart: '❤️', star: '⭐', zap: '⚡', boom: '💥', 'package': '📦',
  book: '📖', memo: '📝', pencil: '✏️', mag: '🔍', lock: '🔒',
  key: '🔑', gear: '⚙️', arrow_right: '➡️', arrow_left: '⬅️',
};

function replaceEmojiShortcodes(html: string): string {
  return html.replace(/:([a-z0-9_+-]+):/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(EMOJI_SHORTCODES, name) ? EMOJI_SHORTCODES[name] : whole,
  );
}

// Inline math: `$...$` (single-line, non-greedy). Rendered client-side by
// KaTeX — we just wrap the LaTeX in a span. Inline extensions compose
// naturally: the span lands inside whatever paragraph / heading / table cell
// contained the math.
//
// The opening `$` must not be followed by whitespace or a digit, and the
// closing `$` must not be preceded by whitespace. The digit rule keeps
// currency like `$63,334.52-$50,386.55` from being read as math.
const mathInlineExt: TokenizerExtension & RendererExtension = {
  name: 'mathInline',
  level: 'inline',
  start(src: string) {
    const i = src.indexOf('$');
    return i === -1 ? undefined : i;
  },
  tokenizer(src: string) {
    // Let the block tokenizer claim display math first.
    if (src.startsWith('$$')) return undefined;
    const match = /^\$(?![\s\d])([^\n$]+?)(?<!\s)\$/.exec(src);
    if (!match) return undefined;
    return { type: 'mathInline', raw: match[0], text: match[1] };
  },
  renderer(token) {
    return `<span class="math-inline">${escapeForKatex((token as MathInlineToken).text)}</span>`;
  },
};

// Block-level display math: `$$...$$`. This plain variant returns the HTML;
// renderToLineBlocks overrides the renderer to push a top-level LineBlock.
const mathBlockExt: TokenizerExtension & RendererExtension = {
  name: 'mathBlock',
  level: 'block',
  start(src: string) {
    const idx = src.indexOf('$$');
    return idx === -1 ? undefined : idx;
  },
  tokenizer(src: string) {
    const match = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (!match) return undefined;
    return { type: 'mathBlock', raw: match[0], text: match[1].trim() };
  },
  renderer(token) {
    return mathDisplayHtml((token as MathBlockToken).text);
  },
};

function mathDisplayHtml(latex: string): string {
  return `<div class="math-display">${escapeForKatex(latex)}</div>`;
}

export const ITEM_FENCE_RE = /^(?:decision|assumption)\s+id=[^\s]+(?:\s|$)/;

export interface LineBlock {
  index: number;     // 0-based, sequential within the section
  innerHtml: string; // rendered HTML (safe for dangerouslySetInnerHTML)
  text: string;      // plain text (HTML stripped) for lineTexts storage
  itemId?: string;   // set on an item's decision/assumption fence: a marker, not rendered as code
}

// DOM-free textContent: core computes the same block texts in Node (carry-forward)
// as the browser does when rendering, so this must not depend on `document`.
function stripHtml(html: string): string {
  return decodeHTML(html.replace(/<!--[\s\S]*?-->|<\/?[a-z](?:"[^"]*"|'[^']*'|[^'">])*>/gi, '')).replace(/\s+/g, ' ').trim();
}

// A plain Marked instance used only for rendering sub-content (no custom
// block-pushing renderers). Shared across calls — stateless. It still needs
// the math extensions: list items and blockquotes are lexed by the main
// instance, so their tokens can contain mathInline / mathBlock, and marked
// throws on a token type with no renderer.
const _plainMarked = new Marked({ extensions: [mathInlineExt, mathBlockExt] });

// Internal type for the renderer context that marked injects via use().
// Does NOT extend Renderer — that would conflict with _Renderer's stricter parser type.
interface RendererThis {
  parser: {
    parse(tokens: Tokens.Generic[], top?: boolean): string;
    parseInline(tokens: Tokens.Generic[]): string;
  };
}

export function renderToLineBlocks(markdown: string, itemIds: Set<string> = new Set()): LineBlock[] {
  const blocks: LineBlock[] = [];
  const markedItemIds = new Set<string>();
  let i = 0;

  // marked-footnote's `footnotes` renderer recursively calls
  // this.parser.parse(body) for each definition, which hits our custom
  // paragraph renderer and pushes the body into `blocks` as an extra
  // top-level paragraph — so the body shows twice (once as a stray paragraph,
  // once empty inside the <section class="footnotes">). Count the definitions
  // up front so we can pop those polluted blocks off after the parse.
  const footnoteDefCount = (markdown.match(/^\[\^[^\]\n]+\]:/gm) ?? []).length;

  // Top-level display math pushes its own LineBlock, matching the pattern
  // used by the block renderers below.
  const lineMathBlockExt: TokenizerExtension & RendererExtension = {
    ...mathBlockExt,
    renderer(token) {
      const latex = (token as MathBlockToken).text;
      blocks.push({ index: i++, innerHtml: mathDisplayHtml(latex), text: latex });
      return '';
    },
  };

  // Docusaurus-style admonitions: `:::kind [optional title]\n...\n:::`. Match
  // the GFM admonition shape so the existing CSS handles styling. Body
  // markdown is rendered through a plain Marked so it doesn't recurse into our
  // custom paragraph renderer (which would push the body into top-level
  // `blocks` instead of keeping it inside the blockquote).
  const docusaurusAdmExt: TokenizerExtension & RendererExtension = {
    name: 'docusaurusAdmonition',
    level: 'block',
    start(src: string) {
      const idx = src.indexOf(':::');
      return idx === -1 ? undefined : idx;
    },
    tokenizer(src: string) {
      const m = /^:::(note|tip|info|warning|danger|caution|important)\b(?:[ \t]+(.+))?\n([\s\S]*?)\n:::(?=\n|$)/.exec(src);
      if (!m) return undefined;
      return {
        type: 'docusaurusAdmonition',
        raw: m[0],
        kind: m[1].toLowerCase(),
        title: m[2]?.trim() ?? '',
        body: m[3],
      };
    },
    renderer(token) {
      const t = token as DocusaurusAdmonitionToken;
      // Map Docusaurus-only kinds to the closest GFM palette so existing CSS
      // hits: info → note (blue), danger → caution (red).
      const cssKind = t.kind === 'info' ? 'note' : t.kind === 'danger' ? 'caution' : t.kind;
      const title = t.title || (t.kind.charAt(0).toUpperCase() + t.kind.slice(1));
      const bodyHtml = (_plainMarked.parse(t.body) as string).trimEnd();
      const html = `<blockquote class="admonition admonition-${cssKind}"><p class="admonition-title">${title}</p>${bodyHtml}</blockquote>`;
      blocks.push({ index: i++, innerHtml: html, text: `${title}: ${stripHtml(bodyHtml)}` });
      return '';
    },
  };

  const instance = new Marked();
  instance.use(markedFootnote());
  instance.use({ extensions: [mathInlineExt, lineMathBlockExt, docusaurusAdmExt] });
  instance.use({
    renderer: {
      // Regular functions (not arrows) so `this` is the renderer with parser attached.
      paragraph(this: RendererThis, token: Tokens.Paragraph): string {
        const inner = this.parser.parseInline(token.tokens as Tokens.Generic[]);
        const html = replaceEmojiShortcodes(`<p>${inner}</p>`);
        blocks.push({ index: i++, innerHtml: html, text: stripHtml(html) });
        return '';
      },

      // Top-level list: push one LineBlock per outer item so each item is
      // individually commentable. Nested sub-lists and paragraphs INSIDE an
      // item are rendered through a plain marked instance so they stay as
      // nested HTML within the parent <li>.
      //
      // Each top-level item becomes its own <ol>/<ul> wrapper. For ordered
      // lists we set `start` on each wrapper so "1. / 2. / 3." keeps rising
      // across separate LineBlocks instead of every item restarting at 1.
      // Presentation (padding, bullet style) is in CSS — nested lists need
      // their own padding-left to stay indented and the `* { padding: 0 }`
      // reset would otherwise kill browser defaults.
      list(token: Tokens.List): string {
        const tag = token.ordered ? 'ol' : 'ul';
        const baseStart = typeof token.start === 'number' ? token.start : 1;
        for (let idx = 0; idx < token.items.length; idx++) {
          const item = token.items[idx];
          const inner = _plainMarked.parser(item.tokens as Tokens.Generic[]).trimEnd();
          // GFM task-list checkbox. marked sets `task: true` and `checked` on the item.
          const checkbox = item.task
            ? `<input type="checkbox" disabled${item.checked ? ' checked' : ''}> `
            : '';
          const li = `<li${item.task ? ' class="task-list-item"' : ''}>${checkbox}${inner}</li>`;
          const wrapped = token.ordered
            ? `<ol start="${baseStart + idx}">${li}</ol>`
            : `<${tag}>${li}</${tag}>`;
          blocks.push({ index: i++, innerHtml: replaceEmojiShortcodes(wrapped), text: stripHtml(li) });
        }
        return '';
      },

      code(token: Tokens.Code): string {
        const lang = token.lang ?? '';
        // Only an item's first fence is its marker; a repeat of the id is a
        // malformed duplicate and renders as an ordinary code block.
        const itemId = ITEM_FENCE_RE.test(lang) ? /id=([^\s]+)/.exec(lang)?.[1] : undefined;
        if (itemId && itemIds.has(itemId) && !markedItemIds.has(itemId)) {
          markedItemIds.add(itemId);
          blocks.push({ index: i++, innerHtml: '', text: '', itemId });
          return '';
        }

        const escapedCode = token.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

        // Mermaid fences: emit a <pre class="mermaid"> that the mermaid runtime will
        // replace with an SVG after the page mounts. We keep the raw source as the
        // block's text so the comment anchor still maps to the diagram source.
        if (lang === 'mermaid') {
          const html = `<pre class="mermaid">${escapedCode}</pre>`;
          blocks.push({ index: i++, innerHtml: html, text: token.text.trim() });
          return '';
        }

        const html = lang
          ? `<pre><code class="language-${lang}">${escapedCode}</code></pre>`
          : `<pre><code>${escapedCode}</code></pre>`;
        blocks.push({ index: i++, innerHtml: html, text: token.text.trim() });
        return '';
      },

      blockquote(token: Tokens.Blockquote): string {
        // Re-render the inner tokens using a plain Marked instance so we don't
        // push nested blocks; the entire blockquote is a single LineBlock.
        const innerHtml = _plainMarked.parser(token.tokens as Tokens.Generic[]);

        // GFM admonitions: a blockquote whose first line is [!NOTE] / [!TIP] /
        // [!IMPORTANT] / [!WARNING] / [!CAUTION] gets chrome with a labelled title.
        const admMatch = /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(innerHtml.slice(0, 200));
        if (admMatch) {
          const kind = admMatch[1].toLowerCase();
          const title = kind.charAt(0).toUpperCase() + kind.slice(1);
          const stripped = innerHtml.replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '');
          const html = `<blockquote class="admonition admonition-${kind}"><p class="admonition-title">${title}</p>${stripped}</blockquote>`;
          blocks.push({ index: i++, innerHtml: html, text: `${title}: ${stripHtml(stripped)}` });
          return '';
        }

        const html = `<blockquote>${innerHtml}</blockquote>`.trimEnd();
        blocks.push({ index: i++, innerHtml: html, text: stripHtml(html) });
        return '';
      },

      // Horizontal rules — default marked renderer returns '<hr>' but we never
      // capture returned HTML, so without an override they'd silently vanish.
      hr(): string {
        blocks.push({ index: i++, innerHtml: '<hr>', text: '---' });
        return '';
      },

      // Marked routes BOTH block-level HTML (<details>, <pre>, custom tags on
      // their own line) and INLINE HTML tags (<kbd>, <sub>, <sup>) through the
      // same `html` renderer. Block HTML tokens have a `pre` marker; inline
      // ones don't. For block HTML we emit its own LineBlock; for inline HTML
      // we return the raw text so it stays inside its containing paragraph.
      html(token: Tokens.HTML | Tokens.Tag): string {
        if ('pre' in token) {
          const raw = token.text;
          blocks.push({ index: i++, innerHtml: raw, text: stripHtml(raw) });
          return '';
        }
        return token.text;
      },

      // Inline image: rewrite relative `src` to `/_assets/<rel>` so the server
      // can serve the file from the plan's directory. Absolute URLs (http:,
      // https:, data:, etc.) and root-relative paths (`/foo`) pass through.
      image(token: Tokens.Image): string {
        let href = token.href ?? '';
        const isAbsoluteScheme = /^[a-z][a-z0-9+.-]*:/i.test(href);
        const isRootRelative = href.startsWith('/') || href.startsWith('#');
        if (href && !isAbsoluteScheme && !isRootRelative) {
          href = '/_assets/' + href.split('/').map(encodeURIComponent).join('/');
        }
        const escAttr = (s: string): string =>
          s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const altAttr = ` alt="${escAttr(token.text ?? '')}"`;
        const titleAttr = token.title ? ` title="${escAttr(token.title)}"` : '';
        return `<img src="${escAttr(href)}"${altAttr}${titleAttr}>`;
      },

      heading(this: RendererThis, token: Tokens.Heading): string {
        const inner = this.parser.parseInline(token.tokens as Tokens.Generic[]);
        const html = replaceEmojiShortcodes(`<h${token.depth}>${inner}</h${token.depth}>`);
        blocks.push({ index: i++, innerHtml: html, text: stripHtml(html) });
        return '';
      },

      table(this: RendererThis, token: Tokens.Table): string {
        // Build <thead>
        const thCells = token.header.map((cell) => {
          const align = cell.align ? ` align="${cell.align}"` : '';
          const inner = this.parser.parseInline(cell.tokens as Tokens.Generic[]);
          return `<th${align}>${inner}</th>`;
        });
        const thead = `<thead><tr>${thCells.join('')}</tr></thead>`;

        // Build <tbody>
        const bodyRows = token.rows.map((row) => {
          const cells = row.map((cell) => {
            const align = cell.align ? ` align="${cell.align}"` : '';
            const inner = this.parser.parseInline(cell.tokens as Tokens.Generic[]);
            return `<td${align}>${inner}</td>`;
          });
          return `<tr>${cells.join('')}</tr>`;
        });
        const tbody = `<tbody>${bodyRows.join('')}</tbody>`;

        const html = `<table>${thead}${tbody}</table>`;

        // Build plain-text version: "Header1 | Header2\nVal1 | Val2"
        const headerText = token.header.map((c) => c.text).join(' | ');
        const rowTexts = token.rows.map((row) => row.map((c) => c.text).join(' | '));
        const plainText = [headerText, ...rowTexts].join('\n');

        blocks.push({ index: i++, innerHtml: html, text: plainText });
        return '';
      },
    },
  });

  instance.parse(markdown);

  // Pop the footnote-body paragraphs the `footnotes` renderer recursively
  // pushed into us. The parsed output still contains a <section
  // class="footnotes"> but its <li>s have empty bodies (our paragraph renderer
  // returned '' from each recursive parse), so we re-run through a plain
  // Marked just for the section HTML and append that as the final LineBlock.
  for (let k = 0; k < footnoteDefCount; k++) blocks.pop();
  if (footnoteDefCount > 0) {
    const plain = new Marked();
    plain.use(markedFootnote());
    const plainOutput = plain.parse(markdown) as string;
    const sectionMatch = /<section class="footnotes"[\s\S]*?<\/section>/.exec(plainOutput);
    if (sectionMatch) {
      blocks.push({ index: i++, innerHtml: sectionMatch[0], text: stripHtml(sectionMatch[0]) });
    }
  }
  return mergeOpenHtmlSpans(blocks);
}

const squashSpace = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Consecutive blocks whose texts equal `lineTexts`, ignoring whitespace only.
 * Prefer a matching stored range, then the nearest match to its start; without
 * a hint, return the first match. Punctuation, case and Unicode all count.
 */
export function findLineRun(
  blocks: readonly LineBlock[], lineTexts: readonly string[],
  hint?: { startLine: number; endLine: number },
): { start: number; end: number } | null {
  const wanted = lineTexts.map(squashSpace);
  if (wanted.length === 0) return null;
  const matches = (start: number) => Number.isInteger(start) && start >= 0
    && start + wanted.length <= blocks.length
    && wanted.every((text, k) => squashSpace(blocks[start + k].text) === text);
  if (hint && hint.endLine === hint.startLine + wanted.length - 1 && matches(hint.startLine)) {
    return { start: hint.startLine, end: hint.endLine };
  }
  let nearest: { start: number; end: number } | null = null;
  for (let start = 0; start + wanted.length <= blocks.length; start++) {
    if (matches(start)) {
      if (!hint) return { start, end: start + wanted.length - 1 };
      if (!nearest || Math.abs(start - hint.startLine) < Math.abs(nearest.start - hint.startLine)) {
        nearest = { start, end: start + wanted.length - 1 };
      }
    }
  }
  return nearest;
}

// `<details>` (and similar block HTML wrappers) opened on one line and closed
// after a blank line tokenize into separate marked blocks — each becomes its
// own LineBlock and the body escapes the wrapper. Walk the block stream after
// parsing and merge any block whose <details> tags don't balance with the
// blocks that follow until the closer arrives.
function mergeOpenHtmlSpans(blocks: LineBlock[]): LineBlock[] {
  const countTags = (html: string, tag: string): { open: number; close: number } => ({
    open: (html.match(new RegExp(`<${tag}\\b`, 'gi')) ?? []).length,
    close: (html.match(new RegExp(`</${tag}>`, 'gi')) ?? []).length,
  });
  const result: LineBlock[] = [];
  let k = 0;
  while (k < blocks.length) {
    const block = blocks[k];
    const { open, close } = countTags(block.innerHtml, 'details');
    if (open <= close) {
      result.push({ ...block, index: result.length });
      k++;
      continue;
    }
    let mergedHtml = block.innerHtml;
    let mergedText = block.text;
    let depth = open - close;
    let j = k + 1;
    while (j < blocks.length && depth > 0) {
      const next = blocks[j];
      mergedHtml += next.innerHtml;
      mergedText += '\n' + next.text;
      const c = countTags(next.innerHtml, 'details');
      depth += c.open - c.close;
      j++;
    }
    result.push({ index: result.length, innerHtml: mergedHtml, text: mergedText });
    k = j;
  }
  return result;
}
