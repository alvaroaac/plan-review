import { runTests } from '@vscode/test-electron';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

async function main() {
  // __dirname at runtime is test/integration/out/, so go up 3 levels
  // to reach packages/vscode-extension/ (the extension root).
  const extensionDevelopmentPath = resolve(__dirname, '../../../');
  const extensionTestsPath = resolve(__dirname, './index');
  // macOS Unix socket paths are limited to ~103 chars, so a long
  // workspace path for user-data blows up. Keep it under tmpdir.
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'pr-vsc-'));
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--user-data-dir', userDataDir],
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
main();
