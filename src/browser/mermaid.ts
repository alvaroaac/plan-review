// Lazy loader + runner for mermaid.
// We fetch mermaid from a CDN via a dynamic <script type="module"> tag so the
// ~700KB library only ships to users whose plan actually contains a mermaid
// fence. The CDN request is fire-and-forget — if it fails (offline, CSP), the
// unchanged <pre class="mermaid"> source remains visible as plain text.

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

interface MermaidLike {
  initialize: (opts: Record<string, unknown>) => void;
  run: (opts: { nodes?: NodeListOf<Element> | Element[]; querySelector?: string }) => Promise<void>;
}

export type MermaidRole = 'start' | 'process' | 'decision' | 'end' | 'error' | 'io';

// Regex rules matched first-wins. `decision` must come first because the
// brace-shape test doesn't care about the label content, and we don't want
// a "fail" inside a decision label to mis-map as an error node.
const ROLE_RULES: Array<{ role: MermaidRole; re: RegExp }> = [
  // Decision: NodeId{label} or NodeId{{label}}
  { role: 'decision', re: /\b([A-Za-z_][A-Za-z0-9_]*)\s*\{\{?[^}]+\}\}?/g },
  // Start/end circle: NodeId((start|begin|init))  /  ((end|done|finish|complete))
  { role: 'start',    re: /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(\(\s*(?:start|begin|init)[^)]*\)\)/gi },
  { role: 'end',      re: /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(\(\s*(?:end|done|finish|complete)[^)]*\)\)/gi },
  // Start/end stadium: NodeId([start|begin])  /  ([end|done|finish])
  { role: 'start',    re: /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(\[\s*(?:start|begin)[^\]]*\]\)/gi },
  { role: 'end',      re: /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(\[\s*(?:end|done|finish)[^\]]*\]\)/gi },
  // Error: NodeId[... error | fail | abort | reject | invalid ...]
  { role: 'error',    re: /\b([A-Za-z_][A-Za-z0-9_]*)\s*\[[^\]]*\b(?:error|fail|abort|reject|invalid)[^\]]*\]/gi },
  // I/O: NodeId[/label/] or NodeId[\label\]
  { role: 'io',       re: /\b([A-Za-z_][A-Za-z0-9_]*)\s*\[[/\\][^\]]+[/\\]\]/g },
];

export function detectRoles(source: string): Record<string, MermaidRole> {
  const roles: Record<string, MermaidRole> = {};
  for (const { role, re } of ROLE_RULES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (!roles[m[1]]) roles[m[1]] = role;
    }
  }
  return roles;
}

let loadPromise: Promise<MermaidLike> | null = null;

function loadMermaid(): Promise<MermaidLike> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<MermaidLike>((resolve, reject) => {
    const win = window as unknown as { __mermaid?: MermaidLike };
    if (win.__mermaid) {
      resolve(win.__mermaid);
      return;
    }

    // Unique event so multiple calls don't collide with unrelated listeners.
    const eventName = 'plan-review:mermaid-loaded';
    const onLoaded = (): void => {
      if (win.__mermaid) resolve(win.__mermaid);
      else reject(new Error('mermaid module missing after load'));
    };
    window.addEventListener(eventName, onLoaded, { once: true });

    const script = document.createElement('script');
    script.type = 'module';
    // Import as a module, stash on window, signal via custom event.
    script.textContent = `
      import mermaid from '${MERMAID_CDN}';
      window.__mermaid = mermaid;
      window.dispatchEvent(new Event('${eventName}'));
    `;
    script.onerror = () => reject(new Error('mermaid script tag error'));
    document.head.appendChild(script);
  });

  // Reset on failure so a later retry (e.g. after connectivity returns) can try again.
  loadPromise.catch(() => {
    loadPromise = null;
  });

  return loadPromise;
}

// Render any un-processed <pre class="mermaid"> blocks currently in the DOM.
// Safe to call many times — already-rendered blocks are skipped by mermaid itself.
export async function renderMermaidBlocks(root: ParentNode = document): Promise<void> {
  const nodes = root.querySelectorAll('pre.mermaid:not([data-processed])');
  if (nodes.length === 0) return;

  let mermaid: MermaidLike;
  try {
    mermaid = await loadMermaid();
  } catch {
    // Offline / CSP blocks the CDN — leave raw source visible.
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    fontFamily: 'inherit',
  });

  try {
    await mermaid.run({ nodes: Array.from(nodes) });
  } catch {
    // A syntax error in a single diagram shouldn't break the rest of the page.
  }
}
