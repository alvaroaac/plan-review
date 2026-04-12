# Tech Debt

No known tech debt. All items resolved as of 2026-04-12.

## Resolved

- **Code fence parsing bug** — fixed. Parser now tracks `inCodeBlock` state, skips heading/field matching inside fences.
- **`sendToClaude` spawn error handler** — fixed. Falls back to stdout on spawn error.
- **Windows portability** — intentionally skipped. macOS/Linux only.
