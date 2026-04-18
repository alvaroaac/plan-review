import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Playwright global setup: rebuild the FULL dist tree before running the
// visual suite.
//
// Why full build, not just the browser bundle:
// - The visual specs import HttpTransport from src/ directly (via Playwright's
//   TS loader), so they would happily run against a stale compiled dist and
//   report green even when `node dist/index.js` is broken.
// - Developers commonly do edit → `npm run test:visual` → `node dist/index.js
//   plan.md` to spot-check changes manually. If the suite only rebuilt the
//   browser bundle, the manual run would silently use the old compiled server
//   code (this happened — the /_assets route shipped to source but dist was
//   from an earlier session, so local images 404'd in the manual review).
// - `npm run build` runs `tsc` (server) + browser typecheck + browser bundle.
//   That covers both the runtime server JS and the asset HTML the runtime
//   reads from disk.
export default async function globalSetup(): Promise<void> {
  const root = resolve(import.meta.dirname, '..', '..');
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`npm run build exited with status ${result.status}`);
  }
}
