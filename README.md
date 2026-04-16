# plan-review

Interactive CLI for reviewing AI-generated markdown plans. Parses plans into sections, renders them in the terminal or browser, collects your comments, and outputs structured feedback — back to the AI or your team.

## Install

```bash
npm install -g plan-review
```

### Claude Code skill (optional)

If you use Claude Code, install the companion skill so you can say *"review this plan"*:

```bash
plan-review install-skill
```

## Quick start

```bash
# Try the included demo plan
plan-review --browser examples/demo-plan.md

# Review your own plan
plan-review path/to/plan.md --browser

# Pipe feedback directly to Claude
plan-review path/to/plan.md --browser -o claude
```

## Browser mode (`--browser`)

The browser mode opens a three-panel review UI:

```
+------------------+----------------------------+------------------+
|                  |                            |                  |
|   Table of       |   Rendered markdown        |   Comment        |
|   Contents       |   with plan metadata       |   Sidebar        |
|                  |                            |                  |
|   - Milestone 1  |   ## Task 1.1              |   [Add comment]  |
|     * Task 1.1 ✓ |                            |                  |
|     * Task 1.2   |   **Depends on:** 1.0      |   > "Line 3-5"  |
|   - Milestone 2  |   **Blocks:** 1.2          |   Fix the error  |
|     * Task 2.1   |                            |   handling here  |
|                  |   Content with line        |                  |
|                  |   gutters for anchoring    |   [Submit Review] |
|                  |   comments to ranges       |                  |
+------------------+----------------------------+------------------+
```

**Line-anchored comments:** Click a line number in the gutter to start a selection. Shift-click another line to select a range. Your comment is anchored to those exact lines.

**Section-level comments:** Click "Add comment to entire section" below any section.

**Auto-save:** Comments are saved as you work. Close the browser, come back later, resume where you left off.

Click "Submit Review" when done — structured feedback is sent back to the CLI.

## Terminal mode (default)

```bash
plan-review path/to/plan.md
```

Interactive terminal UI with table of contents, section navigation, and inline commenting. Works over SSH, in CI, anywhere.

| Command | Action |
|---------|--------|
| `all` | Linear review through all sections |
| `1.1` | Jump to a specific section |
| `done` / `q` | Finish review |
| `toc` | Return to table of contents |
| `back` | Go to previous section |
| *(enter)* | Skip section |
| *(any text)* | Add comment on current section |

## Options

```
-o, --output <target>   Output target: stdout, clipboard, file, claude
--output-file <path>    Custom output file path (with --output file)
--split-by <strategy>   Force split strategy: heading, separator
--fresh                 Skip session resume, start clean review
--browser               Open browser-based review UI
-V, --version           Show version
-h, --help              Show help
```

## The AI feedback loop

The real power is closing the loop between AI-generated plans and human review:

```
AI writes plan  →  You review with plan-review  →  Feedback pipes to Claude  →  AI revises
```

```bash
# Review in browser, send feedback straight to Claude
plan-review plan.md --browser -o claude
```

Your anchored, section-by-section comments become structured input the AI can act on — not a wall of text in a chat message.

## How it works

1. **Parses** your markdown — auto-detects plan-style documents (milestones, tasks, dependencies) or falls back to generic heading-based splitting
2. **Renders** in terminal or browser depending on mode
3. **Collects** your comments as you review each section
4. **Outputs** structured markdown with your comments alongside the original content

### Plan mode

Documents with `## Milestone` / `### Task` hierarchy and fields like `**Depends On:**`, `**Blocks:**`, `**Verification:**` are detected as plans. Sections show dependency metadata and task IDs.

### Generic mode

Any markdown with headings gets split into reviewable sections.

## Output targets

- **stdout** — print to terminal (default)
- **clipboard** — copy to clipboard (pbcopy/xclip)
- **file** — write to `<input>.review.md` or custom path
- **claude** — pipe directly to Claude Code CLI

## Saved sessions

Review progress is auto-saved as you work. If you close the terminal or browser and re-run `plan-review` on the same file, you'll be prompted to resume where you left off.

Sessions are stored in `~/.plan-review/sessions/`.

```
plan-review plan.md --fresh    Skip session resume, start clean
plan-review sessions           List all saved sessions
```

Manual cleanup: delete files in `~/.plan-review/sessions/`.

## License

MIT
