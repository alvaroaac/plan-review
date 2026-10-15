---
name: plan-review
description: Use when the user asks to review a plan, start plan review, or says "I want to review this plan", and when drafting a spec or implementation plan that still has open design choices. Triggers on plan review requests for markdown implementation plans, specs, or design docs — including plans produced on-the-fly in this conversation. Runs the plan-review browser UI, feeds the review back into the conversation, and continues the same review across revisions.
---

# Plan Review

Open a markdown plan in the plan-review browser UI. The user answers your open decisions, checks your assumptions and comments on the text. The review comes back on stdout. A review can run over several rounds: you revise the plan and continue the same review until the user approves.

Two input sources:
- **File branch:** a plan file on disk (a path the user gave, or the one recent match in `docs/superpowers/plans/*.md`). If there are several candidates, ask which one.
- **Inline branch:** a plan written in this conversation, or markdown the user pasted. Pipe it in on stdin; no temp file needed.

## Drafting specs and plans with open decisions

When you write a spec or plan whose design still has real choices to make, settle purpose and scope in chat first, then write the document as a draft and ask the open choices in it instead of one at a time in chat:
- Make the document complete around your recommended option, and add a `decision` block (with `[pick]` on that option) where each open choice comes up. Use an `assumption` block for anything you have not verified.
- Ask only what the user must decide: choices with real trade-offs. Aim for 3–7 items per round; settle the rest yourself and say so in the text.
- Run the review (section 2). Apply the answers, then continue the same review with `--review <id>` until it is approved. An approved review is the user's approval of the document.

## Prerequisites

Either the `plan-review` CLI is on `$PATH` (`npm install -g plan-review`) or a dev checkout exists at `~/desenv/personal/plan-review/`.

```bash
if command -v plan-review >/dev/null 2>&1; then
  PLAN_REVIEW_CMD="plan-review"
else
  if [ ! -f ~/desenv/personal/plan-review/packages/cli/dist/index.js ]; then
    (cd ~/desenv/personal/plan-review && npm run build)
  fi
  PLAN_REVIEW_CMD="node $HOME/desenv/personal/plan-review/packages/cli/dist/index.js"
fi
```

## 1. Mark decisions and assumptions in the plan

If the plan has open choices or things you have not verified, put them in fenced blocks where they come up. Each block becomes an item the user answers. Leave out blocks for things you have already settled.

````md
```decision id=retry-backoff
label: Retry backoff
question: How should token refresh retries back off when the auth server is slow?
quote: how token refresh retries back off
context: The Aug 14 incident was caused by unbounded retries.
- A: Exponential backoff, capped at 5 s | Simple; invisible to client [pick]
- B: Circuit breaker after 90 s of failures | Needs a health probe
```

```assumption id=subtlecrypto
label: Browser crypto support
statement: Every supported browser exposes SubtleCrypto for S256.
quote: every supported browser exposes SubtleCrypto
context: Based on browserslist in package.json.
```
````

Rules:
- `id` is required: lowercase letters, digits and `-`, unique in the plan.
- A `decision` needs a `question` and at least two options. An option line is `- <KEY>: <text> | <detail> [pick]`. KEY is one uppercase letter. `| detail` is optional. Put `[pick]` on at most one option, and only when you have a recommendation.
- An `assumption` needs a `statement`. It has no options; the user answers holds, not sure or doesn't hold.
- `label`, `quote` and `context` are optional, one line each. `quote` is an exact, case-sensitive phrase from the paragraph above the block; the UI highlights it there. If it does not match, the item shows as a chip instead.
- A malformed block shows as a plain code block, with a warning banner in the UI. Check the syntax if the user mentions one.

## 2. Run the review

Browser mode is the default. `-o stdout` sends the result back to this session.

**File branch:**
```bash
$PLAN_REVIEW_CMD <plan-file> -o stdout
```

**Inline branch:** use a quoted heredoc so backticks and `$` pass through unchanged:
```bash
$PLAN_REVIEW_CMD -o stdout <<'PLAN_EOF'
# My Plan
...plan content from this conversation...
PLAN_EOF
```

The command blocks until the user submits or leaves.

## 3. Read the result

There are two outcomes. Both exit 0.

- **Submitted.** Markdown starting with `# Plan Review: <title>`, then the review id, round and verdict (**Changes requested** or **Approved**). It lists decision answers, assumption verdicts, deferred items, and open comment threads with their ids. Summarize it for the user.
- **Paused.** A one-line notice that the review is paused, ending with "The user has not finished reviewing — wait for them" and the resume command. The user closed the tab; everything they did is saved. Tell the user the review is paused and wait. Do not re-run it or change the plan until they ask.

## 4. Revise and continue

When changes are requested, revise the plan and continue the **same** review with `--review <id>`. This opens the next round with the user's answers and threads carried over.

```bash
$PLAN_REVIEW_CMD <plan-file> --review rv_8f3a -o stdout
# inline: pipe the revised plan the same way, adding --review rv_8f3a
```

While revising:
- **Keep item ids stable.** Answers are matched by id. If you edit an item's text, it reopens for the user with their previous answer shown. If you remove an item, its answer is hidden.
- Apply the answers to the plan. Keep answered blocks in place so the user still sees past decisions in later rounds.
- Leave deferred items unchanged unless you resolve them.
- Answer comment threads with `reply` blocks, using the thread id from the output. They appear in the thread, not in the plan. A reply to a resolved thread reopens it. A reply to an unknown thread id is ignored, with a warning.

````md
```reply thread=t_4k2
Reworded to "never exposed to the browser".
```
````

## Notes

- For a file, running without `--review` resumes the open review for that file, or starts one. Use `--fresh` to start a new review instead; the old review stays open, not closed. `--fresh` cannot be combined with `--review`.
- For an inline plan, only `--review <id>` continues a review. Without it, every run starts a new one.
- An approved review is closed. `--review` on it fails; start a new review without the flag. Deferred items in an approved review are still open, so track them during implementation.
- `plan-review list` shows open reviews with their ids. `list --all` includes approved ones.
- Pass `--cli` only for SSH, CI or headless environments. Terminal mode shows the blocks as text but cannot answer them.
