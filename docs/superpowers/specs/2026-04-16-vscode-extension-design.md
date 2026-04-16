# VS Code Extension — Design Spec

## Overview

Ship a VS Code extension that embeds the existing `plan-review` browser UI as a webview panel. Goal is in-editor review flow: user opens a plan via Explorer context menu, CodeLens, or editor title button, reviews in a dedicated editor tab next to their code, and submits feedback to one or more configurable output targets (clipboard, file, Claude Code chat, Output channel).

The extension does **not** reimplement the review UI. It bundles the existing Preact app and communicates via VS Code's `postMessage` (no local HTTP server). The CLI and extension share a single app bundle via a transport abstraction.

In-scope (v1): parity with current CLI browser mode — parse, render, line/section comments, session auto-save, submit. Out of scope: diff-aware review, AI chat, native `CommentController` threads, Marketplace publish.

## Motivation

The CLI browser mode works but forces a context switch: terminal → browser tab → back. Reviewers using VS Code want to review a plan in the same window as the code they're thinking about. An editor-tab webview keeps the review adjacent to the repo without launching a separate app.

## Architecture

### Monorepo split

Convert `plan-review` from a single-package repo into an npm workspaces monorepo:

```
plan-review/
├── package.json                      # workspaces root, dev scripts
├── packages/
│   ├── core/                         # existing parser, session, formatter, types
│   │   └── src/
│   │       ├── parser.ts
│   │       ├── session.ts
│   │       ├── formatter.ts
│   │       ├── transport.ts          # ReviewTransport interface
│   │       └── types.ts
│   ├── cli/                          # existing CLI (terminal + local HTTP server)
│   │   └── src/
│   │       ├── index.ts              # CLI entry
│   │       ├── navigator.ts
│   │       ├── renderer.ts           # terminal rendering
│   │       ├── output.ts             # CLI output routing (stdout/clipboard/file/claude)
│   │       ├── server/               # HTTP server for CLI browser mode
│   │       └── httpTransport.ts      # HttpTransport implementation
│   ├── browser-app/                  # existing Preact app, transport-agnostic
│   │   └── src/
│   │       ├── index.tsx             # entry, reads window.__TRANSPORT__
│   │       ├── App.tsx               # receives transport via prop
│   │       ├── TOCPanel.tsx
│   │       ├── SectionView.tsx
│   │       ├── LineBlock.tsx
│   │       ├── CommentSidebar.tsx
│   │       ├── CommentCard.tsx
│   │       ├── CommentInput.tsx
│   │       ├── lineRenderer.ts
│   │       └── styles.css
│   └── vscode-extension/             # new
│       ├── package.json              # VS Code extension manifest
│       ├── src/
│       │   ├── extension.ts          # activate(), command registration
│       │   ├── webviewPanelManager.ts # URI→panel map, lifecycle
│       │   ├── messageHandlers.ts    # loadDocument, saveSession, submitReview
│       │   ├── codeLensProvider.ts   # plan-mode-aware "Review this plan"
│       │   └── submit/
│       │       ├── clipboard.ts
│       │       ├── file.ts
│       │       ├── claudeCode.ts
│       │       └── outputChannel.ts
│       └── media/
│           ├── webview.js            # bundled browser-app + PostMessageTransport shim
│           └── webview.css
```

Each package owns its build. Root scripts orchestrate (`npm run build -ws`, `npm run test -ws`). `vscode-extension` build copies `browser-app/dist` into `media/`.

### Transport abstraction

Browser app is decoupled from the host via a single interface in `core`:

```ts
export interface ReviewTransport {
  loadDocument(): Promise<{ document: PlanDocument }>;
  saveSession(state: {
    comments: ReviewComment[];
    activeSection: string | null;
  }): Promise<void>;
  submitReview(comments: ReviewComment[]): Promise<{ ok: true }>;
}
```

`browser-app` receives the transport at bootstrap:

```tsx
// packages/browser-app/src/index.tsx
const transport: ReviewTransport = (window as any).__TRANSPORT__ ?? new HttpTransport();
render(<App transport={transport} />, document.getElementById('app')!);
```

All existing `fetch('/api/...')` calls inside `App.tsx` (and children) become `props.transport.*` calls. This is the main invasive refactor.

**Two transport implementations:**

- `HttpTransport` (in `cli/src/httpTransport.ts`) — current behavior. `loadDocument()` → `fetch('/api/doc')`; `saveSession()` → `fetch('/api/session', { method: 'PUT', ... })`; `submitReview()` → `fetch('/api/review', { method: 'POST', ... })`. Bundled into the CLI-served HTML as the default.
- `PostMessageTransport` (in `vscode-extension/media/webview.js` entry shim) — wraps `acquireVsCodeApi()`. Each method call sends a request message with a correlation `id` and awaits the matching response. Timeout 30s.

### PostMessage protocol

Webview ↔ extension messages:

```ts
// webview → extension
{ id: string, kind: 'req', method: 'loadDocument' | 'saveSession' | 'submitReview', params?: unknown }

// extension → webview
{ id: string, kind: 'res', result: unknown }
{ id: string, kind: 'err', error: string }
```

Correlation by `id` (uuid). Webview keeps a `Map<id, { resolve, reject }>` and resolves on matching message. Requests time out after 30s with an error.

## Invocation

### Commands

- `plan-review.open` — open review panel for given URI (defaults to active editor if no argument)
- `plan-review.submit` — keyboard-bindable submit (when webview focused)

### Contribution points

- `menus.explorer/context`, `when: resourceExtname == .md` → "Plan Review: Review this plan"
- `menus.editor/title`, `when: resourceExtname == .md` → review icon
- `languages.codeLensProvider` for `markdown` — shows "▶ Review this plan" above the H1 **only when plan mode is detected** (`core.parse(text).mode === 'plan'`). Toggleable via `planReview.codeLens.enabled` setting. Mode detection uses the same heuristic as the CLI's `--plan` auto-detect.

### UX flow

1. User triggers via any entry point
2. Extension opens `vscode.window.createWebviewPanel(..., ViewColumn.Beside, { retainContextWhenHidden: true })` titled `Plan Review — <filename>`
3. Webview HTML loaded from `media/` via `panel.webview.asWebviewUri()` with a nonce-based CSP
4. Webview sends `loadDocument` request; extension reads URI via `vscode.workspace.fs.readFile`, calls `core.parse()`, returns the `PlanDocument`
5. Extension checks for existing sidecar session file; if present, replies with `document` plus previously-saved `comments`/`activeSection`
6. User reviews. Each comment mutation triggers a debounced (500ms) `saveSession` → extension writes sidecar file
7. User submits → extension runs configured output targets in parallel → dispose panel

### Panel lifecycle

- `WebviewPanelManager` keeps a `Map<string, WebviewPanel>` keyed by canonical URI. Re-invoking `plan-review.open` on a plan with an open panel focuses it instead of duplicating.
- `panel.onDidDispose` → write one final `saveSession` snapshot
- `FileSystemWatcher` on the plan URI — if disk content hash changes while panel open, post a `planChanged` message to the webview; user sees a banner "Plan changed on disk — reload or keep reviewing"

## Session persistence

Same sidecar file as the CLI: `<plan>.plan-review-session.json` next to the plan file. Schema reused from current `core/session.ts` (content-hash keyed). This gives free interop — start a review in the CLI, finish in the extension and vice versa.

Extension-side `saveSession` handler calls `core.session.save(uri, state)` which handles atomic write + hash. On `loadDocument`, handler also calls `core.session.load(uri, documentHash)` and includes restored comments in the reply.

## Submit handlers

### Settings schema

Contributed in `vscode-extension/package.json`:

```jsonc
"planReview.submitTargets": {
  "type": "array",
  "items": { "enum": ["clipboard", "file", "claudeCode", "outputChannel"] },
  "default": ["clipboard"]
},
"planReview.outputFilePath": {
  "type": "string",
  "default": "${planDir}/${planName}.review.md",
  "description": "Supports ${planDir}, ${planName}, ${workspaceFolder}"
},
"planReview.planModeDetection": {
  "enum": ["auto", "always", "never"],
  "default": "auto"
},
"planReview.codeLens.enabled": {
  "type": "boolean",
  "default": true
}
```

### Handlers

All handlers receive the output of `core.formatter.formatReview(comments, document)` — same formatting as the CLI.

- **clipboard** → `vscode.env.clipboard.writeText(formatted)`
- **file** → resolve `outputFilePath` template, write via `workspace.fs.writeFile`, then `vscode.window.showTextDocument(uri)`
- **claudeCode** → probe `vscode.commands.getCommands(true)` for a Claude Code command (name TBD — confirm at implementation time by inspecting installed extension; if none available, surface the actual command name in a warning and fall back to clipboard)
- **outputChannel** → append to `vscode.window.createOutputChannel('Plan Review')` and `.show()`

### Fan-out

Configured targets run in parallel via `Promise.allSettled`. Single toast summarizes:

- All succeeded → info: `Review submitted → clipboard, file`
- Partial → warning: `Review submitted → clipboard. Failed: claudeCode (Extension not installed)`
- All failed → error with first error message

## Webview security

- CSP: `default-src 'none'; script-src 'nonce-<nonce>' ${cspSource}; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:;`
- Script loaded via `<script nonce="<nonce>" src="${asWebviewUri('media/webview.js')}">`
- Styles inline in bundled CSS file via `${cspSource}`
- No remote resources; all assets bundled in `media/`

## Testing

- **core** — existing vitest tests migrate with the package. No behavior change.
- **browser-app** — existing Preact tests updated to inject a `MockTransport` instead of mocking `fetch`. New test: transport prop wiring.
- **vscode-extension** — two layers:
  - Unit (vitest, mocked `vscode` API): message correlation/timeout/error in `PostMessageTransport` host handler; each submit handler's behavior in isolation
  - Integration (`@vscode/test-electron`): launch VS Code, open a sample plan via command, assert webview panel exists, simulate a `submitReview` message, assert clipboard content equals `formatReview(...)` output. Smoke-level only — one happy-path test per major flow (open, comment save, submit).
- Manual QA matrix documented in `packages/vscode-extension/README.md`.

## Migration / build-out order

Each step leaves the CLI working so regressions are caught immediately.

1. Add npm workspaces scaffolding at repo root (`workspaces: ["packages/*"]`); move existing `package.json` deps into `packages/core` and `packages/cli` appropriately
2. Move `src/{parser,session,formatter,types,transport}.ts` → `packages/core/src/`; wire `packages/core/package.json` exports
3. Move `src/{index,navigator,renderer,output,server}` → `packages/cli/src/`
4. Move `src/browser/` → `packages/browser-app/src/`; introduce `transport` prop on `App`, replace all `fetch('/api/*')` calls
5. Implement `HttpTransport` in `packages/cli/src/httpTransport.ts`; verify CLI browser mode passes all existing tests unchanged
6. Scaffold `packages/vscode-extension`: manifest, `extension.ts`, `WebviewPanelManager`, `messageHandlers.ts`, `PostMessageTransport` shim entry
7. Implement 4 submit handlers
8. Contribution points: commands, menus, CodeLens provider, settings
9. `@vscode/test-electron` smoke tests
10. Dogfood: `vsce package` → `code --install-extension plan-review-<v>.vsix`; document sideload steps in README

## Non-goals (v1)

- Diff-aware review (deferred to v2 per `docs/feature-ideas.md`)
- AI chat panel (deferred to v2)
- Native VS Code `CommentController` / gutter threads (future — would sync webview comments to editor gutters on the plan file)
- Marketplace publish (ship `.vsix` sideload first, publish after dogfooding)
- Cross-editor support for Cursor/Windsurf (likely works via VS Code API compat but untested)

## Risks

- **Refactor scope** — moving source into workspaces + introducing transport prop touches every browser-app component. Mitigation: step 5 gates on CLI browser-mode tests passing before any extension work starts.
- **CodeLens false positives** — plan-mode heuristic is fuzzy. Mitigation: `planReview.planModeDetection` setting with `always`/`never` escape hatches.
- **Claude Code command name** — the exact command exposed by the Claude Code extension is not known at design time. Mitigation: probe `getCommands()`, surface the discovered name in error messages, fall back to clipboard.
- **Session file hash churn** — if the user edits the plan mid-review, the sidecar session's content hash becomes stale. Mitigation: `FileSystemWatcher` posts a `planChanged` message; user can reload or keep current session (hash-mismatch banner already exists in `core/session.ts`).
