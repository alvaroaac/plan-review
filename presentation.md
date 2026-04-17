---
marp: true
theme: uncover
class: invert
paginate: true
style: |
  section { font-size: 30px; }
  blockquote { font-style: italic; border-left: 4px solid #00adb5; padding-left: 16px; color: #a0a0a0; }
  h1 { color: #00adb5; }
  em { color: #00adb5; }
  code { background: #16213e; }
---

# plan-review

*Code review UX. For the documents AI writes.*

<br>

Alvaro Carvalho
github.com/alvaroaac/plan-review

---

## We stopped writing code first

AI drafts the plan. You review it. Then the code.

The plan is the new source of truth — and we review it by *scrolling*.

> We gave code reviews real tooling.
> Markdown got Ctrl+F.

---

## plan-review

Line-anchored comments. Structured output. Pipes back to the AI that wrote it.

```bash
npm install -g plan-review
plan-review plan.md --browser -o claude
```

*The review becomes part of the conversation.*

---

## Or just ask Claude

Ships as a Claude Code skill. Mid-session:

> *"I want to review this plan"*

Claude opens plan-review, you comment, structured feedback lands back in the chat. No copy-paste.

---

# Demo

---

## Try it

```bash
npm install -g plan-review

plan-review plan.md              # terminal
plan-review plan.md --browser    # browser
plan-review plan.md -o claude    # loop to AI
```

**github.com/alvaroaac/plan-review**

> *Stop scrolling. Start reviewing.*
