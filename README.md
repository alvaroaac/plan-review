# plan-review

Interactive tool for reviewing AI-generated markdown plans. Parses a plan into sections, collects line-anchored comments, and pipes structured feedback back to the AI that wrote it.

## Packages

| Package | Description |
|---------|-------------|
| [plan-review](packages/cli) | CLI and browser review UI |
| [@plan-review/core](packages/core) | Markdown parsing and plan detection |
| [@plan-review/browser-app](packages/browser-app) | Three-panel browser review interface |
| [plan-review-vscode](packages/vscode-extension) | VS Code extension |

## Quick start

```bash
npm install -g plan-review
plan-review path/to/plan.md
```

See the [CLI README](packages/cli/README.md) for full usage.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
