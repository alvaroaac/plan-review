---
name: plan-review
description: Use when the user asks to review a plan, start plan review, or says "I want to review this plan". Triggers on plan review requests for markdown implementation plans, specs, or design docs. Builds and runs the plan-review browser UI, feeds review output back into the conversation.
---

# Plan Review

Launch the plan-review browser UI for interactive review of markdown plans, then feed the structured review output back into this session.

## Prerequisites

Either the `plan-review` CLI is on `$PATH` (installed via `npm install -g plan-review`) or a local dev checkout exists at `~/desenv/personal/plan-review/`.

## Process

1. **Identify the plan file.** If the user specified a file, use it. If not, look for the most recent file matching `docs/superpowers/plans/*.md` in the current working directory. If multiple candidates exist, ask which one.

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

3. **Run the review.** Launch in browser mode with stdout output:
   ```bash
   $PLAN_REVIEW_CMD <plan-file> --browser -o stdout
   ```
   This opens the browser review UI. The command blocks until the user submits their review, then prints structured review output to stdout.

4. **Read the output.** The review output is structured markdown with the user's comments anchored to specific sections. Read it and present a summary to the user.

5. **Act on feedback.** Ask the user what they want to do with the review:
   - Address the comments (modify the plan or code)
   - Save the review to a file
   - Continue discussion about specific comments

## Important

- The `--browser` flag opens a three-panel review UI (TOC + content + comments).
- The `-o stdout` flag ensures the review output comes back to this session.
- The command will block until the user clicks "Submit Review" in the browser.
- If the user has an existing session for this plan, they'll be prompted to resume.
- Use `--fresh` flag if the user explicitly wants to start a clean review.
