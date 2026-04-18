import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Playwright global setup: rebuild the browser bundle so getAssetHtml() reads
// current src/browser/** instead of whatever was last built by hand.
export default async function globalSetup(): Promise<void> {
  const root = resolve(import.meta.dirname, '..', '..');
  const result = spawnSync('node', ['scripts/build-browser.js'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`build-browser.js exited with status ${result.status}`);
  }
}
