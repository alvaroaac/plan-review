---
name: plan-review
description: Use when the user asks to review a plan, start plan review, or says "I want to review this plan". Triggers on plan review requests for markdown implementation plans, specs, or design docs — including plans produced on-the-fly in this conversation. Builds and runs the plan-review browser UI, feeds review output back into the conversation.
---

# Plan Review

Launch the plan-review browser UI for interactive review of markdown plans, then feed the structured review output back into this session.

Works with two input sources:
- **A plan file on disk** (path given by the user, or the most recent plan file in the project).
- **An on-the-fly plan** produced in this conversation (e.g. from plan mode, or markdown the user just pasted). The plan content is piped in via stdin — no temp file needed.

## Prerequisites

Either the `plan-review` CLI is on `$PATH` (installed via `npm install -g plan-review`) or a local dev checkout exists at `~/desenv/personal/plan-review/`.

## Process

1. **Identify the plan source.** Decide which branch you're in:
   - **File branch** — the user named a file, or pointed at a path, or asked to review "the plan at X". Also the default when you find a single recent match in `docs/superpowers/plans/*.md`. If multiple candidates exist, ask which one.
   - **Inline branch** — the user asks to review "this plan" / "the plan above" / "the plan you just wrote" / pastes markdown, or plan mode just produced a plan in the conversation. No file path exists.

2. **Pick the binary.** Prefer the installed CLI; fall back to the local dev build.
   ```bash
   if command -v plan-review >/dev/null 2>&1; then
     PLAN_REVIEW_CMD="plan-review"
   else
     # Dev fallback: build if dist missing
     if [ ! -f ~/desenv/personal/plan-review/dist/index.js ]; then
       (cd ~/desenv/personal/plan-review && npm run build)
     fi
     PLAN_REVIEW_CMD="node $HOME/desenv/personal/plan-review/dist/index.js"
   fi
   ```

3. **Run the review.** Browser mode is the default — no flag needed.

   **File branch:**
   ```bash
   $PLAN_REVIEW_CMD <plan-file> -o stdout
   ```

   **Inline branch** — pipe the plan content via a quoted heredoc so markdown is passed through verbatim (no shell expansion, no escaping needed):
   ```bash
   $PLAN_REVIEW_CMD -o stdout <<'PLAN_EOF'
   # My Plan

   ## Section 1
   ...plan content from this conversation...
   PLAN_EOF
   ```

   Both variants open the browser review UI and block until the user clicks "Submit Review", then print structured review output to stdout.

4. **Read the output.** The review output is structured markdown with the user's comments anchored to specific sections. Read it and present a summary to the user.

5. **Act on feedback.** Ask the user what they want to do with the review:
   - Address the comments (modify the plan or code)
   - Save the review to a file
   - Continue discussion about specific comments

## Important

- Browser mode (three-panel TOC + content + comments UI) is the default — no flag needed. Pass `--cli` only for SSH/CI/headless environments.
- The `-o stdout` flag ensures the review output comes back to this session.
- The command will block until the user clicks "Submit Review" in the browser.
- **File branch only:** if a session exists for this plan, the user is prompted to resume. Use `--fresh` to skip.
- **Inline branch:** there is no file anchor, so no session resume — the review is ephemeral.
- Always use a **quoted** heredoc delimiter (`<<'PLAN_EOF'`) so backticks, `$`, and other shell metacharacters in the plan are left alone.
