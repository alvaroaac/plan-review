# plan-review

Interactive CLI for reviewing AI-generated markdown plans. Parses plans into sections, renders them in the terminal or browser, collects your comments, and outputs structured feedback.

## Install

```bash
npm install -g plan-review
```

## Usage

```bash
# Terminal mode (interactive)
plan-review path/to/plan.md

# Browser mode (three-panel review UI)
plan-review path/to/plan.md --browser
```

### Options

```
-o, --output <target>   Output target: stdout, clipboard, file, claude
--output-file <path>    Custom output file path (with --output file)
--split-by <strategy>   Force split strategy: heading, separator
--browser               Open browser-based review UI
-V, --version           Show version
-h, --help              Show help
```

If `-o` is omitted, you'll be prompted to choose after the review. Output targets work with both terminal and browser modes (e.g., `--browser -o clipboard`).

### Interactive commands

| Command | Action |
|---------|--------|
| `all` | Linear review through all sections |
| `1.1` | Jump to a specific section |
| `done` / `q` | Finish review |
| `toc` | Return to table of contents |
| `back` | Go to previous section |
| *(enter)* | Skip section |
| *(any text)* | Add comment on current section |

## Review modes

### Terminal mode (default)

Interactive terminal UI with table of contents, section navigation, and inline commenting.

### Browser mode (`--browser`)

Opens a three-panel review UI in your browser:

- **Left** — Table of contents with section tree and comment indicators
- **Center** — Rendered markdown content with dependency metadata (plan mode)
- **Right** — Comment sidebar with add, edit, and delete

Add comments on any section, then click "Submit Review" to send your feedback back to the CLI. The server shuts down automatically after submission.

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

## License

MIT
