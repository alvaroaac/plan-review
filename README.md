# plan-review

Interactive CLI for reviewing AI-generated markdown plans. Parses plans into sections, renders them in the terminal, collects your comments, and outputs structured feedback.

## Install

```bash
npm install -g plan-review
```

## Usage

```bash
plan-review path/to/plan.md
```

### Options

```
-o, --output <target>   Output target: stdout, clipboard, file, claude
--output-file <path>    Custom output file path (with --output file)
--split-by <strategy>   Force split strategy: heading, separator
-V, --version           Show version
-h, --help              Show help
```

If `-o` is omitted, you'll be prompted to choose after the review.

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

## How it works

1. **Parses** your markdown — auto-detects plan-style documents (milestones, tasks, dependencies) or falls back to generic heading-based splitting
2. **Renders** a table of contents with section navigation
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
