import { Marked } from 'marked';
import type { Tokens } from 'marked';

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

  const instance = new Marked();
  instance.use({
    renderer: {
      // Regular functions (not arrows) so `this` is the renderer with parser attached.
      paragraph(this: RendererThis, token: Tokens.Paragraph): string {
        const inner = this.parser.parseInline(token.tokens as Tokens.Generic[]);
        const html = `<p>${inner}</p>`;
        blocks.push({ index: i++, innerHtml: html, text: stripHtml(html) });
        return '';
      },

      // Override list to iterate items directly and push one block per item.
      // listitem is NOT overridden to avoid conflict.
      list(this: RendererThis, token: Tokens.List): string {
        const tag = token.ordered ? 'ol' : 'ul';
        const style = token.ordered ? 'list-style:decimal' : 'list-style:disc';
        for (const item of token.items) {
          const inner = this.parser.parse(item.tokens as Tokens.Generic[], !!item.loose);
          const html = `<li>${inner.trimEnd()}</li>`;
          const wrapped = `<${tag} style="${style};padding-left:1.5em">${html}</${tag}>`;
          blocks.push({ index: i++, innerHtml: wrapped, text: stripHtml(html) });
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
        const html = `<blockquote>${innerHtml}</blockquote>`.trimEnd();
        blocks.push({ index: i++, innerHtml: html, text: stripHtml(html) });
        return '';
      },

      heading(this: RendererThis, token: Tokens.Heading): string {
        const inner = this.parser.parseInline(token.tokens as Tokens.Generic[]);
        const html = `<h${token.depth}>${inner}</h${token.depth}>`;
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
  return blocks;
}
