# Mermaid diagram coloring — design

**Date:** 2026-04-18
**Status:** Draft
**Closes tech-debt:** "Mermaid per-node / per-participant hardcoded colors"

## Goal

Color-code mermaid diagrams so readers can scan a flowchart or sequence diagram and parse structure at a glance:

- Flowchart nodes colored by role (start/process/decision/end/error/io).
- Flowchart decision branches colored by outcome (yes/no).
- Sequence participants each colored distinctly.

No new UI chrome, no toolbar, no node-level comments. Chrome/toolbar/fullscreen/click-to-comment are captured separately in tech debt.

## Non-goals

- Interactive toolbar (zoom, source toggle, copy, download, fullscreen).
- Click-to-comment on individual nodes.
- User-facing palette picker UI.
- Light-mode theme variant.

All of the above are tracked as tech-debt items added in this session.

## Approach

Approach 1 from brainstorm: **CSS overlay + regex source inference.**

- Parse mermaid source with regex before `mermaid.run` to detect node roles and branch edge labels.
- Let mermaid render normally.
- Post-render, walk the SVG and tag `<g class="node">` with `data-role="..."`, tag edges with `edge-yes`/`edge-no` classes, tag sequence actors with `data-actor-idx="0"..."5"`.
- All color styling lives in CSS attribute/class selectors.

User flagged a reservation with this approach (regex brittleness, fighting mermaid's injected styles). Mitigation: shape-based fallback guarantees every node gets a role; unit tests cover mermaid syntax variants; any node the regex misses still renders, just with the default "process" role instead of unstyled.

Alternative approaches considered and rejected:

- **Native `classDef` + `themeVariables`** (approach 2): rides mermaid's supported API but needs the same source regex up front, and `themeVariables` can't express six per-actor colors — sequences would need post-SVG CSS anyway.
- **Hybrid** (approach 3): classDef for flowcharts, post-SVG for sequences. Two codepaths, complexity exceeds the wins.

## Architecture

Single-file extension of `src/browser/mermaid.ts`. No new module, no Preact component rewrite, no change to the public render surface. Callers still invoke `renderMermaidBlocks()`; `<pre class="mermaid">` blocks still swap to SVG in place.

New helpers inside `mermaid.ts`:

- `detectRoles(source: string): Record<string, Role>`
- `parseBranchLabels(source: string): BranchEdge[]`
- `applyRoles(svg: SVGElement, roles: Record<string, Role>): void`
- `applyBranchEdges(svg: SVGElement, branches: BranchEdge[]): void`
- `applyActorIndices(svg: SVGElement): void`

CSS additions live in `src/browser/styles.css` under a new "Mermaid coloring" section.

## Role detection

Regex rules applied to source, first-match-wins ordering:

| Role       | Pattern                                              | Example               |
| ---------- | ---------------------------------------------------- | --------------------- |
| `decision` | `NodeId{...}` or `NodeId{{...}}`                     | `CheckToken{Valid?}`  |
| `start`    | `NodeId([Start...])` / `NodeId((begin...))`          | `Begin([Start])`      |
| `end`      | `NodeId([End...])` / `NodeId((done...))`             | `Done((End))`         |
| `error`    | `NodeId[...fail/error/abort/reject/invalid...]`      | `Fail[Auth error]`    |
| `io`       | `NodeId[/...\]` or `NodeId[\...\]`                   | `Input[/user data/]`  |
| `process`  | fallback — any `NodeId[...]` not matched above       | `Serve[Serve token]`  |

Regex definitions follow the v2 design's `ROLE_RULES` array, with start/end keyword lists covering `start|begin|init` and `end|done|finish|complete`.

**Shape-based fallback (post-render):** if a rendered `<g class="node">` has no matching role key, inspect its shape — `polygon` descendant → `decision`, otherwise `process`. Guarantees every node ends up with a `data-role` attribute so no node renders unstyled.

## YES/NO edge detection

Match mermaid edge syntax `From -->|label| To` (arrow variants `-->`, `---`, `==>`, `-.->`). Classify the label:

- `yes | true | ok | success | pass | 1` → `edge-yes`
- `no | false | fail | error | reject | 0` → `edge-no`
- anything else → untagged, default edge styling

Post-render, for each `{from, to, branch}` triple, query SVG edges whose id contains `_From_To_` or `-From-To-` and add the `edge-yes` / `edge-no` class to the `<path>` and its arrowhead `<marker>`. Edge labels matched by exact text content (lowercased) get the matching `edge-yes-label` / `edge-no-label` class.

Label-text matching is fragile — fallback is that an unmatched label renders uncolored.

## Actor indexing (sequence)

Walk `rect.actor` in SVG in DOM order. Mermaid renders two boxes per actor (top and bottom), so dedupe by rounded x-coordinate. Assign each unique x an index `idx % 6`. Set `data-actor-idx="0"..."5"` on both the rect and its parent `<g class="actor">` where one exists. Tag lifelines (`line.actor-line`) with the same index by DOM order (one per actor).

No source parsing needed — DOM-only pass.

## Palettes

All three palettes added as CSS custom properties in `:root` within `styles.css`.

### Role palette (flowchart nodes)

```css
--role-start:    oklch(0.72 0.12 200); /* teal */
--role-process:  oklch(0.72 0.05 260); /* slate */
--role-decision: oklch(0.78 0.14 75);  /* amber */
--role-end:      oklch(0.72 0.14 150); /* green */
--role-error:    oklch(0.68 0.17 25);  /* red */
--role-io:       oklch(0.72 0.12 290); /* violet */
```

Fill = `color-mix(in srgb, var(--role-X) 20%, var(--bg-primary))`, stroke = full role color. Decision gets `stroke-width: 2px` and bold label — it's the branch point, deserves extra weight.

### Actor palette (sequence, 6-hue cycle)

```css
--actor-0: oklch(0.72 0.12 200); /* teal */
--actor-1: oklch(0.74 0.14 75);  /* amber */
--actor-2: oklch(0.72 0.14 150); /* green */
--actor-3: oklch(0.72 0.12 290); /* violet */
--actor-4: oklch(0.68 0.17 25);  /* red */
--actor-5: oklch(0.74 0.10 320); /* magenta */
```

Participant box fill + lifeline share hue. Message arrows remain neutral `#e0e7ff` with `paint-order: stroke` around the text for legibility over busy backgrounds.

### YES/NO branch palettes — two themes, B default

```css
/* Default (B) — palette-aligned */
--edge-yes: var(--accent);  /* teal #00adb5 */
--edge-no:  #f59e0b;        /* amber */

/* Alt (A) — semantic. Toggled via body.yesno-semantic */
body.yesno-semantic {
  --edge-yes: var(--success); /* green #2ecc71 */
  --edge-no:  var(--danger);  /* red #e74c3c */
}
```

Edges paint as 2.5px solid in the palette color. Labels render as small chips with edge color as background, inverted text color for contrast. No glow or drop-shadow hacks.

**Runtime switch:** no UI in this slice. Default B ships baked; A available via `document.body.classList.add('yesno-semantic')` for manual testing. Moved to tech-debt for user-facing picker.

## Runtime flow

Per `<pre class="mermaid">` block inside `renderMermaidBlocks()`:

```
1. source = pre.textContent                  // before mermaid mutates the DOM
2. roles = detectRoles(source)               // { "CheckToken": "decision", ... }
3. branches = parseBranchLabels(source)      // [{ from, to, branch: "yes" }, ...]
4. await mermaid.run({ nodes: [pre] })       // pre → <svg> in place
5. svg = pre.querySelector('svg')
6. applyRoles(svg, roles)                    // + shape-based fallback
7. applyBranchEdges(svg, branches)           // class on <path> + <marker>
8. applyActorIndices(svg)                    // data-actor-idx on rect.actor
```

Steps 2–3 pre-parse, 4 is mermaid's work, 6–8 mutate SVG. All synchronous after `mermaid.run` resolves — no MutationObserver, no retry loop.

### Failure modes

- **Mermaid CDN fails:** existing behavior preserved — `<pre>` keeps its raw source as text. Steps 5–8 never run because step 4 rejects.
- **Mermaid parse fails:** no SVG emitted. Post-processing early-returns on `!svg`.
- **Regex misses a node:** shape-based fallback in `applyRoles` paints it `process`. Never uncolored.
- **Edge label text doesn't match:** label renders uncolored. Non-fatal.

### Re-entry

`renderMermaidBlocks()` already filters `pre.mermaid:not([data-processed])`. The post-processing functions are idempotent: setting an attribute a second time is a no-op, adding a class that's already present is a no-op.

## Testing

### Unit tests — new file `tests/mermaid-roles.test.ts`

Plain-string-in, object-out. No DOM, fast.

- `detectRoles()` on 6+ source variants covering each role mapping
- `detectRoles()` edge cases: Unicode ids, empty source, nodes with multiple shape forms
- `parseBranchLabels()`: all yes/no synonyms, unlabeled edges excluded, mixed-arrow-style fences

### Visual suite — extend `examples/renderer-fixture.md` + `tests/visual/*.spec.ts`

The fixture-driven Playwright suite already boots `HttpTransport` against `examples/renderer-fixture.md` and asserts post-mount DOM + computed styles. Extend the fixture to include:

- A flowchart exercising all 6 roles
- A flowchart with yes/no branch labels
- A sequence diagram with 3+ participants

Add assertions:

- `g.node[data-role="decision"]` count > 0 on the flowchart section
- `path.edge-yes` and `path.edge-no` present
- `rect.actor[data-actor-idx="0"]` computed `stroke` matches `--actor-0` resolved color
- Screenshot diff per new section (existing pattern)

### Skipped

- Palette toggle E2E — no UI yet, just a body class; trivial.
- Mermaid library internals — not ours to test.

### Run commands

Unchanged: `npm test` and `npm run test:visual`.

## Risks

- **Regex brittleness across mermaid syntax variants.** Mitigated by shape-based fallback in `applyRoles` and unit tests on syntax variants. A node that slips both the regex and the shape check would still render; it just would not pick up the role color.
- **CSS specificity against mermaid's injected styles.** Mermaid injects inline `style="fill:..."` via its theme system. Attribute-selector CSS in our stylesheet tends to lose to inline styles. Expected mitigation: use `!important` on node fill/stroke rules — ugly but the only robust option without post-mutating every inline style. Scoped to the six role selectors; not a global pattern.
- **Edge-label matching by text.** If two edges share the same label text (e.g. two `|Yes|` edges), both get the same class. Acceptable — they share semantics.

## Tech-debt items added this session

Append to `thoughts/tech-debt.md`:

- **Feature: mermaid toolbar** — zoom in/out/fit, source toggle with syntax highlighting, copy source, download SVG, fullscreen modal. Scoped out of this design to ship colors alone. Source of truth for shape: `docs/plan-review-mermaid/mermaid_block_v2.jsx`.
- **Feature: click-to-comment on mermaid nodes** — ties node selection into the existing LineBlock comment system. Non-trivial because nodes live inside one LineBlock today.
- **Feature: user-facing theme switcher including light mode** — covers the YES/NO A/B palette toggle plus a broader light/dark mode.
- **Polish: opacity-fade raw mermaid source while CDN loads** — quieter loading state that still reveals source if CDN fails.

## Out-of-scope confirmations

- Chrome variants (minimal/labeled/terminal): not shipped. Current look = no chrome.
- Legend strip: not shipped.
- Node-click popover + node-chrome overlay: not shipped.
- Tweaks panel / EDITMODE protocol from v2: not shipped.
