# ultra-review — handoff bundle

This folder is the entire artefact bundle for designing, planning, and (eventually) executing the `ultra-review` Claude Code plugin. Zip it, ship it to another machine, unzip it — everything plan-writing needs is inside.

## Contents

| File | Purpose |
|---|---|
| `design-spec.md` | The full design spec. Single source of truth for what gets built. |
| `design-spec.html` | Same spec, rendered as a styled standalone HTML doc (TOC sidebar, copyable code blocks). |
| `plan-prompts.html` | Five copyable prompts — one per implementation plan. **Start here on the target machine.** |
| `manual-playbook.html` | Step-by-step guide for running the review manually (human-as-orchestrator) before the engine is built. |
| `handoff.html` | Legacy single-prompt handoff card. Superseded by `plan-prompts.html`. |
| `plans/0{1..5}-*.md` | The five implementation plans, written by `plan-prompts.html` on the target machine. Empty until those sessions run. |

## Workflow on the target machine

1. Unzip this folder anywhere. Open Claude Code with that folder as cwd (or just have it accessible).
2. Open `plan-prompts.html` in a browser.
3. Spawn **five fresh Claude Code sessions**. Paste one prompt into each. They write the five plans in parallel.
4. Each session writes its plan to `plans/0N-<slug>.md` in this folder.
5. Once all five plan files exist, separate execution sessions consume them:
   - Plan 1 (Foundation) runs **first** — sequential gate. Scaffolds `plugins/ultra-review/` under the host repo.
   - Plans 2/3/4 (Tracks A/B/C) run **in parallel** after Plan 1 lands.
   - Plan 5 (Merge) runs **last** — sequential, merges the three tracks.

## Target scaffold location

All implementation work scaffolds into **`plugins/ultra-review/`** (relative to whatever host repo the target machine has). The plugin lives as a sub-directory; it does not require a new top-level repo.

See §3 (distribution) and §18d (five-plan execution model) in `design-spec.md` for full details.
