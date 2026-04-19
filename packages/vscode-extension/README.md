# Plan Review — VS Code Extension

Review AI-generated implementation plans inline without leaving VS Code. Embeds the same review UI as the `plan-review` CLI's `--browser` mode as a VS Code webview panel.

## Install (from source)

```bash
cd packages/vscode-extension
npm run build
npm run package           # produces plan-review-vscode-<version>.vsix
code --install-extension ./plan-review-vscode-0.0.1.vsix
```

## Usage

- Right-click a `.md` file in the Explorer → **Plan Review: Review this plan**
- Open a `.md` file → click the review icon in the editor title bar
- On plan-format files, a CodeLens **▶ Review this plan** appears above the H1

## Settings

All settings live under `planReview.*`:

| Setting | Default | Description |
|---|---|---|
| `planReview.submitTargets` | `["clipboard"]` | Array of submit destinations: `clipboard`, `file`, `claudeCode`, `outputChannel` |
| `planReview.outputFilePath` | `${planDir}/${planName}.review.md` | Template for the `file` target. Supports `${planDir}`, `${planName}`, `${workspaceFolder}` |
| `planReview.planModeDetection` | `auto` | CodeLens visibility: `auto` uses parser; `always` / `never` force |
| `planReview.codeLens.enabled` | `true` | Show CodeLens above plan-mode files |

## Submit targets

- **clipboard** — formatted review copied to clipboard
- **file** — written to `planReview.outputFilePath`, opened beside the plan (parent dirs created if missing)
- **claudeCode** — dispatched to Claude Code extension via `claude-code.sendToChat` (falls back to a descriptive error if the extension isn't installed)
- **outputChannel** — appended to the "Plan Review" output channel

Multiple targets run in parallel; a single toast summarizes successes and failures.

## Interop with the CLI

The extension shares the session store at `~/.plan-review/sessions/` with the `plan-review` CLI. Start a review in either tool; the other picks up where you left off.

## Development

```bash
# From repo root:
npm install
npm run build
npm run test
npm run test:integration -w plan-review-vscode   # launches VS Code headlessly
```

Related packages in the monorepo:
- `@plan-review/core` — parser, session store, formatter
- `@plan-review/browser-app` — Preact review UI (shared with CLI browser mode)
- `plan-review` (CLI) — standalone terminal-review binary
