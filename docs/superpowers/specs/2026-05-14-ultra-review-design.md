# ultra-review — Design Spec

**Date:** 2026-05-14
**Status:** Approved design, pending implementation plan
**Repo (target):** `alvaroaac/ultra-review` (to be created, MIT, public)
**Working copy:** `~/desenv/personal/ultra-review/`

This spec defines `ultra-review`, an in-house Claude Code plugin that performs a multi-agent deep code review of a branch and produces a single self-contained HTML report (plus an optional simpler markdown digest).

> **Note on artifact density.** This spec deliberately over-includes literal code, config, and prompt scaffolding so an implementer can build the pattern without needing the sibling `plan-review` repo as a source-of-truth reference. Patterns (build.mjs, dispatch idiom, monorepo layout, skill manifest) are reused from `plan-review` but re-stated here in full. Cross-links to `plan-review` files exist only as historical backup pointers, not as required reading.

---

## 1. Goal

When the user runs `/ultra-review` inside Claude Code, the plugin:

1. Inspects the current branch's diff vs. `main` (or the user-specified base).
2. Spins up multiple reviewer agents with **different role × depth × slice** context, in parallel.
3. Synthesises their findings through a senior reviewer pass with extended thinking.
4. Emits a self-contained HTML report (V4 "Glass" aesthetic) and a markdown digest piped back into the host Claude Code session.
5. Optionally re-runs the review on demand against an updated branch.

The bar: **above excellent**. Token use is not the constraint; comprehensiveness and signal density are. A run can take minutes and burn meaningful credit — that's the explicit tradeoff vs. casual `/review`-style skills.

---

## 2. Non-Goals (Phase 1)

These are explicitly deferred so the demo lands fast:

- **Callers / call-graph inference.** No per-finding "who calls this" analysis.
- **Verifier reviewer.** No dedicated agent that re-runs tests, type checks, builds.
- **Cross-cutting grep slice.** No reviewer dedicated to "search the rest of the repo for similar patterns".
- **PR mode.** No `--pr <num>` flag; only local branches.
- **`--diff` mode.** No arbitrary commit-range review.
- **Arch-map caching.** Triage runs fresh every invocation.
- **MCP integration.** Plugin runs locally via `@anthropic-ai/claude-agent-sdk`.
- **Streaming UI.** Progress prints to stderr, but no live HTML refresh.

Tech-debt list (kept in the repo's `TECH_DEBT.md`):

- Capture wall-clock time per stage and total, surface in HTML meta strip.
- Capture reviewer count + skipped-reviewer rationale, surface in HTML meta strip.
- Per-stage token + cost telemetry surfaced in HTML.
- Cache `arch-map.json` per repo SHA.

(The HTML aesthetic already has slots for time + reviewer count; the implementation should wire the easy ones in v1 and explicitly punt the rest to TECH_DEBT.)

---

## 3. Distribution Model

- **Claude Code plugin** layout (B2 from brainstorming): a top-level `.claude-plugin/plugin.json`, plus a custom slash command (`commands/ultra-review.md`) and a skill (`skills/ultra-review/SKILL.md`).
- The plugin invokes a bundled `ultra-review` CLI binary built via esbuild (single ESM file with shebang).
- The CLI uses `@anthropic-ai/claude-agent-sdk` to fan out reviewer agents.
- Code-orchestrated (not pure prompt-orchestrated): the orchestration loop is TypeScript code, agents are spawned with constrained prompts + tool allow-lists.

---

## 4. Reviewer Differentiation: Role × Depth × Slice

Each reviewer agent gets a **distinct triple** along three independent axes:

| Axis | Values | Effect |
|---|---|---|
| **Role** | `security` · `correctness` · `architecture` · `dx-readability` | Prompted persona + finding category bias |
| **Depth** | `surface` · `deep` | `surface` reads only the diff; `deep` reads diff + N immediate dependencies and dependents |
| **Slice** | `feature-area` · `boundary-changes` · `risk-hotspots` | Determines which files from the diff this reviewer focuses on |

Phase 1 ships **4 reviewers**, picked deterministically by a tiny LLM-driven triage step:

```
Reviewer 1: security      · deep    · risk-hotspots
Reviewer 2: correctness   · deep    · feature-area
Reviewer 3: architecture  · surface · boundary-changes
Reviewer 4: dx-readability · surface · feature-area
```

The triage step's only job is to pick which 4 triples make sense given the diff (e.g. a docs-only PR drops security; an auth PR keeps both correctness and security deep). It is the **only** LLM call before the parallel reviewer fan-out.

> **Why differentiation matters.** Four reviewers with the same context produce four versions of the same review. Different role × depth × slice means each agent sees a deliberately different subset of the world and is biased toward different finding categories, so the senior synthesis stage gets a true diversity of inputs to dedupe.

---

## 5. Pipeline

```
┌──────────────┐   ┌─────────────────┐   ┌────────────────────┐
│  triage LLM  │ → │ context bundler │ → │ reviewer agents ×4 │
│  (which 4?)  │   │ (deterministic) │   │     (parallel)     │
└──────────────┘   └─────────────────┘   └─────────┬──────────┘
                                                   │
                              ┌────────────────────┘
                              ▼
                ┌─────────────────────────┐   ┌──────────────────┐
                │ senior synthesis        │ → │ formatter agent  │
                │ (extended thinking)     │   │ (HTML + MD)      │
                └─────────────────────────┘   └──────────────────┘
```

LLM calls per run: **7** (1 triage + 4 reviewers + 1 senior + 1 formatter).

**Lanes (deterministic vs. LLM):**

- Deterministic: arg parsing, `git` introspection, diff splitting, context bundle assembly, HTML rendering, stdout digest.
- LLM: triage, reviewer reviews, senior synthesis, formatter.

The bundler is deliberately deterministic — not LLM-driven — so reviewer context is reproducible and debuggable.

---

## 6. Repo Layout

```
ultra-review/
├── .claude-plugin/
│   └── plugin.json
├── .gitignore
├── LICENSE                         # MIT
├── README.md
├── TECH_DEBT.md
├── commands/
│   └── ultra-review.md             # custom slash command
├── skills/
│   └── ultra-review/
│       └── SKILL.md
├── package.json                    # monorepo root
├── tsconfig.json                   # root project references
├── vitest.config.ts                # optional shared
├── scripts/
│   ├── build.sh
│   └── publish-cli.sh
└── packages/
    ├── core/                       # types, pure functions, formatters
    ├── agents/                     # reviewer/senior/triage/formatter wrappers
    ├── context/                    # git introspection + bundle assembler
    ├── prompts/                    # versioned markdown prompts
    ├── report-template/            # V4 Glass HTML/CSS/JS
    ├── orchestrator/               # pipeline driver
    └── cli/                        # commander entry, bundled binary
```

Build order (dependency-resolved):

```
core → prompts → report-template → context → agents → orchestrator → cli
```

---

## 7. Literal Pattern Artifacts

These files are reproduced in full so the implementer doesn't need `plan-review` open.

### 7.1 `.gitignore`

```gitignore
node_modules/
dist/
*.js.map
*.tsbuildinfo
.DS_Store
coverage/
thoughts/
.superpowers/
.worktrees/
.ultra-review/
```

> Includes `.ultra-review/` — that is the per-repo run dir where reports are written (e.g. `.ultra-review/2026-05-14T12-03-00/report.html`). The CLI auto-creates and auto-`.gitignore`s it on first run if the user is inside a git repo and the entry is missing.

### 7.2 Root `package.json`

```json
{
  "name": "ultra-review-monorepo",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "bash scripts/build.sh",
    "test": "npm run test -ws --if-present",
    "typecheck": "npm run typecheck -ws --if-present",
    "dev": "npm run dev -w ultra-review"
  }
}
```

### 7.3 Root `tsconfig.json`

```json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/prompts" },
    { "path": "./packages/report-template" },
    { "path": "./packages/context" },
    { "path": "./packages/agents" },
    { "path": "./packages/orchestrator" },
    { "path": "./packages/cli" }
  ]
}
```

### 7.4 `scripts/build.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# Build all packages in dependency order:
#   core → prompts → report-template → context → agents → orchestrator → cli

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

packages=(
  "@ultra-review/core"
  "@ultra-review/prompts"
  "@ultra-review/report-template"
  "@ultra-review/context"
  "@ultra-review/agents"
  "@ultra-review/orchestrator"
  "ultra-review"
)

for pkg in "${packages[@]}"; do
  echo "── building $pkg"
  npm run build -w "$pkg"
done

echo "── all packages built"
```

### 7.5 `scripts/publish-cli.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/publish-cli.sh [patch|minor|major|<version>]
# Bumps packages/cli, builds (bundles workspace deps inline), strips workspace deps, publishes.

BUMP="${1:-patch}"
shift || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/packages/cli"

if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "error: working tree dirty — commit or stash first" >&2
  exit 1
fi

cd "$ROOT"
npm run build

cd "$CLI"
npm version "$BUMP" --no-git-tag-version
npm run build

cd "$ROOT"
git add packages/cli/package.json package-lock.json
VER="$(node -p "require('$CLI/package.json').version")"
git commit -m "v${VER}"
git tag "v${VER}"
cd "$CLI"

# Strip workspace-only deps before publish, restore after.
cp package.json package.json.bak
trap 'mv package.json.bak package.json' EXIT
for dep in @ultra-review/core @ultra-review/prompts @ultra-review/report-template \
           @ultra-review/context @ultra-review/agents @ultra-review/orchestrator; do
  npm pkg delete "dependencies.${dep}"
done

npm publish "$@"

trap - EXIT
mv package.json.bak package.json

cd "$ROOT"
git push --follow-tags
echo "published ultra-review@$(node -p "require('$CLI/package.json').version")"
```

### 7.6 `packages/cli/build.mjs`

```javascript
import * as esbuild from 'esbuild';
import { mkdirSync, cpSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

// Inline all workspace deps; keep external everything else (anthropic SDK, etc.).
const workspaceDeps = new Set([
  '@ultra-review/core',
  '@ultra-review/prompts',
  '@ultra-review/report-template',
  '@ultra-review/context',
  '@ultra-review/agents',
  '@ultra-review/orchestrator',
]);
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !workspaceDeps.has(d));

await esbuild.build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  outfile: join(dist, 'index.js'),
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external,
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
  minify: !watch,
});

// Copy the HTML/CSS/JS template assets so the CLI can render reports from `dist/`.
const tmpl = join(root, '../report-template/dist');
if (!existsSync(tmpl)) {
  console.error('[build] report-template dist missing — build it first.');
  process.exit(1);
}
cpSync(tmpl, join(dist, 'template'), { recursive: true });

console.error('[build] cli build complete');
```

### 7.7 `packages/cli/package.json`

```json
{
  "name": "ultra-review",
  "version": "0.0.1",
  "description": "Multi-agent deep code review for Claude Code",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "ultra-review": "dist/index.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "node build.mjs",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": ""
  },
  "keywords": [
    "code-review",
    "claude",
    "claude-code",
    "ai"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/alvaroaac/ultra-review.git",
    "directory": "packages/cli"
  },
  "homepage": "https://github.com/alvaroaac/ultra-review#readme",
  "bugs": {
    "url": "https://github.com/alvaroaac/ultra-review/issues"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "*",
    "@ultra-review/agents": "*",
    "@ultra-review/context": "*",
    "@ultra-review/core": "*",
    "@ultra-review/orchestrator": "*",
    "@ultra-review/prompts": "*",
    "@ultra-review/report-template": "*",
    "chalk": "^5.6.2",
    "commander": "^14.0.3"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "esbuild": "^0.28.0",
    "tsx": "^4.21.0",
    "typescript": "^6.0.2",
    "vitest": "^4.1.4"
  }
}
```

### 7.8 Per-package `tsconfig.json` (cli example)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "strict": true,
    "composite": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"],
  "references": [
    { "path": "../core" },
    { "path": "../prompts" },
    { "path": "../report-template" },
    { "path": "../context" },
    { "path": "../agents" },
    { "path": "../orchestrator" }
  ]
}
```

Library packages (no `references` to siblings other than what they actually import) use the same shape with `declarationMap: true` and only the `references` they need:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "composite": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

### 7.9 `vitest.config.ts` template (per package)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

### 7.10 `.claude-plugin/plugin.json`

```json
{
  "name": "ultra-review",
  "version": "0.0.1",
  "description": "Multi-agent deep code review with a polished HTML report",
  "author": "Alvaro Carvalho",
  "license": "MIT",
  "commands": [
    "commands/ultra-review.md"
  ],
  "skills": [
    "skills/ultra-review/SKILL.md"
  ]
}
```

### 7.11 `commands/ultra-review.md`

```markdown
---
name: ultra-review
description: Multi-agent deep code review of the current branch (vs. main by default). Produces a self-contained HTML report and an inline markdown digest.
---

Run a multi-agent deep review of the current branch.

## Steps

1. **Pick the binary.** Prefer the installed CLI; fall back to the local dev build at `~/desenv/personal/ultra-review/`.

   ```bash
   if command -v ultra-review >/dev/null 2>&1; then
     ULTRA_REVIEW_CMD="ultra-review"
   else
     if [ ! -f ~/desenv/personal/ultra-review/packages/cli/dist/index.js ]; then
       (cd ~/desenv/personal/ultra-review && npm run build)
     fi
     ULTRA_REVIEW_CMD="node $HOME/desenv/personal/ultra-review/packages/cli/dist/index.js"
   fi
   ```

2. **Run.** From the repo the user wants reviewed:

   ```bash
   $ULTRA_REVIEW_CMD --base main -o stdout
   ```

   The CLI:
   - Resolves the diff vs. `--base` (default: `main`).
   - Spins up the triage + 4 reviewers + senior + formatter pipeline.
   - Writes the HTML report to `.ultra-review/<timestamp>/report.html`.
   - Prints a structured markdown digest to stdout for this session.
   - Opens the HTML in the user's browser (best-effort — `open` on macOS, `xdg-open` on Linux).

3. **Summarise.** Read the stdout digest and present the top findings to the user. Mention the HTML path.

4. **Follow-up.** Ask whether the user wants to address findings, save the report somewhere, or re-run.
```

### 7.12 `skills/ultra-review/SKILL.md`

```markdown
---
name: ultra-review
description: Use when the user asks for a deep code review, an "ultra review", a "bug-hunt branch" pass, a "comprehensive review", or otherwise wants more than a quick `/review`-style sanity check. Triggers on phrases like "ultra review", "deep review", "review the branch in depth", "thorough code review".
---

# Ultra Review

Multi-agent deep code review of the current branch. Spins up role-differentiated reviewers in parallel, synthesises through a senior pass with extended thinking, and emits a self-contained HTML report plus an inline markdown digest.

## Prerequisites

Either the `ultra-review` CLI is on `$PATH` (`npm install -g ultra-review`) or a local dev checkout exists at `~/desenv/personal/ultra-review/`.

## Process

1. **Identify the target branch.** Default: the user's current branch vs. `main`. If they specify a different base, pass `--base <ref>`.

2. **Pick the binary.** Prefer installed CLI; fall back to local dev build.

   ```bash
   if command -v ultra-review >/dev/null 2>&1; then
     ULTRA_REVIEW_CMD="ultra-review"
   else
     if [ ! -f ~/desenv/personal/ultra-review/packages/cli/dist/index.js ]; then
       (cd ~/desenv/personal/ultra-review && npm run build)
     fi
     ULTRA_REVIEW_CMD="node $HOME/desenv/personal/ultra-review/packages/cli/dist/index.js"
   fi
   ```

3. **Run.**

   ```bash
   $ULTRA_REVIEW_CMD --base main -o stdout
   ```

4. **Read the stdout digest.** It is structured markdown with the top findings, file-anchored. Present a summary to the user with the path to the full HTML report.

5. **Act on feedback.** Ask the user what they want to do:
   - Address specific findings (modify code).
   - Save the report somewhere persistent.
   - Re-run after fixes.

## Important

- Runs are **not cheap**: 7 LLM calls including one with extended thinking. Warn the user once if you're auto-invoking on a large diff.
- The HTML report is self-contained (no external CSS/JS/fonts beyond system stack) so it works offline and can be shared as a single file.
- `--base` accepts any git ref (branch, tag, commit SHA).
- The CLI auto-creates `.ultra-review/` in the repo root and appends it to `.gitignore` if missing.
```

---

## 8. Type Definitions (`@ultra-review/core`)

```typescript
// packages/core/src/types.ts

export type Role = 'security' | 'correctness' | 'architecture' | 'dx-readability';
export type Depth = 'surface' | 'deep';
export type Slice = 'feature-area' | 'boundary-changes' | 'risk-hotspots';

export type Severity = 'critical' | 'major' | 'minor' | 'nit';

/** What triage emits per reviewer — no file selection yet. */
export interface ReviewerTriple {
  id: string;                  // e.g. "R1"
  role: Role;
  depth: Depth;
  slice: Slice;
}

/** Triple after the deterministic slicer has resolved scopedFiles. */
export interface ReviewerSpec extends ReviewerTriple {
  /** Files this reviewer is scoped to (subset of the diff). Set by the bundler, not triage. */
  scopedFiles: string[];
}

export interface TriageResult {
  triples: ReviewerTriple[];
  skipped: { triple: ReviewerTriple; reason: string }[];
}

export interface RepoMetadata {
  repoName: string;            // best-effort from `git remote get-url origin`
  baseRef: string;             // e.g. "main"
  headRef: string;             // current branch
  headSha: string;
  baseSha: string;
  /** Total files changed in diff. */
  filesChanged: number;
  /** Lines added / removed across the diff. */
  insertions: number;
  deletions: number;
}

export interface ContextBundle {
  reviewer: ReviewerSpec;
  /** Unified diff scoped to reviewer.scopedFiles. */
  diff: string;
  /** Map of path → file contents (post-change). Always includes scopedFiles. */
  files: Record<string, string>;
  /**
   * For depth=deep: immediate dependencies and dependents of scopedFiles,
   * computed by static `import`/`require` scan. Capped by token budget.
   */
  neighbors?: Record<string, string>;
  /** Repo-level facts every reviewer sees. */
  repo: RepoMetadata;
}

export interface Finding {
  id: string;                  // e.g. "F001"
  reviewerId: string;          // ReviewerSpec.id
  severity: Severity;
  title: string;               // <= 80 chars
  body: string;                // markdown
  file: string;
  startLine: number;
  endLine: number;
  /** Suggested code snippet (markdown fenced) or null. */
  suggestion: string | null;
  /** Tags propagated to the HTML filter chips. */
  tags: string[];
  /** Set by the senior pass. */
  refutedBy?: { reviewerId: string; reason: string } | null;
  /** Set by the senior pass when N reviewers raised the same point. */
  agreedWith?: string[];       // reviewer IDs
}

export interface ReviewerOutput {
  reviewerId: string;
  spec: ReviewerSpec;
  findings: Finding[];
  /** Free-form rationale the reviewer wants the senior to consider. */
  notes: string;
}

export interface SeniorSynthesis {
  /** Deduped, severity-ranked, with agreedWith/refutedBy populated. */
  findings: Finding[];
  /** Human-facing executive summary (markdown). */
  summary: string;
  /** Verdict tag for the report header. */
  verdict: 'block' | 'request-changes' | 'approve-with-nits' | 'approve';
}

export interface RunMetadata {
  startedAt: string;           // ISO
  finishedAt: string;          // ISO
  /** Wall-clock seconds total. Surfaced in HTML meta strip. */
  durationSec: number;
  reviewersRun: number;
  reviewersSkipped: { triple: ReviewerTriple; reason: string }[];
}

export interface RunResult {
  repo: RepoMetadata;
  meta: RunMetadata;
  synthesis: SeniorSynthesis;
  /** Raw outputs kept for debugging; not always rendered. */
  reviewers: ReviewerOutput[];
}
```

---

## 9. Pipeline Pseudo-code (`@ultra-review/orchestrator`)

```typescript
import { runTriage, runReviewer, runSenior, runFormatter } from '@ultra-review/agents';
import { collectRepoMetadata, computeDiff, assembleBundle } from '@ultra-review/context';
import type { RunResult } from '@ultra-review/core';

export async function runUltraReview(opts: {
  cwd: string;
  baseRef: string;
  /** Optional cap. Default 4. */
  maxReviewers?: number;
}): Promise<RunResult> {
  const startedAt = new Date();

  // 1. Deterministic: gather repo + diff facts.
  const repo = await collectRepoMetadata(opts.cwd, opts.baseRef);
  const diff = await computeDiff(opts.cwd, opts.baseRef);

  // 2. LLM call #1: triage — pick reviewer triples (role × depth × slice).
  const triage = await runTriage({ repo, diff });
  const triples = triage.triples.slice(0, opts.maxReviewers ?? 4);

  // 3. Deterministic: resolve scopedFiles per triple, then assemble bundles.
  const bundles = await Promise.all(
    triples.map((t) => assembleBundle({ triple: t, repo, diff, cwd: opts.cwd })),
  );

  // 4. LLM calls #2–5: reviewers in parallel.
  const reviewerOutputs = await Promise.all(bundles.map((b) => runReviewer(b)));

  // 5. LLM call #6: senior synthesis (extended thinking enabled).
  const synthesis = await runSenior({ repo, reviewers: reviewerOutputs });

  const finishedAt = new Date();

  // 6. LLM call #7: formatter — emits HTML + stdout digest.
  //    (The CLI is the layer that actually writes files; orchestrator returns the result.)
  const result: RunResult = {
    repo,
    meta: {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSec: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
      reviewersRun: triples.length,
      reviewersSkipped: triage.skipped,
    },
    synthesis,
    reviewers: reviewerOutputs,
  };

  return result;
}
```

The CLI layer (see §10 for full snippet) then calls the formatter and writes the report:

```typescript
import { runFormatter } from '@ultra-review/agents';
// ...
const result = await runUltraReview({ cwd, baseRef, maxReviewers });
const { html, digest } = await runFormatter(result);
const reportPath = writeReport({ cwd, html });   // local fs helper, see §10
process.stdout.write(digest);
maybeOpenBrowser(reportPath);
```

Note: `runFormatter` is exported from `@ultra-review/agents`, not the orchestrator. Keeping it out of the orchestrator pseudo-code is intentional — the orchestrator returns the pure `RunResult`; rendering is the CLI's responsibility.

---

## 10. CLI Entry (`packages/cli/src/index.ts`)

Follows the `plan-review` pattern: `commander` for arg parsing, fail-fast validation, output target abstraction.

```typescript
import { Command } from 'commander';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';
import chalk from 'chalk';
import { runUltraReview } from '@ultra-review/orchestrator';
import { runFormatter } from '@ultra-review/agents';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();

program
  .name('ultra-review')
  .description('Multi-agent deep code review for Claude Code')
  .version(version)
  .option('--base <ref>', 'Base ref to diff against', 'main')
  .option('-o, --output <target>', 'Output target: stdout, file, claude', 'stdout')
  .option('--max-reviewers <n>', 'Cap reviewer count', (v) => parseInt(v, 10), 4)
  .option('--no-open', 'Do not open the report in the browser')
  .action(async (opts) => {
    try {
      await run(opts);
    } catch (err) {
      if (err instanceof Error) console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program.parse();

async function run(opts: { base: string; output: string; maxReviewers: number; open: boolean }) {
  const cwd = process.cwd();

  // Ensure we're in a git repo.
  if (!existsSync(join(cwd, '.git'))) {
    throw new Error('Not a git repository. ultra-review must run from the repo root.');
  }

  ensureUltraReviewDir(cwd);

  console.error(chalk.dim(`Reviewing branch vs. ${opts.base}…`));
  const result = await runUltraReview({ cwd, baseRef: opts.base, maxReviewers: opts.maxReviewers });

  console.error(chalk.dim(`Formatting report…`));
  const { html, digest } = await runFormatter(result);

  const reportPath = writeReport({ cwd, html });
  console.error(chalk.green(`Report: ${reportPath}`));

  if (opts.output === 'stdout') process.stdout.write(digest);

  if (opts.open) maybeOpenBrowser(reportPath);
}

function writeReport({ cwd, html }: { cwd: string; html: string }): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', 'T').slice(0, 19);
  const dir = join(cwd, '.ultra-review', ts);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'report.html');
  writeFileSync(path, html, 'utf-8');
  return path;
}

function ensureUltraReviewDir(cwd: string) {
  const dir = join(cwd, '.ultra-review');
  mkdirSync(dir, { recursive: true });

  const gi = join(cwd, '.gitignore');
  if (existsSync(gi)) {
    const txt = readFileSync(gi, 'utf-8');
    if (!txt.split('\n').some((l) => l.trim() === '.ultra-review/' || l.trim() === '.ultra-review')) {
      appendFileSync(gi, '\n.ultra-review/\n');
    }
  }
}

function maybeOpenBrowser(path: string) {
  const cmd = process.platform === 'darwin' ? `open "${path}"`
            : process.platform === 'win32' ? `start "" "${path}"`
            : `xdg-open "${path}"`;
  exec(cmd, () => { /* best effort */ });
}
```

---

## 11. V4 Glass HTML Design System

The report is a single self-contained HTML file. No external fonts or stylesheets. JS is inlined for clipboard functionality only.

### 11.1 Design tokens (CSS variables)

```css
:root {
  /* palette */
  --bg-0: #0a0a0f;
  --bg-1: #11111a;
  --bg-card: rgba(255,255,255,0.04);
  --bg-card-hover: rgba(255,255,255,0.06);
  --border: rgba(255,255,255,0.08);
  --border-strong: rgba(255,255,255,0.14);
  --text-0: #f5f5fa;
  --text-1: #b8b8c8;
  --text-2: #6e6e80;
  --accent: #7c5cff;
  --accent-2: #5cffd8;
  --critical: #ff5470;
  --major: #ffa05c;
  --minor: #ffd75c;
  --nit: #5cffd8;
  --kbd-bg: rgba(255,255,255,0.06);

  /* radii / spacing / type scale */
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
  --r-xl: 20px;
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px; --s-7: 48px;
  --fs-xs: 11px; --fs-sm: 13px; --fs-md: 15px; --fs-lg: 18px; --fs-xl: 24px; --fs-xxl: 36px;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

body {
  background:
    radial-gradient(800px 600px at 80% -10%, rgba(124,92,255,0.18), transparent 60%),
    radial-gradient(900px 700px at -10% 110%, rgba(92,255,216,0.10), transparent 60%),
    var(--bg-0);
  color: var(--text-0);
  font-family: var(--font-sans);
  font-size: var(--fs-md);
  line-height: 1.55;
  margin: 0;
  min-height: 100vh;
}

.card {
  background: var(--bg-card);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--s-5);
}

.stat-number {
  font-size: var(--fs-xxl);
  font-weight: 600;
  background: linear-gradient(135deg, var(--text-0) 0%, var(--accent) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.kbd {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  background: var(--kbd-bg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 2px 6px;
}
```

### 11.2 Layout primitives

- **Header strip**: repo name (mono), branch → base (mono), verdict badge (pill, color by verdict), run timestamp.
- **Meta strip**: 4-up grid — `Files`, `Diff (+X / -Y)`, `Reviewers (N)`, `Wall-clock (Ns)`.
- **Stat row**: 4-up — `Findings`, `Critical`, `Refuted` (count of senior-refuted reviewer findings), `Agreed` (count of >=2 reviewer agreement).
- **Executive summary** card (markdown rendered).
- **Findings list**: each finding is a `.card` containing:
  - Header row: severity dot, title, file:line range (mono), copy-as-prompt button (top right).
  - Body: markdown.
  - Suggestion: fenced code block, syntax-themed.
  - Footer chips: reviewer ID, tags, agreed-with reviewers, refuted-by note (if any).
- **Reviewer roster** card: 4 rows, role × depth × slice triple, finding count.

### 11.3 Copy-as-prompt JS

Inlined script. Each finding card has a button with `data-copy-prompt`:

```html
<button class="copy-btn" data-copy-prompt aria-label="Copy as LLM prompt">
  Copy <span class="kbd">⌘C</span>
</button>
```

```html
<script>
(() => {
  function formatPrompt(card) {
    const file = card.dataset.file;
    const range = card.dataset.range;
    const title = card.querySelector('.finding-title')?.textContent?.trim() ?? '';
    const body = card.querySelector('.finding-body')?.innerText?.trim() ?? '';
    const suggestion = card.querySelector('.finding-suggestion')?.innerText?.trim() ?? '';
    return [
      `Please address this code review finding in ${file} (${range}).`,
      '',
      `**${title}**`,
      '',
      body,
      suggestion ? `\nSuggested change:\n\n${suggestion}` : '',
    ].filter(Boolean).join('\n');
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy-prompt]');
    if (!btn) return;
    const card = btn.closest('.finding');
    if (!card) return;
    try {
      await navigator.clipboard.writeText(formatPrompt(card));
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    } catch (err) {
      console.error('clipboard write failed', err);
    }
  });
})();
</script>
```

### 11.4 SVG diagrams

The formatter agent generates inline SVG for the executive summary section when warranted. Phase 1: a single "diff hotspot map" (rectangles sized by lines-changed, colored by max severity). Future phases can add flowcharts / sequence diagrams; the formatter prompt explicitly invites them but does not require them.

### 11.5 Filter chips (top of findings list)

- All / Critical / Major / Minor / Nit
- Per-role (Sec / Correct / Arch / DX)
- Click → toggles a CSS class on the list to hide non-matching `.finding` cards. No framework, plain `document.querySelectorAll` + classList.

### 11.6 Markdown digest (stdout)

What the CLI prints to stdout for the host Claude Code session:

```markdown
# ultra-review

**Repo:** alvaroaac/example  **Branch:** feat/rate-limit → main  **Verdict:** request-changes
**Reviewers:** 4  **Wall-clock:** 142s  **Findings:** 6 (1 critical · 2 major · 2 minor · 1 nit)

## Executive summary

Brief, senior-voice synthesis of what changed and what to act on first.
(2–4 paragraphs, markdown.)

## Top findings

### F001 — critical — `src/limiter.ts:42-58`
**Token bucket refills off by one**

The refill computation uses `Math.floor` where it should use `Math.ceil`, which causes
the limiter to lag the wall clock by up to one window and lets a single client double
its quota immediately after a window roll-over.

Suggested change:
```ts
const refill = Math.ceil(elapsedMs / windowMs) * burst;
```

Agreed with: R2 (correctness, deep)

---

### F002 — major — `src/middleware/rate-limit.ts:15-22`
...

(remaining findings, severity-ordered)

## Full report

Open `.ultra-review/2026-05-14T12-03-00/report.html` for the full HTML view (filterable, copy-as-prompt buttons, reviewer roster, SVG hotspot map).
```

The CLI writes this exact shape; the formatter prompt is constrained to emit it.

---

## 12. Per-stage Prompt Templates

Prompts live in `packages/prompts/src/`, each as a versioned markdown file (`triage.v1.md`, etc.) loaded at runtime. Versioning makes it trivial to A/B prompt revisions without rebuilding.

### 12.1 `triage.v1.md`

```markdown
You are the **triage** stage of an ultra-review pipeline. Your only job is to decide
which reviewer specs make sense for this diff. The pipeline supports up to 4 reviewers,
chosen from the cartesian product of:

- Role: security · correctness · architecture · dx-readability
- Depth: surface · deep
- Slice: feature-area · boundary-changes · risk-hotspots

Defaults if you have no strong opinion:
1. security · deep · risk-hotspots
2. correctness · deep · feature-area
3. architecture · surface · boundary-changes
4. dx-readability · surface · feature-area

Reduce the count if a role is clearly N/A (e.g. drop security on docs-only diffs).
Never exceed 4. Always include correctness unless the diff has zero executable code.

Inputs:
- Repo metadata: {{repoJson}}
- Diff summary (file list with +/- counts): {{diffSummary}}

Return a JSON object matching the TriageResult schema: `{ triples: ReviewerTriple[], skipped: { triple, reason }[] }`. Do NOT pick files — file selection is handled deterministically downstream based on the chosen `slice`.
```

### 12.2 `reviewer.v1.md`

```markdown
You are reviewer **{{id}}** in a multi-agent code review. Your assigned focus:

- Role: **{{role}}** — bias findings toward this category
- Depth: **{{depth}}** — {{depthExplanation}}
- Slice: **{{slice}}** — the files in scope below were selected on this basis

Repo: {{repoLine}}

## Files in scope
{{scopedFilesList}}

## Diff
```diff
{{diff}}
```

## Full file contents (post-change)
{{filesBlock}}

{{neighborsBlock}}

## Output

Emit a JSON object matching ReviewerOutput. Constraints:
- Anchor every finding to a file and line range (post-change line numbers).
- One finding per issue; do not merge unrelated issues.
- Severity: critical (correctness/security blocker) · major (real bug or design flaw)
  · minor (smell or risk) · nit (style).
- Title: ≤ 80 chars, declarative.
- Body: 2–6 sentences of markdown. Explain the *why*, not just the what.
- Suggestion: include a fenced code block when a concrete change exists; otherwise null.
- Tags: short, lowercase, e.g. ["off-by-one", "race"].
- `notes`: free-form rationale for the senior reviewer (what you couldn't be sure of,
  what you'd recommend the senior probe).
```

### 12.3 `senior.v1.md`

```markdown
You are the **senior reviewer** in an ultra-review pipeline. You receive {{n}}
independent reviews of the same diff, each by a reviewer with a different role × depth
× slice. Your job:

1. **Dedupe.** When ≥2 reviewers raise the same issue, merge into one finding and
   populate `agreedWith` with the contributing reviewer IDs.
2. **Refute.** When a finding is wrong, missing context, or already handled, mark it
   `refutedBy = { reviewerId: "<senior>", reason: "..." }`. Do NOT drop refuted
   findings — keep them so the report shows the disagreement.
3. **Re-rank severity.** Reviewers over-call critical/major. Lower severity when the
   evidence doesn't support it. Raise severity for cross-cutting issues only you can
   see by looking across reviewers.
4. **Synthesise.** Produce a 2–4 paragraph executive summary in your own voice that
   reads like senior engineering review notes — opinionated, specific, no fluff.
5. **Verdict.** Pick exactly one: `block` (critical issue, do not merge),
   `request-changes` (must address before merge), `approve-with-nits` (LGTM after
   nits), `approve` (ship it).

Use extended thinking; this is the highest-leverage stage in the pipeline.

Inputs:
- Repo: {{repoJson}}
- Reviewer outputs: {{reviewerOutputsJson}}

Return a JSON object matching SeniorSynthesis.
```

### 12.4 `formatter.v1.md`

```markdown
You are the **formatter** stage. You receive a RunResult and emit two things:

1. **HTML**: a complete self-contained HTML report. The shell, CSS, and clipboard JS
   are provided in `template.html`. You fill in the `<!-- INSERT:* -->` slots:
   - `INSERT:HEADER` — repo line + verdict badge + timestamp
   - `INSERT:META` — files / diff / reviewers / wall-clock cards
   - `INSERT:STATS` — findings / critical / refuted / agreed
   - `INSERT:SUMMARY` — markdown rendered to HTML
   - `INSERT:DIAGRAM` — inline SVG (diff hotspot map)
   - `INSERT:FINDINGS` — one `.finding` card per finding, in severity order
   - `INSERT:ROSTER` — reviewer roster card

2. **Markdown digest**: matches the shape in §11.6 exactly. The host Claude Code
   session reads this as the inline summary.

Render markdown to HTML conservatively: paragraphs, lists, fenced code, inline code,
bold, italics. No raw HTML passthrough except in code blocks.

Return a JSON object: `{ "html": "<full document>", "digest": "<markdown>" }`.
```

The template HTML (`packages/report-template/src/template.html`) ships the shell with `<!-- INSERT:* -->` sentinels; the formatter only fills slots — it does not invent CSS. This keeps the aesthetic consistent and the formatter prompt small.

---

## 13. Context Bundle Assembly (`@ultra-review/context`)

Deterministic. No LLM.

1. `collectRepoMetadata(cwd, baseRef)` — shells out to `git`:
   - `git remote get-url origin` → repo name
   - `git rev-parse HEAD` → headSha
   - `git rev-parse <baseRef>` → baseSha
   - `git diff --shortstat <base>...HEAD` → insertions/deletions/filesChanged
2. `computeDiff(cwd, baseRef)` — `git diff --unified=8 <base>...HEAD`.
3. `assembleBundle({ triple, repo, diff, cwd })`:
   - Resolve `scopedFiles` for the triple's `slice` (deterministic, see below). The resulting `ReviewerSpec` (triple + scopedFiles) is what the reviewer agent ultimately sees.
   - Slice the diff by `scopedFiles`.
   - Read post-change file contents for each scoped file.
   - For `depth === 'deep'`: parse `import`/`require` statements in scoped files to find immediate neighbors. Cap at ~30k tokens of neighbor content (rough char heuristic for v1).
   - Skip binary files, lockfiles, and anything in `.gitignore`.

The slicer for `spec.scopedFiles` is itself deterministic:

- `feature-area` — files clustered by directory; pick the largest cluster touched by the diff.
- `boundary-changes` — files whose diff touches exported/public symbols (heuristic: lines containing `export` near the change).
- `risk-hotspots` — files with the largest number of changed lines, capped at 5.

The triage LLM only picks the *triple*; it does not pick files. File selection is deterministic per slice. This keeps reviewer scoping reproducible.

---

## 14. Agent Wrappers (`@ultra-review/agents`)

Each stage is a thin wrapper around `@anthropic-ai/claude-agent-sdk`:

- `runTriage(input)` — model: opus, no tools, structured output (JSON).
- `runReviewer(bundle)` — model: opus, tools: `Read` (read-only, sandboxed to repo root), structured output.
- `runSenior(input)` — model: opus, extended thinking enabled, no tools, structured output.
- `runFormatter(result)` — model: sonnet (cheaper, the work is mechanical), no tools, structured output.

Each wrapper loads its versioned prompt from `@ultra-review/prompts`, substitutes placeholders, calls the SDK with `response_format: { type: "json_schema", schema: <ZodToJsonSchema(...)> }` where supported (or with a regex-strict instruction fallback). Errors surface as thrown `AgentError` with the stage name.

---

## 15. Error Handling

- **No commits ahead of base** → exit 0 with a friendly message; no LLM calls made.
- **Anthropic API failure (any stage)** → fail the whole run, print the offending stage, save partial JSON state to `.ultra-review/<ts>/partial.json` for debugging.
- **Reviewer returns malformed JSON** → retry once with stricter system instruction; on second failure, drop that reviewer and continue with the remaining ones. Senior sees one fewer input.
- **Formatter fails** → fall back to a minimal HTML shell (still readable) generated locally without the formatter agent, using the same template but plain markdown rendering. Stdout digest is still emitted.

---

## 16. Testing

- **Unit tests (vitest)** in `packages/context` for slice selection, bundle assembly, neighbor scan.
- **Snapshot tests** in `packages/report-template` for the HTML template rendering (fed fixture `RunResult` objects).
- **End-to-end smoke** in `packages/cli` — runs the binary against a fixture repo with a mocked Anthropic client (canned responses); asserts the HTML and digest are well-formed.

No live API tests in CI. Manual smoke before each `npm publish` from a real branch.

---

## 17. Reference Cross-links

These point to the corresponding `plan-review` files as historical backup only — the literal artifacts above are the source of truth for this spec.

- Monorepo workspaces pattern → `/Users/alvarocarvalho/desenv/personal/plan-review/package.json`
- esbuild bundling → `/Users/alvarocarvalho/desenv/personal/plan-review/packages/cli/build.mjs`
- Build script ordering → `/Users/alvarocarvalho/desenv/personal/plan-review/scripts/build.sh`
- npm publish flow (strip workspace deps) → `/Users/alvarocarvalho/desenv/personal/plan-review/scripts/publish-cli.sh`
- Skill manifest with dispatch idiom → `/Users/alvarocarvalho/desenv/personal/plan-review/skills/plan-review/SKILL.md`
- CLI entry with commander → `/Users/alvarocarvalho/desenv/personal/plan-review/packages/cli/src/index.ts`
- Per-package tsconfig → `/Users/alvarocarvalho/desenv/personal/plan-review/packages/cli/tsconfig.json`

---

## 18. Open Questions (resolved here for the spec, callable out for the plan)

- **Multi-package layering vs. single package.** Resolved: multi-package. The boundaries (context vs. agents vs. orchestrator vs. cli) are real, and the build-order pattern from `plan-review` justifies the layout. If implementation finds this overkill in week 1, we can collapse later — but the spec assumes split.
- **Where prompts live.** Resolved: their own package (`@ultra-review/prompts`). Keeps them versioned, swappable, and independently testable.
- **Whether reviewer agents get `Bash` tool.** Resolved: no. `Read` only. Phase 2 may grant `Bash` to a dedicated verifier reviewer; not in Phase 1.
- **Whether the formatter writes the file or the CLI does.** Resolved: CLI. The formatter returns `{ html, digest }`; the CLI writes them. Keeps the formatter pure.

---

## 19. Phase 1 Acceptance Criteria

The demo is done when:

1. `npm install -g ultra-review && cd <some repo> && ultra-review --base main` works end-to-end from a clean machine.
2. Running on a real branch produces an HTML report at `.ultra-review/<ts>/report.html` that:
   - Renders without horizontal scrolling at 1280px.
   - Has the V4 Glass aesthetic (radial gradients, frosted cards, gradient-clipped stat numbers).
   - Has working copy-as-prompt buttons on every finding.
   - Shows reviewer roster, executive summary, filter chips, and at least one SVG diagram.
3. Running with `-o stdout` (default) prints the markdown digest in the shape of §11.6.
4. `/ultra-review` slash command launches the same flow from inside Claude Code.
5. `~/.claude/plugins/ultra-review/` is installable from the GitHub repo as a plugin.
6. The whole run completes on a 500-LOC diff in under ~5 minutes.

---

## 20. Tech-Debt Carry-list (`TECH_DEBT.md` seeds)

Pre-populate `TECH_DEBT.md` at repo init with:

- Per-stage wall-clock telemetry (currently only total).
- Per-stage token + cost telemetry.
- `arch-map.json` cache keyed by `headSha` for triage.
- Caller / call-graph slice (deferred reviewer).
- Verifier reviewer with `Bash` tool.
- Cross-cutting grep slice.
- `--pr <num>` mode.
- `--diff <range>` mode.
- Live-refresh HTML during run.
- Reviewer skip rationale surfaced in HTML meta strip.
