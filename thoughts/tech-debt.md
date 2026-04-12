# Tech Debt

---

## Bug: Parser treats code block content as real sections

**Severity:** High — breaks parsing of any plan that embeds markdown examples in fenced code blocks.

**Symptom:** Plan documents with embedded fixture markdown (e.g. ` ```markdown ... ``` `) produce spurious sections. Headings and plan fields inside code fences are parsed as real content.

**Root cause:** `splitByHeadings()`, `parsePlan()`, and `isPlanDocument()` in `src/parser.ts` scan raw lines without tracking fenced code block state. A `## Heading` inside ` ``` ` fences is treated identically to a real heading.

**Suggested fix:** Fence-aware line scanning. Track `inCodeBlock` boolean while iterating:

```ts
let inCodeBlock = false;
for (const line of lines) {
  if (line.startsWith('```')) {
    inCodeBlock = !inCodeBlock;
    currentBody.push(line); // preserve in body
    continue;
  }
  if (inCodeBlock) {
    currentBody.push(line);
    continue;
  }
  // ... existing heading/field matching logic
}
```

Apply same fence tracking to:
- `splitByHeadings()` — heading detection loop
- `parsePlan()` — H2/H3 matching loop
- `isPlanDocument()` — plan field regex tests (pre-strip fenced blocks before testing)

**Why not pre-strip:** Stripping code blocks before parsing would lose them from section body content. Fence-aware scanning preserves code blocks in rendered output while ignoring their structure for splitting.

**Tests needed:**
- Plan document with `## Heading` inside a fenced code block — should NOT create a section
- Plan document with `**Depends On:**` inside a fenced code block — should NOT trigger plan mode detection
- Nested/unclosed fences edge cases

---

## Minor: `isClaudeAvailable()` not portable to Windows

`src/output.ts` line 89 uses `which claude` — fails on Windows (`where` is the equivalent). Inconsistent since clipboard handling already supports `win32`.

**Fix:** Use `which` on posix, `where` on win32.

---

## Minor: `sendToClaude` no spawn error handler

`src/output.ts` — `spawn('claude', ...)` has no `child.on('error', ...)`. If claude process fails, parent doesn't know.

**Fix:** Add error handler, log warning, fall back to stdout.
