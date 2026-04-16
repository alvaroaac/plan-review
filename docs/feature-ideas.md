# Feature Ideas

## Resume Review (Save/Restore State)

Save review progress to a session file. On re-run, detect and offer to resume. Both terminal and browser modes benefit — browser especially since closing the tab loses everything.

**What gets saved:** comments array, last active section, scroll position (browser), timestamp. Session keyed by plan file content hash so stale sessions (plan changed) are detected and user is warned.

**UX:** `plan-review plan.md` finds session → "Resume previous review? (12 comments, last edited 2h ago) [y/n]". `--fresh` skips the prompt. On submit, session file cleaned up.

**Open question:** session file next to plan file (`.plan-review-session.json`) or central location (`~/.plan-review/sessions/`)? Next-to-file is discoverable. Central avoids littering.

**Effort:** ~4-6 hours.

---

## Diff-Aware Review Mode

Accept two files — old and new plan — highlight what changed. Reviewer focuses on deltas instead of re-reading everything.

**CLI:** `plan-review plan-v2.md --diff plan-v1.md`

**Future:** `--diff-git HEAD~1` for git-based diffing (stretch goal).

**Display:** Unchanged sections collapsed by default. Changed sections show inline diff (additions green, deletions red/strikethrough). New sections marked "NEW". Removed sections listed in summary. Browser mode gets richer rendering; terminal uses chalk coloring.

**Section matching:** Match by section ID (plan mode) or heading text (generic mode). Unmatched = added/removed. Matched = body-level line diff.

**Effort:** ~1-2 days.

---

## AI Chat During Review

During review, the human can open an AI conversation about any section — ask questions, request changes, discuss tradeoffs. AI is reactive (human-initiated), not proactive.

**Activation:** `plan-review plan.md --browser --ai` flag enables AI chat. Without it, no AI features appear.

**Session lifecycle:**
1. Human clicks "Ask AI" on a section (browser) or types `?` (terminal)
2. First time: prompt "Start new Claude session? This will spawn a `claude` process with full plan context. [y/n]"
3. On yes: spawn `claude` CLI with a bootstrap prompt that instructs it to research the codebase and internalize the plan
4. Subsequent "Ask AI" clicks reuse the same session (conversation continuity)
5. Session persists until review is submitted or explicitly closed

**Bootstrap prompt:**
- Loaded from a template file (not hardcoded): `templates/ai-review-prompt.md`
- Template receives variables: `{{plan_content}}`, `{{plan_file_path}}`, `{{current_section_id}}`, `{{current_section_heading}}`
- Default template instructs Claude to: read the plan, research the codebase for relevant files/patterns, understand the project structure, then wait for the human's questions
- User can override with `--ai-prompt-template path/to/custom.md`

**Key design:**
- Uses Claude Code CLI (`claude`) as the backend — no API key needed, piggybacks on existing auth
- Bootstrap prompt gives AI proper codebase context before any human question arrives
- Conversation is continuous — AI accumulates context across questions about different sections
- Human can capture useful AI responses as review comments ("save as comment") or discard
- When human navigates to a new section and asks AI, the section context is sent as a follow-up message in the existing session

**Architecture:**
- `claude` CLI spawned via `child_process.spawn` in interactive mode
- Bootstrap prompt piped as first message, includes full plan + codebase research instructions
- Browser mode: WebSocket or polling for streaming responses back to chat panel UI
- Terminal mode: inherit stdio for natural conversation flow
- Template loaded at startup, validated for required `{{plan_content}}` variable

**Effort:** ~3-5 days. CLI spawn and template loading are simple. Browser streaming UX and session management are the complex parts.

---

## Other Ideas (Parking Lot)

- **Comment templates / quick reactions** — `+1`, `blocking`, `question` tags on comments
- **Keyboard shortcuts in browser** — `j`/`k` nav, `c` comment, `Cmd+Enter` submit
- **Dependency graph visualization** — DAG of task dependencies in browser mode
- **Export to GitHub PR comment** — formatted review as collapsible PR comment
- **Review scoring** — per-section approve/needs-work/blocking with dashboard
