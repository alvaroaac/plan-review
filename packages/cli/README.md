# plan-review

Interactive CLI for reviewing AI-generated markdown plans. Opens the plan in a browser review UI where you answer the agent's open decisions, check its assumptions and comment on any paragraph, then pipes the review back — to the AI that wrote the plan, your clipboard, or a file. When the agent revises the plan, the same review continues into the next round with your answers carried over.

![Browser mode demo](https://raw.githubusercontent.com/alvaroaac/plan-review/main/examples/demo-browser.gif)

## Install

```bash
npm install -g plan-review
```

Requires Node.js 20 or later.

### Claude Code skill (optional)

If you use Claude Code, install the companion skill so you can say *"review this plan"*:

```bash
plan-review install-skill
```

This copies the skill to `~/.claude/skills/plan-review/` and adds a short note to `~/.claude/CLAUDE.md` (between `<!-- plan-review:begin -->` and `<!-- plan-review:end -->` markers) telling Claude to draft specs and plans with open choices as plan-review decision blocks. Re-running it updates both in place.

## Quick start

```bash
# Review a plan in the browser
plan-review path/to/plan.md

# Send the review straight back to Claude
plan-review path/to/plan.md -o claude

# Read the plan from stdin, print the review to stdout
cat plan.md | plan-review -o stdout
```

Without `-o`, the CLI asks where to send the review once you submit: stdout, clipboard, file or Claude.

## The feedback loop

```
Agent writes plan  →  You review it  →  Review goes back to the agent  →  Agent revises  →  next round
```

1. The agent writes a plan, with its open questions as [decision and assumption blocks](#authoring-blocks).
2. You review it in the browser: answer the decisions, check the assumptions, comment on paragraphs.
3. You submit with **Approve** or **Request changes**. The review is written as markdown the agent can act on.
4. The agent revises the plan and runs `plan-review plan.md --review <id>`. That opens round 2, with your earlier answers carried over and any reworded item reopened.

Repeat until you approve.

## Browser mode (default)

The plan renders in the middle, with a table of contents on the left and the review panel on the right. The top bar shows how many items are answered, a **Next open** button that jumps to the next unanswered one, and **Submit review**.

**Decisions.** Each decision shows the agent's question and options, with the author's pick marked. Choose an option, or *Something else* with a note, and add an optional rationale. **Defer** a decision you can't answer yet, with an optional note on what's needed first or who should decide.

**Assumptions.** Mark each one as *Holds*, *Not sure* or *Doesn't hold*. *Doesn't hold* asks what's actually true.

**Paragraph comments.** Hover a paragraph and click *Comment on this paragraph*. Shift-click another paragraph to extend the range. Comments become threads you can reply to, resolve and reopen; filter them by open, resolved or all.

**Submitting.** *Submit review* opens a popover with an optional summary for the agent and a list of anything still unanswered. Choose **Request changes** or **Approve**.

**Autosave.** Answers and comments save as you go. If you close the tab before submitting, the CLI prints a paused notice and exits cleanly. Run the same command to pick up where you left off.

**Rendering.** Paragraphs, nested lists, task lists, tables, code fences with syntax highlighting, blockquotes, GFM admonitions (`> [!NOTE]`), footnotes, inline HTML (`<kbd>`, `<sub>`, `<sup>`, `<details>`), emoji shortcodes, images and reference-style links, plus mermaid diagrams and KaTeX math, both lazy-loaded only when the plan contains them. Light and dark themes.

## Reviews and rounds

Every review is saved under `~/.plan-review/reviews/` and has an id like `rv_8f3a`. Set `PLAN_REVIEW_HOME` to store them somewhere else.

```bash
plan-review plan.md                  # resume the open review for this file, or start one
plan-review plan.md --review rv_8f3a # continue a specific review (next round after a revision)
plan-review plan.md --fresh          # start a new review even if one is open
plan-review list                     # open reviews: id, title, round, answered/deferred/open
plan-review list --all               # include approved reviews
```

Answers are matched to items by id. When an item's text changes between rounds, it reopens with your previous answer shown.

## Authoring blocks

Agents add fenced blocks to a plan. The UI shows them as items to answer.

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

- `decision` needs an `id`, a `question` and at least two options, written `- A: text | detail`. `[pick]` marks the author's choice.
- `assumption` needs an `id` and a `statement`.
- `label`, `quote` and `context` are optional. `quote` highlights that phrase in the preceding prose.
- `reply` answers a review comment thread by id, in the next round.
- Keep ids stable across rounds.

A malformed block is shown as a plain code block, with a warning. See [examples/demo-plan.md](https://github.com/alvaroaac/plan-review/blob/main/examples/demo-plan.md) for a full plan.

## Output

The review is markdown, addressed to the agent:

```md
# Plan Review: User Authentication System
Review `rv_8f3a` · Round 1 · **Changes requested**

## Summary
Resolve the remaining security questions.
...

## Decisions
### `rate-limit-store` · Rate limit store — **B**: Postgres table keyed by email (your pick was A)
### `logout-scope` · Logout scope — **Deferred**
> Needs security-team input.

## Open threads
### `t_4k2` · § Task 1.2: Database schema
> Add an index on email.
- **Reviewer:** Make this index unique.

---
**Next:** revise the plan and re-run with `--review rv_8f3a`. Keep item ids stable.
...
```

Output targets (`-o`):

- **stdout** — print to the terminal
- **clipboard** — copy to the clipboard (pbcopy/xclip)
- **file** — write to `<input>.review.md`, or a custom path via `--output-file`
- **claude** — pipe straight into the Claude Code CLI (falls back to stdout if `claude` isn't on PATH)

## Terminal mode (`--cli`)

For SSH sessions, CI or headless environments where a browser isn't an option:

```bash
plan-review path/to/plan.md --cli
```

| Command | Action |
|---------|--------|
| `1.1` | Review from a specific section |
| `all` | Review all sections in order |
| `done` / `q` | Submit as changes requested |
| `approve` | Submit as approved |
| `toc` | Back to the table of contents |
| `back` | Previous section |
| *(enter)* | Skip section |
| *(any text)* | Comment on the current section |

Terminal mode is a fallback. It shows decision and assumption blocks as text but can't answer them; the output notes how many are unanswered so you can finish them in browser mode. Comments are section-level, and there's no mermaid or math rendering.

## Plan mode and generic mode

Documents with a `## Milestone` / `### Task` hierarchy and fields like `**Depends On:**`, `**Blocks:**` and `**Verification:**` are detected as plans, with dependency metadata and task ids in the contents. Any other markdown is split into sections by heading. Force a strategy with `--split-by heading` or `--split-by separator`.

## Reference

```
plan-review [file] [options]       Review a markdown file (omit file to read stdin)
plan-review list [--all]           List saved reviews
plan-review install-skill          Install the Claude Code skill and CLAUDE.md note

-o, --output <target>   Output target: stdout, clipboard, file, claude
--output-file <path>    Custom output file path (with --output file)
--split-by <strategy>   Force split strategy: heading, separator
--review <id>           Resume a review by id
--fresh                 Start a new review even if one is open for this file
--cli                   Use the terminal review UI instead of the browser
-V, --version           Show version
-h, --help              Show help
```

`--fresh` and `--review` can't be combined.

## VS Code extension

Review plans inside VS Code without leaving the editor. See the [extension README](https://github.com/alvaroaac/plan-review/blob/main/packages/vscode-extension/README.md) for install and usage.

## License

MIT
