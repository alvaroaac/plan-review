import { Marked } from 'marked';
import type { Tokens, TokenizerExtension, RendererExtension } from 'marked';
import markedFootnote from 'marked-footnote';

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

// Inline math: `$...$` (single-line, non-greedy, no leading/trailing whitespace).
// Rendered client-side by KaTeX — we just wrap the LaTeX in a span. Inline
// extensions compose naturally: the span lands inside whatever paragraph /
// heading / table cell contained the math.
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
    const match = /^\$(?!\s)([^\n$]+?)(?<!\s)\$/.exec(src);
    if (!match) return undefined;
    return { type: 'mathInline', raw: match[0], text: match[1] };
  },
  renderer(token) {
    return `<span class="math-inline">${escapeForKatex((token as unknown as { text: string }).text)}</span>`;
  },
};

export interface LineBlock {
  index: number;     // 0-based, sequential within the section
  innerHtml: string; // rendered HTML (safe for dangerouslySetInnerHTML)
  text: string;      // plain text (HTML stripped) for lineTexts storage
}

function stripHtml(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// A plain Marked instance used only for rendering sub-content (no custom renderer).
// Shared across calls — stateless.
const _plainMarked = new Marked();

// Internal type for the renderer context that marked injects via use().
// Does NOT extend Renderer — that would conflict with _Renderer's stricter parser type.
interface RendererThis {
  parser: {
    parse(tokens: Tokens.Generic[], top?: boolean): string;
    parseInline(tokens: Tokens.Generic[]): string;
  };
}

export function renderToLineBlocks(markdown: string): LineBlock[] {
  const blocks: LineBlock[] = [];
  let i = 0;

  // marked-footnote's `footnotes` renderer recursively calls
  // this.parser.parse(body) for each definition, which hits our custom
  // paragraph renderer and pushes the body into `blocks` as an extra
  // top-level paragraph — so the body shows twice (once as a stray paragraph,
  // once empty inside the <section class="footnotes">). Count the definitions
  // up front so we can pop those polluted blocks off after the parse.
  const footnoteDefCount = (markdown.match(/^\[\^[^\]\n]+\]:/gm) ?? []).length;

  // Block-level display math. Defined inside the closure so it can push a
  // LineBlock directly, matching the pattern used by the block renderers below.
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
      const latex = (token as unknown as { text: string }).text;
      const html = `<div class="math-display">${escapeForKatex(latex)}</div>`;
      blocks.push({ index: i++, innerHtml: html, text: latex });
      return '';
    },
  };

  const instance = new Marked();
  instance.use(markedFootnote());
  instance.use({ extensions: [mathInlineExt, mathBlockExt] });
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
  return blocks;
}
