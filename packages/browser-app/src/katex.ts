// Lazy loader + renderer for KaTeX.
// Same pattern as mermaid.ts: inject a <script type="module"> pulling KaTeX
// from a CDN only if the page actually contains math markup. Adds the KaTeX
// stylesheet only once and on first use.

const KATEX_JS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.mjs';
const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';

interface KatexLike {
  render: (latex: string, element: HTMLElement, options?: Record<string, unknown>) => void;
}

// The loader stashes the imported ESM module on `window.__katex` so the
// resolver in loadKatex() can read it back. Declare the shape here instead
// of casting window at every access.
declare global {
  interface Window {
    __katex?: KatexLike;
  }
}

let loadPromise: Promise<KatexLike> | null = null;

function ensureStylesheet(): void {
  if (document.querySelector(`link[data-plan-review-katex]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = KATEX_CSS;
  link.setAttribute('data-plan-review-katex', '1');
  document.head.appendChild(link);
}

function loadKatex(): Promise<KatexLike> {
  if (loadPromise) return loadPromise;

  ensureStylesheet();

  loadPromise = new Promise<KatexLike>((resolve, reject) => {
    if (window.__katex) {
      resolve(window.__katex);
      return;
    }

    const eventName = 'plan-review:katex-loaded';
    const onLoaded = (): void => {
      if (window.__katex) resolve(window.__katex);
      else reject(new Error('katex module missing after load'));
    };
    window.addEventListener(eventName, onLoaded, { once: true });

    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import katex from '${KATEX_JS}';
      window.__katex = katex;
      window.dispatchEvent(new Event('${eventName}'));
    `;
    script.onerror = () => reject(new Error('katex script tag error'));
    document.head.appendChild(script);
  });

  loadPromise.catch(() => { loadPromise = null; });

  return loadPromise;
}

// Render any un-processed .math-inline / .math-display spans currently in the DOM.
// Each element's textContent is the raw LaTeX; we overwrite it with KaTeX output.
export async function renderMathBlocks(root: ParentNode = document): Promise<void> {
  const nodes = root.querySelectorAll<HTMLElement>(
    '.math-inline:not([data-processed]), .math-display:not([data-processed])',
  );
  if (nodes.length === 0) return;

  let katex: KatexLike;
  try {
    katex = await loadKatex();
  } catch {
    return; // offline / CSP — raw LaTeX remains visible
  }

  for (const el of Array.from(nodes)) {
    const latex = (el.textContent ?? '').trim();
    const displayMode = el.classList.contains('math-display');
    try {
      katex.render(latex, el, { displayMode, throwOnError: false });
      el.setAttribute('data-processed', 'true');
    } catch {
      // leave the raw source in place for this one; keep going.
    }
  }
}
