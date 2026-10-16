import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Rebuild every package so browser tests exercise the actual CLI distribution
// and the single inlined HTML bundle it serves, rather than importing src.
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
