import { describe, expect, it } from 'vitest';
import * as esbuild from 'esbuild';

describe('@plan-review/react browser bundling', () => {
  it('does not pull Node-only core modules into browser bundles', async () => {
    await expect(
      esbuild.build({
        stdin: {
          contents: "import { useAutosave } from '../src/index.ts'; console.log(useAutosave);",
          resolveDir: new URL('.', import.meta.url).pathname,
          sourcefile: 'probe.tsx',
          loader: 'tsx',
        },
        bundle: true,
        platform: 'browser',
        write: false,
        logLevel: 'silent',
      }),
    ).resolves.toBeTruthy();
  });
});
