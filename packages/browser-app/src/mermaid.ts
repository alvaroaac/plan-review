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

export interface BranchEdge {
  from: string;
  to: string;
  branch: 'yes' | 'no' | null;
  label: string;
}

const YES_RE = /^(?:yes|true|ok|success|pass|1)$/i;
const NO_RE  = /^(?:no|false|fail|error|reject|0)$/i;

export function parseBranchLabels(source: string): BranchEdge[] {
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:-->|---|==>|-\.->)\s*\|([^|]+)\|\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  const out: BranchEdge[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const label = m[2].trim();
    const branch = YES_RE.test(label) ? 'yes' : NO_RE.test(label) ? 'no' : null;
    out.push({ from: m[1], to: m[3], branch, label });
  }
  return out;
}

// Walk each <g class="node"> in the rendered SVG and set data-role.
// Mermaid emits ids like "flowchart-NodeId-0" or "graph_NodeId_1" — the
// regex (^|-)NodeId(-|$) extracts the source id. If no detected role
// matches, fall back to shape: polygon = decision, anything else = process.
// Every node leaves this function with a data-role attribute.
export function applyRoles(svg: SVGElement, roles: Record<string, MermaidRole>): void {
  const keys = Object.keys(roles);
  for (const g of svg.querySelectorAll('g.node')) {
    const id = g.id ?? '';
    let matched: string | null = null;
    for (const k of keys) {
      if (new RegExp(`(^|[-_])${k}([-_]|$)`).test(id)) { matched = k; break; }
    }
    if (matched) {
      g.setAttribute('data-role', roles[matched]);
    } else {
      g.setAttribute('data-role', g.querySelector('polygon') ? 'decision' : 'process');
    }
  }
}

// Add edge-yes / edge-no classes to the rendered SVG path + matching
// edge-label <g>. Mermaid edge ids come in two forms depending on version:
// "L_From_To_0" (underscore) and "L-From-To-0" (dash). Query both.
// Label matching is by exact text content (lowercased), fragile but
// the only path — a non-match just leaves the label uncolored.
export function applyBranchEdges(svg: SVGElement, branches: BranchEdge[]): void {
  for (const b of branches) {
    if (!b.branch) continue;
    const cls = `edge-${b.branch}`;
    const labelCls = `edge-${b.branch}-label`;

    // Path + any ancestor <g> wrapper: cover both forms of mermaid ids.
    const sel = `[id*="_${b.from}_${b.to}_"], [id*="-${b.from}-${b.to}-"]`;
    for (const el of svg.querySelectorAll(sel)) {
      el.classList.add(cls);
    }

    const wantText = b.label.trim().toLowerCase();
    for (const lbl of svg.querySelectorAll('g.edgeLabel, .edgeLabel')) {
      const txt = (lbl.textContent ?? '').trim().toLowerCase();
      if (txt === wantText) lbl.classList.add(labelCls);
    }
  }
}

// Sequence diagrams: tag each actor rect + lifeline with data-actor-idx.
// Mermaid renders two rect.actor per participant (top and bottom frame);
// we dedupe by rounded x-coordinate so the same participant gets the same
// index on both boxes. Index wraps at 6 to match the palette size.
export function applyActorIndices(svg: SVGElement): void {
  const xToIdx = new Map<number, number>();
  let next = 0;
  for (const r of svg.querySelectorAll('rect.actor')) {
    const x = Math.round(parseFloat(r.getAttribute('x') ?? '0'));
    if (!xToIdx.has(x)) xToIdx.set(x, next++);
    const idx = (xToIdx.get(x) as number) % 6;
    r.setAttribute('data-actor-idx', String(idx));
    const parent = r.parentElement;
    if (parent && parent.classList.contains('actor')) {
      parent.setAttribute('data-actor-idx', String(idx));
    }
  }
  const lines = svg.querySelectorAll('line.actor-line');
  lines.forEach((l, i) => l.setAttribute('data-actor-idx', String(i % 6)));
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
  const nodes = root.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed])');
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

  // Process blocks concurrently. Sequential `await mermaid.run` of one block
  // at a time lets a slow first diagram starve later ones for seconds — long
  // enough that a test asserting on a later diagram's DOM right after the
  // first SVG appears sees an un-rendered <pre>. We capture each source
  // before mermaid mutates the DOM (mermaid.run replaces <pre> content with
  // <svg>), then let all runs proceed in parallel. A single parse error must
  // not prevent other blocks from rendering, so each run is wrapped.
  await Promise.all(
    Array.from(nodes).map(async (pre) => {
      const source = pre.textContent ?? '';
      const roles = detectRoles(source);
      const branches = parseBranchLabels(source);

      try {
        await mermaid.run({ nodes: [pre] });
      } catch {
        return; // mermaid parse error on this block; move on
      }

      const svg = pre.querySelector('svg');
      if (!svg) return;
      applyRoles(svg as unknown as SVGElement, roles);
      applyBranchEdges(svg as unknown as SVGElement, branches);
      applyActorIndices(svg as unknown as SVGElement);
    }),
  );
}
