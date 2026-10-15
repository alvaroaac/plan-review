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

## Usage

### Reviews and rounds

Every review is saved under `~/.plan-review/` and has an id like `rv_8f3a`. Answers and comments are saved as you go, so you can close the tab and come back later.

```bash
plan-review plan.md                  # resumes the open review for this file, or starts one
plan-review plan.md --review rv_8f3a # continue a specific review (next round after a revision)
plan-review plan.md --fresh          # start a new review even if one is open
plan-review list                     # open reviews: id, title, round, answered/deferred/open
plan-review list --all               # include approved reviews
```

When you request changes, the agent revises the plan and runs it again with `--review <id>`. That opens the next round. Your answers carry over, and an item reopens if its text changed. If you close the tab before submitting, the CLI prints a paused notice and exits 0. Run the same command to pick up where you left off.

### Authoring blocks

Agents can add fenced blocks to a plan. The UI shows them as items to answer.

````md
```decision id=retry-backoff
label: Retry backoff
question: How should token refresh retries back off?
quote: how token refresh retries back off
- A: Exponential backoff, capped at 5 s | Simple [pick]
- B: Circuit breaker after 90 s | Needs a health probe
```

```assumption id=subtlecrypto
statement: Every supported browser exposes SubtleCrypto.
```

```reply thread=t_4k2
Reworded to "never exposed to the browser".
```
````

- `decision` needs an `id`, a `question` and at least two options. `[pick]` marks the author's choice.
- `assumption` needs an `id` and a `statement`. The reviewer marks it as holds, not sure or doesn't hold.
- `label`, `quote` and `context` are optional. `quote` highlights that phrase in the preceding prose.
- `reply` answers a review comment thread by id, in the next round.
- Keep ids stable across rounds; answers are matched by id.

A malformed block is shown as a plain code block, with a warning. See [examples/demo-plan.md](examples/demo-plan.md) for a full plan.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
